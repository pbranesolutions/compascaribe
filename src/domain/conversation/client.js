// Browser side of the first exchange: posts the visitor's words and the
// qualification the Worker issued to POST /api/conversation, and returns what
// the model wrote. The browser never talks to Anthropic and never holds a
// credential.
//
// `open` never throws and never invents a reply: anything that is not a
// well-formed opening from the Worker becomes a failure, and the caller keeps
// the visitor's words.

import { OPENING_SCHEMA_ID, validateOpening } from './schema.js'

export const CONVERSATION_PATH = '/api/conversation'

const FAILURE_KINDS = ['configuration', 'rate_limited', 'overloaded', 'timeout', 'network', 'malformed', 'refused', 'provider_error', 'qualification']
const count = n => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Validates the wire shape; returns a clean result or null. */
export function parseOpeningResponse(body) {
  if (!body || typeof body !== 'object' || body.schema !== OPENING_SCHEMA_ID) return null
  if (body.status === 'ok') {
    const checked = validateOpening(body.opening)
    if (!checked.ok) return null
    const u = body.usage
    return {
      ok: true,
      opening: checked.opening,
      model: typeof body.model === 'string' ? body.model : null,
      latencyMs: count(body.latencyMs) ? body.latencyMs : null,
      usage: u && count(u.inputTokens) && count(u.outputTokens) ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens } : null,
    }
  }
  if (body.status === 'unavailable' && body.failure && FAILURE_KINDS.includes(body.failure.kind)) return { ok: false, failure: body.failure.kind }
  return null
}

/**
 * @param {{ endpoint?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {{ open(input: { text: string, qualification: string }): Promise<{ ok: true, opening: object, model: string|null, latencyMs: number|null, usage: object|null } | { ok: false, failure: string } | { rejected: string }> }}
 */
export function createConversationClient({ endpoint = CONVERSATION_PATH, fetchImpl, timeoutMs = 35000 } = {}) {
  return {
    async open({ text, qualification }) {
      const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
      if (!doFetch) return { ok: false, failure: 'network' }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ text, qualification }),
          credentials: 'same-origin',
          signal: controller.signal,
        })
        let body = null
        try {
          body = await res.json()
        } catch {
          /* handled below */
        }
        const parsed = parseOpeningResponse(body)
        if (parsed) return parsed
        if (res.status === 400 && body && ['empty', 'too_long', 'not_text'].includes(body.error)) return { rejected: body.error }
        return { ok: false, failure: res.status === 429 ? 'rate_limited' : 'malformed' }
      } catch {
        return { ok: false, failure: controller.signal.aborted ? 'timeout' : 'network' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
