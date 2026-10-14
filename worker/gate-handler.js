// POST /api/gate: the only server surface of the site.
//
// Receives the visitor's words, runs the gate pipeline (validate -> Jev ->
// decide) and returns the GateResult. It never calls generative AI and never
// routes; the caller decides what a result means.
//
// Guards, in order: method, same-origin, body size and shape, rate limit,
// input validation, then in-flight de-duplication. The API key is read from
// `env.TYPESAFE_API_KEY` here and goes no further than the Jev request header.
// Responses carry no stack traces or provider detail.

import { resolveConfig } from '../src/domain/gate/config.js'
import { GATE_SCHEMA, runGate, unavailable } from '../src/domain/gate/pipeline.js'

const MAX_BODY_BYTES = 16 * 1024
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 30

const inflight = new Map()
const hits = new Map()

/** Test hook: clears module state shared across requests in one isolate. */
export function resetGateState() {
  inflight.clear()
  hits.clear()
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  })
}

const problem = (error, status, headers) => json({ error }, status, headers)

async function fingerprint(model, text) {
  const bytes = new TextEncoder().encode(`${model}\n${text}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Per-isolate sliding window: a backstop for when no rate-limit binding is configured. */
function localLimit(key, max, now) {
  const recent = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS)
  if (recent.length >= max) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= RATE_WINDOW_MS) hits.delete(k)
  return true
}

async function allowed(request, env, now) {
  const key = request.headers.get('cf-connecting-ip') || 'local'
  if (env.GATE_LIMITER && typeof env.GATE_LIMITER.limit === 'function') {
    try {
      const { success } = await env.GATE_LIMITER.limit({ key })
      return success
    } catch {
      /* binding trouble must not take the gate down; fall back to the local window */
    }
  }
  const max = Number(env.GATE_RATE_MAX)
  return localLimit(key, Number.isFinite(max) && max > 0 ? max : RATE_MAX, now())
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

  if (!(await allowed(request, env, now))) {
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
  return json(result, result.decision === 'UNAVAILABLE' ? 503 : 200)
}
