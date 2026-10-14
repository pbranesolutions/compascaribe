// POST /api/conversation: the generative steps of the site.
//
// Receives the visitor's words, the qualification the gate issued for them and
// (after the first reply) the conversation so far, makes ONE request to the
// model and returns the next reply: the opening (a reflection and one
// question), or a later turn (the agent's updated understanding and either one
// more question or the project's purpose stated). It generates nothing unless
// the qualification verifies, and a qualification only ever exists for words
// that Jev let through.
//
// The conversation's cost is bounded server-side, from signed data: every reply
// comes back with a renewed qualification that carries how many replies the
// conversation has had, so the browser cannot claim a lower count; the last
// permitted reply is always the statement; past the limit nothing is generated.
// The per-visitor rate limit and the token ceiling hold regardless.
//
// Guards, in order: method, same-origin, body size, switch, rate limit, body
// shape, input validation, history shape, qualification (signature, expiry,
// same words), budget, key, then the per-conversation ledger below. The API key
// is read from `env.ANTHROPIC_API_KEY` here and goes no further than the SDK
// client. Responses carry no provider detail; logs carry no visitor text.

import { resolveConversationConfig } from '../src/domain/conversation/config.js'
import { repeatsItself, validateHistory } from '../src/domain/conversation/history.js'
import { generateOpening, generateTurn, OpeningError } from '../src/domain/conversation/opening.js'
import { PROMPT_VERSION, TURN_PROMPT_VERSION } from '../src/domain/conversation/prompt.js'
import { issueQualification, signingSecret, verifyQualification } from '../src/domain/conversation/qualification.js'
import { OPENING_SCHEMA_ID } from '../src/domain/conversation/schema.js'
import { validateSubmission } from '../src/domain/gate/validate.js'
import { createRateLimiter, json, problem } from './http.js'

const MAX_BODY_BYTES = 32 * 1024
const limiter = createRateLimiter({ binding: 'CONVERSATION_LIMITER', maxEnv: 'CONVERSATION_RATE_MAX', defaultMax: 40 })

/**
 * The ledger of what each reply of each conversation has caused, per isolate:
 * a success answered from memory afterwards, a bounded number of attempts
 * after failures. Keyed by the conversation's id and the number of replies it
 * already had, so a retry of the same step finds its own entry. Across isolates
 * it is a backstop; the signed reply count, the rate limit and the token
 * ceiling are the guards that hold everywhere.
 *
 * @type {Map<string, { expiresAt: number, attempts: number, doneKey: string|null, done: any|null }>}
 */
const ledger = new Map()

/**
 * Model requests in flight, by (model, words, history). A second qualification
 * for the same step (Back then Begin again, two tabs, a double click) joins
 * that request instead of starting another.
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

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function prune(now) {
  if (ledger.size < 2000) return
  for (const [id, entry] of ledger) if (entry.expiresAt <= now) ledger.delete(id)
}

const unavailable = (kind, status = 503, headers) => json({ schema: OPENING_SCHEMA_ID, status: 'unavailable', failure: { kind } }, status, headers)

/**
 * @param {{ kind: 'opening'|'turn', result: any, qualification: { token: string, expiresAt: number }|null, replies: number, limit: number }} out
 */
const ok = ({ kind, result, qualification, replies, limit }) => json({
  schema: OPENING_SCHEMA_ID,
  status: 'ok',
  ...(kind === 'opening' ? { opening: result.opening } : { turn: result.turn }),
  // Renewed with every reply: the conversation continues under it, and it carries the signed count.
  qualification,
  progress: { replies, limit },
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

  const history = validateHistory(payload.turns, payload.understanding, { replyMaxChars: config.replyMaxChars, maxReplies: config.maxReplies })
  if (!history.ok) {
    log({ evt: 'conversation', outcome: 'invalid_history', reason: history.error })
    return problem(history.error, 400)
  }

  // The decisive guard: without a valid qualification for exactly these words, nothing is generated.
  const proof = await verifyQualification({ token: payload.qualification, text, secret: signingSecret(env), now })
  if (!proof.ok) {
    log({ evt: 'conversation', outcome: 'not_qualified', reason: proof.reason })
    return unavailable('qualification', 403)
  }

  const count = history.compasTurns
  // What the conversation has already cost is the larger of what the signed
  // qualification says and what the history shows: a browser can send less
  // history, never a lower signed count.
  const used = Math.max(proof.turn, count)
  const kind = count === 0 ? 'opening' : 'turn'
  // A renewed qualification continues a conversation; it cannot ask for a first reply again.
  if (kind === 'opening' && proof.turn > 0) {
    log({ evt: 'conversation', outcome: 'not_qualified', reason: 'renewed_for_opening' })
    return unavailable('qualification', 403)
  }
  if (used >= config.maxReplies) {
    log({ evt: 'conversation', outcome: 'limit', used })
    return unavailable('limit', 409)
  }

  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : ''
  if (!apiKey) {
    log({ evt: 'conversation', outcome: 'configuration' })
    return unavailable('configuration')
  }

  const final = used >= config.maxReplies - 1
  const converge = used >= config.convergeAfter
  const statementProposed = history.turns.some(t => t.role === 'compas' && t.kind === 'statement')
  const budget = { exchanges: history.visitorTurns, converge, repeated: repeatsItself(history.turns), final, statementProposed }

  const renew = () => issueQualification({
    text, secret: signingSecret(env), gateModel: proof.gateModel, ttlMs: config.sessionTtlMs, now,
    id: proof.id, turn: used + 1, startedAt: proof.startedAt, maxLifetimeMs: config.sessionMaxMs,
  })
  const respond = async (result) => ok({ kind, result, qualification: await renew(), replies: used + 1, limit: config.maxReplies })

  const key = `${proof.id}:${count}`
  let entry = ledger.get(key)
  if (!entry) {
    entry = { expiresAt: proof.expiresAt, attempts: 0, doneKey: null, done: null }
    ledger.set(key, entry)
    prune(now())
  }
  // What this step is: the same step presented again is answered, a different one (an edited answer) is generated.
  const stepKey = kind === 'opening' ? 'opening' : await sha256(JSON.stringify([history.turns, history.understanding]))

  if (entry.done && entry.doneKey === stepKey) {
    log({ evt: 'conversation', outcome: 'cached', kind, model: entry.done.model, chars: text.length })
    return respond(entry.done)
  }

  const fingerprint = await sha256(kind === 'opening'
    ? `${config.model}\n${text}`
    : `${config.model}\n${text}\n${JSON.stringify([history.turns, history.understanding, final, converge])}`)
  let run = generating.get(fingerprint)
  if (!run) {
    if (entry.attempts >= config.maxAttempts) {
      log({ evt: 'conversation', outcome: 'attempts_exhausted', kind })
      // The visitor is re-checked rather than refused: a fresh qualification restarts the allowance.
      return unavailable('qualification', 403)
    }
    entry.attempts++
    run = kind === 'opening'
      ? generateOpening({ text, apiKey, config, fetchImpl, now })
      : generateTurn({ text, turns: history.turns, understanding: history.understanding, budget, apiKey, config, fetchImpl, now })
    generating.set(fingerprint, run)
    run.then(() => generating.delete(fingerprint), () => generating.delete(fingerprint))
  }

  let result
  try {
    result = await run
  } catch (err) {
    const e = err instanceof OpeningError ? err : new OpeningError('provider_error')
    // Provider detail goes to the log only: class of failure, HTTP status, why validation failed. Never the key or the words.
    log({ evt: 'conversation', outcome: e.kind, kind, status: e.status, reason: e.reason, stopReason: e.stopReason, latencyMs: e.latencyMs, model: config.model, chars: text.length, attempts: entry.attempts, used })
    return unavailable(e.kind, e.kind === 'rate_limited' ? 429 : 503, e.kind === 'rate_limited' ? { 'retry-after': '30' } : undefined)
  }
  entry.done = result
  entry.doneKey = stepKey

  log({
    evt: 'conversation', outcome: 'ok', kind, prompt: kind === 'opening' ? PROMPT_VERSION : TURN_PROMPT_VERSION, model: result.model,
    effort: kind === 'opening' ? config.effort : config.turnEffort, latencyMs: result.latencyMs, stopReason: result.stopReason,
    usage: result.usage, attempts: entry.attempts, chars: text.length, requestId: result.requestId, repaired: result.repaired || null,
    used: used + 1, final, converge,
    ...(kind === 'turn' ? { reading: result.turn.reading, move: result.turn.move } : {}),
  })
  return respond(result)
}
