// POST /api/conversation: the first generative step of the site.
//
// Receives the visitor's words and the qualification the gate issued for them,
// makes ONE request to the model and returns the opening: a short reflection
// and one question. It generates nothing unless the qualification verifies, and
// a qualification only ever exists for words that Jev let through.
//
// Guards, in order: method, same-origin, body size, switch, rate limit, body
// shape, input validation, qualification (signature, expiry, same words), key,
// then the per-qualification ledger below. The API key is read from
// `env.ANTHROPIC_API_KEY` here and goes no further than the SDK client.
// Responses carry no provider detail; logs carry no visitor text.

import { resolveConversationConfig } from '../src/domain/conversation/config.js'
import { generateOpening, OpeningError } from '../src/domain/conversation/opening.js'
import { PROMPT_VERSION } from '../src/domain/conversation/prompt.js'
import { signingSecret, verifyQualification } from '../src/domain/conversation/qualification.js'
import { OPENING_SCHEMA_ID } from '../src/domain/conversation/schema.js'
import { validateSubmission } from '../src/domain/gate/validate.js'
import { createRateLimiter, json, problem } from './http.js'

const MAX_BODY_BYTES = 16 * 1024
const limiter = createRateLimiter({ binding: 'CONVERSATION_LIMITER', maxEnv: 'CONVERSATION_RATE_MAX', defaultMax: 12 })

/**
 * The ledger of what each qualification has caused, per isolate: one model
 * request at a time, a success answered from memory afterwards, a bounded
 * number of attempts after failures. Across isolates it is a backstop; the
 * rate limit, the qualification's short life and the token ceiling are the
 * guards that hold everywhere.
 *
 * @type {Map<string, { expiresAt: number, attempts: number, pending: Promise<any>|null, done: any|null }>}
 */
const ledger = new Map()

/**
 * Model requests in flight, by (model, words). A second qualification for words
 * already being answered (Back then Begin again, two tabs) joins that request
 * instead of starting another.
 *
 * @type {Map<string, Promise<any>>}
 */
const generating = new Map()

/** Test hook: clears module state shared across requests in one isolate. */
export function resetConversationState() {
  ledger.clear()
  generating.clear()
  limiter.reset()
}

async function fingerprint(model, text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${model}
${text}`))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function prune(now) {
  if (ledger.size < 2000) return
  for (const [id, entry] of ledger) if (!entry.pending && entry.expiresAt <= now) ledger.delete(id)
}

const unavailable = (kind, status = 503, headers) => json({ schema: OPENING_SCHEMA_ID, status: 'unavailable', failure: { kind } }, status, headers)

const ok = result => json({
  schema: OPENING_SCHEMA_ID,
  status: 'ok',
  opening: result.opening,
  model: result.model,
  usage: result.usage,
  latencyMs: result.latencyMs,
})

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, log?: (entry: object) => void }} [deps]
 */
export async function handleConversation(request, env = {}, deps = {}) {
  const { fetchImpl, now = Date.now, log = entry => console.log(JSON.stringify(entry)) } = deps
  const config = resolveConversationConfig(env)

  if (request.method !== 'POST') return problem('method_not_allowed', 405, { allow: 'POST' })

  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return problem('forbidden', 403)

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return problem('too_long', 413)

  if (!config.enabled) {
    log({ evt: 'conversation', outcome: 'disabled' })
    return unavailable('configuration')
  }

  if (!(await limiter.allowed(request, env, now))) {
    log({ evt: 'conversation', outcome: 'rate_limited' })
    return unavailable('rate_limited', 429, { 'retry-after': '60' })
  }

  let raw
  try {
    raw = await request.text()
  } catch {
    return problem('bad_request', 400)
  }
  if (raw.length > MAX_BODY_BYTES) return problem('too_long', 413)
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return problem('bad_request', 400)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return problem('bad_request', 400)

  const checked = validateSubmission(payload.text, { maxChars: config.maxChars })
  if (!checked.ok) return problem(checked.reason, 400)
  const text = checked.text

  // The decisive guard: without a valid qualification for exactly these words, nothing is generated.
  const proof = await verifyQualification({ token: payload.qualification, text, secret: signingSecret(env), now })
  if (!proof.ok) {
    log({ evt: 'conversation', outcome: 'not_qualified', reason: proof.reason })
    return unavailable('qualification', 403)
  }

  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : ''
  if (!apiKey) {
    log({ evt: 'conversation', outcome: 'configuration' })
    return unavailable('configuration')
  }

  let entry = ledger.get(proof.id)
  if (!entry) {
    entry = { expiresAt: proof.expiresAt, attempts: 0, pending: null, done: null }
    ledger.set(proof.id, entry)
    prune(now())
  }

  if (entry.done) {
    log({ evt: 'conversation', outcome: 'cached', model: entry.done.model, chars: text.length })
    return ok(entry.done)
  }

  if (!entry.pending) {
    if (entry.attempts >= config.maxAttempts) {
      log({ evt: 'conversation', outcome: 'attempts_exhausted' })
      // The visitor is re-checked rather than refused: a fresh qualification restarts the allowance.
      return unavailable('qualification', 403)
    }
    const mine = entry
    const key = await fingerprint(config.model, text)
    let run = generating.get(key)
    if (!run) {
      entry.attempts++
      run = generateOpening({ text, apiKey, config, fetchImpl, now })
      generating.set(key, run)
      run.then(() => generating.delete(key), () => generating.delete(key))
    }
    entry.pending = run
      .then((result) => { mine.done = result; return result })
      .finally(() => { mine.pending = null })
  }

  let result
  try {
    result = await entry.pending
  } catch (err) {
    const e = err instanceof OpeningError ? err : new OpeningError('provider_error')
    // Provider detail goes to the log only: class of failure, HTTP status, why validation failed. Never the key or the words.
    log({ evt: 'conversation', outcome: e.kind, status: e.status, reason: e.reason, stopReason: e.stopReason, latencyMs: e.latencyMs, model: config.model, chars: text.length, attempts: entry.attempts })
    return unavailable(e.kind, e.kind === 'rate_limited' ? 429 : 503, e.kind === 'rate_limited' ? { 'retry-after': '30' } : undefined)
  }

  log({
    evt: 'conversation', outcome: 'ok', prompt: PROMPT_VERSION, model: result.model, effort: config.effort, latencyMs: result.latencyMs, stopReason: result.stopReason,
    usage: result.usage, attempts: entry.attempts, chars: text.length, requestId: result.requestId, repaired: result.repaired || null,
  })
  return ok(result)
}
