// Browser side of the gate: posts the visitor's words to the Compás Caribe
// Worker (POST /api/gate) and returns exactly what it decided. The browser
// never talks to TypeSafe AI and never holds a credential; it also never
// computes or adjusts a decision, so what is displayed is what the backend
// decided.
//
// `classify` never throws and never turns a failure into a decision: anything
// that is not a well-formed result from the Worker becomes UNAVAILABLE.

import { FAILURE_KINDS, GATE_SCHEMA } from './pipeline.js'

export const GATE_PATH = '/api/gate'

const DECISION_SET = new Set(['PROCEED', 'BLOCK', 'UNAVAILABLE'])
const isProb = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
const isCount = n => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Validates the wire shape; returns a clean GateResult or null. */
export function parseGateResult(body) {
  if (!body || typeof body !== 'object' || body.schema !== GATE_SCHEMA || !DECISION_SET.has(body.decision)) return null
  const unavailable = body.decision === 'UNAVAILABLE'
  const s = body.signals
  if (unavailable ? s !== null : !(s && isProb(s.intent) && isProb(s.irrelevance) && isProb(s.spam))) return null
  if (unavailable && !(body.failure && FAILURE_KINDS.includes(body.failure.kind))) return null
  if (!unavailable && body.failure !== null) return null
  if (!Array.isArray(body.trace) || !body.thresholds || typeof body.thresholds !== 'object') return null
  const u = body.usage
  return {
    schema: GATE_SCHEMA,
    decision: body.decision,
    rule: typeof body.rule === 'string' ? body.rule : null,
    trace: body.trace.map(r => ({
      id: String(r.id), label: String(r.label), met: Boolean(r.met),
      parts: Array.isArray(r.parts) ? r.parts.map(p => ({ text: String(p.text), ok: Boolean(p.ok) })) : [],
    })),
    signals: unavailable ? null : { intent: s.intent, irrelevance: s.irrelevance, spam: s.spam },
    thresholds: body.thresholds,
    model: typeof body.model === 'string' ? body.model : null,
    requestedModel: typeof body.requestedModel === 'string' ? body.requestedModel : '',
    latencyMs: isCount(body.latencyMs) ? body.latencyMs : null,
    attempts: isCount(body.attempts) ? body.attempts : 0,
    usage: u && isCount(u.inputTokens) && isCount(u.outputTokens) ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens } : null,
    failure: unavailable ? { kind: body.failure.kind } : null,
  }
}

function localUnavailable(kind, requestedModel = '') {
  return {
    schema: GATE_SCHEMA, decision: 'UNAVAILABLE', rule: null, trace: [], signals: null, thresholds: {},
    model: null, requestedModel, latencyMs: null, attempts: 0, usage: null, failure: { kind },
  }
}

/**
 * @param {{ endpoint?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {{ classify(text: string): Promise<{ rejected: 'empty'|'too_long'|'not_text' } | { result: object }> }}
 */
export function createGateClient({ endpoint = GATE_PATH, fetchImpl, timeoutMs = 25000 } = {}) {
  return {
    async classify(text) {
      const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
      if (!doFetch) return { result: localUnavailable('network') }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ text }),
          credentials: 'same-origin',
          signal: controller.signal,
        })
        let body = null
        try {
          body = await res.json()
        } catch {
          /* handled below */
        }
        const result = parseGateResult(body)
        if (result) return { result }
        if (res.status === 400 && body && ['empty', 'too_long', 'not_text'].includes(body.error)) return { rejected: body.error }
        return { result: localUnavailable(res.status === 429 ? 'rate_limited' : 'malformed') }
      } catch {
        return { result: localUnavailable(controller.signal.aborted ? 'timeout' : 'network') }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
