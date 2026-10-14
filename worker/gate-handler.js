// POST /api/gate: the only server surface of the site.
//
// Receives the visitor's words, runs the gate pipeline (validate -> Jev ->
// decide) and returns the GateResult. It never calls generative AI and never
// routes; the caller decides what a result means. A PROCEED additionally
// carries a signed qualification (see conversation/qualification.js), the only
// thing that lets POST /api/conversation generate a reply.
//
// Guards, in order: method, same-origin, body size and shape, rate limit,
// input validation, then in-flight de-duplication. The API key is read from
// `env.TYPESAFE_API_KEY` here and goes no further than the Jev request header.
// Responses carry no stack traces or provider detail.

import { resolveConfig } from '../src/domain/gate/config.js'
import { GATE_SCHEMA, runGate, unavailable } from '../src/domain/gate/pipeline.js'
import { issueQualification, signingSecret } from '../src/domain/conversation/qualification.js'
import { resolveConversationConfig } from '../src/domain/conversation/config.js'
import { createRateLimiter, json, problem } from './http.js'

const MAX_BODY_BYTES = 16 * 1024
const limiter = createRateLimiter({ binding: 'GATE_LIMITER', maxEnv: 'GATE_RATE_MAX', defaultMax: 30 })

const inflight = new Map()

/** Test hook: clears module state shared across requests in one isolate. */
export function resetGateState() {
  inflight.clear()
  limiter.reset()
}

async function fingerprint(model, text) {
  const bytes = new TextEncoder().encode(`${model}\n${text}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => number, log?: (entry: object) => void }} [deps]
 */
export async function handleGate(request, env = {}, deps = {}) {
  const { fetchImpl, sleep, now = Date.now, log = entry => console.log(JSON.stringify(entry)) } = deps
  const config = resolveConfig(env)

  if (request.method !== 'POST') return problem('method_not_allowed', 405, { allow: 'POST' })

  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return problem('forbidden', 403)

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return problem('too_long', 413)

  if (!(await limiter.allowed(request, env, now))) {
    log({ evt: 'gate', outcome: 'rate_limited' })
    return json(unavailable({ kind: 'rate_limited', config }), 429, { 'retry-after': '60' })
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

  const text = payload.text
  const run = () => runGate({
    text,
    apiKey: typeof env.TYPESAFE_API_KEY === 'string' ? env.TYPESAFE_API_KEY.trim() : '',
    config,
    fetchImpl,
    sleep,
    now,
    // Provider detail goes to the log only: class of failure and HTTP status, never the key or the text.
    onFailure: err => log({ evt: 'gate.jev_failure', kind: err.kind, status: err.status, attempts: err.attempts }),
  })

  // Identical submissions arriving together share one Jev request.
  let pending
  let key = null
  if (typeof text === 'string' && text.trim() && text.length <= config.maxChars) {
    key = await fingerprint(config.model, text)
    pending = inflight.get(key)
  }
  if (!pending) {
    pending = run()
    if (key) {
      inflight.set(key, pending)
      pending.then(() => inflight.delete(key), () => inflight.delete(key))
    }
  }

  let result
  try {
    result = await pending
  } catch {
    log({ evt: 'gate', outcome: 'internal_error' })
    return json(unavailable({ kind: 'provider_error', config }), 503)
  }

  if (result.invalid) return problem(result.invalid, 400)

  log({
    evt: 'gate', schema: GATE_SCHEMA, decision: result.decision, rule: result.rule, model: result.model,
    latencyMs: result.latencyMs, attempts: result.attempts, failure: result.failure?.kind || null, chars: text.length,
  })

  if (result.decision !== 'PROCEED') return json(result, result.decision === 'UNAVAILABLE' ? 503 : 200)

  // The server's own statement that these exact words passed the gate. The
  // conversation endpoint generates nothing without it, and it cannot be
  // produced anywhere else: BLOCK and UNAVAILABLE never receive one. It is only
  // issued when a reply can actually follow (the route is enabled and the model
  // key is configured); otherwise PROCEED is returned bare, as before.
  const conversation = resolveConversationConfig(env)
  const generating = conversation.enabled && typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim() !== ''
  const qualification = generating
    ? await issueQualification({ text, secret: signingSecret(env), gateModel: result.model, ttlMs: conversation.qualificationTtlMs, now })
    : null
  return json(qualification ? { ...result, qualification } : result, 200)
}
