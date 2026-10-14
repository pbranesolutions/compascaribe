// Model invocation for the first exchange. SERVER ONLY: this is the one module
// that imports the Anthropic SDK and receives the API key, and it must never be
// imported from src/ui, src/app or anything else the browser bundles.
//
// One qualified submission is one request to the model. The SDK's own retries
// are off (maxRetries: 0), there is no fallback model and no second attempt on a
// response that fails validation; a visitor's explicit "Try again" is a new,
// separately-counted request. Nothing is guessed or substituted on failure:
// every failure surfaces as an OpeningError with a public kind.

import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT, visitorMessage } from './prompt.js'
import { OPENING_SCHEMA, validateOpening } from './schema.js'

/**
 * What a visitor may be told about a failure. Provider specifics (status codes,
 * messages, request ids) stay in the server log.
 */
export const OPENING_FAILURE_KINDS = Object.freeze([
  'configuration', 'rate_limited', 'overloaded', 'timeout', 'network', 'malformed', 'refused', 'provider_error', 'qualification',
])

export class OpeningError extends Error {
  /**
   * @param {string} kind  one of OPENING_FAILURE_KINDS
   * @param {{ status?: number|null, reason?: string|null, latencyMs?: number|null, stopReason?: string|null }} [info]
   */
  constructor(kind, info = {}) {
    super(`Opening failed: ${kind}${info.reason ? ` (${info.reason})` : ''}`)
    this.name = 'OpeningError'
    this.kind = kind
    this.status = info.status ?? null
    this.reason = info.reason ?? null
    this.latencyMs = info.latencyMs ?? null
    this.stopReason = info.stopReason ?? null
  }
}

function kindFor(err) {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout'
  if (err instanceof Anthropic.APIConnectionError) return 'network'
  const status = err && typeof err.status === 'number' ? err.status : null
  if (status === 401 || status === 403 || status === 404) return 'configuration'
  if (status === 429) return 'rate_limited'
  if (status === 529) return 'overloaded'
  return 'provider_error'
}

/**
 * @param {{
 *   text: string, apiKey: string,
 *   config: ReturnType<import('./config.js').resolveConversationConfig>,
 *   fetchImpl?: typeof fetch, now?: () => number,
 * }} input
 * @returns {Promise<{ opening: { describes: string, uncertainty: string, reflection: string, question: string }, model: string, usage: { inputTokens: number, outputTokens: number } | null, stopReason: string|null, latencyMs: number, requestId: string|null }>}
 */
export async function generateOpening({ text, apiKey, config, fetchImpl, now = Date.now }) {
  if (!apiKey) throw new OpeningError('configuration', { reason: 'no_key' })

  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: config.timeoutMs,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })

  const started = now()
  let message
  try {
    message = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: config.effort, format: { type: 'json_schema', schema: OPENING_SCHEMA } },
      messages: [{ role: 'user', content: visitorMessage(text) }],
    })
  } catch (err) {
    throw new OpeningError(kindFor(err), { status: typeof err?.status === 'number' ? err.status : null, latencyMs: now() - started })
  }
  const latencyMs = now() - started
  const stopReason = message.stop_reason ?? null
  const info = { latencyMs, stopReason }

  if (stopReason === 'refusal') throw new OpeningError('refused', info)
  // Cut off by the token ceiling: whatever text there is cannot be trusted to be whole.
  if (stopReason === 'max_tokens') throw new OpeningError('malformed', { ...info, reason: 'max_tokens' })

  const raw = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new OpeningError('malformed', { ...info, reason: 'not_json' })
  }
  const checked = validateOpening(parsed)
  if (!checked.ok) throw new OpeningError('malformed', { ...info, reason: checked.reason })

  const u = message.usage
  const count = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return {
    opening: checked.opening,
    repaired: checked.repaired,
    model: typeof message.model === 'string' && message.model ? message.model : config.model,
    usage: u && count(u.input_tokens) && count(u.output_tokens) ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : null,
    stopReason,
    latencyMs,
    requestId: typeof message._request_id === 'string' ? message._request_id : null,
  }
}
