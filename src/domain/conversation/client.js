// Browser side of the conversation: posts the visitor's words, the
// qualification the Worker issued for them and (after the first reply) the
// conversation so far to POST /api/conversation, and returns what the model
// wrote. The browser never talks to Anthropic and never holds a credential.
//
// `open` and `next` never throw and never invent a reply: anything that is not
// a well-formed reply from the Worker becomes a failure, and the caller keeps
// the visitor's words. Every success carries the renewed qualification the
// conversation continues under.

import { OPENING_SCHEMA_ID, validateOpening } from './schema.js'
import { validateTurn } from './turn.js'

export const CONVERSATION_PATH = '/api/conversation'

const FAILURE_KINDS = ['configuration', 'rate_limited', 'overloaded', 'timeout', 'network', 'malformed', 'refused', 'provider_error', 'qualification', 'limit']
const REJECTIONS = ['empty', 'too_long', 'not_text', 'invalid_history', 'reply_too_long', 'empty_reply']
const count = n => typeof n === 'number' && Number.isFinite(n) && n >= 0

function parseQualification(q) {
  if (!q || typeof q.token !== 'string' || !q.token || q.token.length > 2048 || !count(q.expiresAt)) return null
  return { token: q.token, expiresAt: q.expiresAt }
}

/**
 * Validates the wire shape; returns a clean result or null.
 *
 * @returns {{ ok: true, kind: 'opening', opening: object, qualification: object|null, progress: object|null, model: string|null, latencyMs: number|null, usage: object|null }
 *   | { ok: true, kind: 'turn', turn: object, qualification: object|null, progress: object|null, model: string|null, latencyMs: number|null, usage: object|null }
 *   | { ok: false, failure: string } | null}
 */
export function parseConversationResponse(body) {
  if (!body || typeof body !== 'object' || body.schema !== OPENING_SCHEMA_ID) return null
  if (body.status === 'ok') {
    const u = body.usage
    const common = {
      ok: true,
      qualification: parseQualification(body.qualification),
      progress: body.progress && count(body.progress.replies) && count(body.progress.limit) ? { replies: body.progress.replies, limit: body.progress.limit } : null,
      model: typeof body.model === 'string' ? body.model : null,
      latencyMs: count(body.latencyMs) ? body.latencyMs : null,
      usage: u && count(u.inputTokens) && count(u.outputTokens) ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens } : null,
    }
    if (body.turn !== undefined) {
      const checked = validateTurn(body.turn)
      return checked.ok ? { ...common, kind: 'turn', turn: checked.turn } : null
    }
    const checked = validateOpening(body.opening)
    return checked.ok ? { ...common, kind: 'opening', opening: checked.opening } : null
  }
  if (body.status === 'unavailable' && body.failure && FAILURE_KINDS.includes(body.failure.kind)) return { ok: false, failure: body.failure.kind }
  return null
}

/** Kept for callers that only know the first reply. */
export const parseOpeningResponse = parseConversationResponse

/**
 * @param {{ endpoint?: string, fetchImpl?: typeof fetch, timeoutMs?: number, turnTimeoutMs?: number }} [options]
 */
export function createConversationClient({ endpoint = CONVERSATION_PATH, fetchImpl, timeoutMs = 35000, turnTimeoutMs = 75000 } = {}) {
  // A later reply may take a second request when the first failed validation (server side: only while there
  // is time), so it is given room for both: well past one 40 s request, short of a visitor giving up.
  async function post(body, limit) {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
    if (!doFetch) return { ok: false, failure: 'network' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), limit)
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        signal: controller.signal,
      })
      let parsedBody = null
      try {
        parsedBody = await res.json()
      } catch {
        /* handled below */
      }
      const parsed = parseConversationResponse(parsedBody)
      if (parsed) return parsed
      if (res.status === 400 && parsedBody && REJECTIONS.includes(parsedBody.error)) return { rejected: parsedBody.error }
      return { ok: false, failure: res.status === 429 ? 'rate_limited' : 'malformed' }
    } catch {
      return { ok: false, failure: controller.signal.aborted ? 'timeout' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    /** The first reply, for the visitor's description. */
    open({ text, qualification }) {
      return post({ text, qualification }, timeoutMs)
    },

    /**
     * The next reply, once the visitor has answered.
     *
     * @param {{ text: string, qualification: string, turns: Array<object>, understanding?: object|null }} input
     *   turns: the conversation after the first words (see wireTurns), ending with the visitor's latest message
     */
    next({ text, qualification, turns, understanding = null }) {
      return post({ text, qualification, turns, understanding }, turnTimeoutMs)
    },
  }
}
