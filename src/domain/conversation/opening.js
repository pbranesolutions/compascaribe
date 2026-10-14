// Model invocation for the conversation. SERVER ONLY: this is the one module
// that imports the Anthropic SDK and receives the API key, and it must never be
// imported from src/ui, src/app or anything else the browser bundles.
//
// One qualified submission is one request to the model, and so is each later
// reply. The SDK's own retries are off (maxRetries: 0), there is no fallback
// model and no second attempt on a response that fails validation; a visitor's
// explicit "Try again" is a new, separately-counted request. Nothing is guessed
// or substituted on failure: every failure surfaces as an OpeningError with a
// public kind.

import Anthropic from '@anthropic-ai/sdk'
import { repairNote, SYSTEM_PROMPT, TURN_SYSTEM_PROMPT, turnMessage, visitorMessage } from './prompt.js'
import { OPENING_SCHEMA, validateOpening } from './schema.js'
import { TURN_SCHEMA, validateTurn } from './turn.js'

/**
 * What a visitor may be told about a failure. Provider specifics (status codes,
 * messages, request ids) stay in the server log.
 */
export const OPENING_FAILURE_KINDS = Object.freeze([
  'configuration', 'rate_limited', 'overloaded', 'timeout', 'network', 'malformed', 'refused', 'provider_error', 'qualification', 'limit',
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
 * The one request, however the instructions and the check differ: shared so
 * the opening and the later turns fail in exactly the same ways.
 *
 * @returns {Promise<{ value: any, repaired: string|null, model: string, usage: { inputTokens: number, outputTokens: number } | null, stopReason: string|null, latencyMs: number, requestId: string|null }>}
 */
async function request({ apiKey, fetchImpl, now, system, user, schema, validate, effort, maxTokens, timeoutMs, model, cacheSystem = false }) {
  if (!apiKey) throw new OpeningError('configuration', { reason: 'no_key' })

  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: timeoutMs,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })

  const started = now()
  let message
  try {
    message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // The turn instructions are long and identical on every turn of every conversation; marking them lets repeat turns read them from cache.
      system: cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: user }],
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
  const checked = validate(parsed)
  if (!checked.ok) throw new OpeningError('malformed', { ...info, reason: checked.reason })

  const u = message.usage
  const count = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return {
    value: checked,
    repaired: checked.repaired,
    model: typeof message.model === 'string' && message.model ? message.model : model,
    usage: u && count(u.input_tokens) && count(u.output_tokens) ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : null,
    stopReason,
    latencyMs,
    requestId: typeof message._request_id === 'string' ? message._request_id : null,
  }
}

/**
 * The first reply: a reflection and one question for the visitor's description.
 *
 * @param {{
 *   text: string, apiKey: string,
 *   config: ReturnType<import('./config.js').resolveConversationConfig>,
 *   fetchImpl?: typeof fetch, now?: () => number,
 * }} input
 * @returns {Promise<{ opening: { describes: string, uncertainty: string, explores: string, reflection: string, question: string }, repaired: string|null, model: string, usage: { inputTokens: number, outputTokens: number } | null, stopReason: string|null, latencyMs: number, requestId: string|null }>}
 */
export async function generateOpening({ text, apiKey, config, fetchImpl, now = Date.now }) {
  const out = await request({
    apiKey,
    fetchImpl,
    now,
    system: SYSTEM_PROMPT,
    user: visitorMessage(text),
    schema: OPENING_SCHEMA,
    validate: validateOpening,
    effort: config.effort,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    model: config.model,
  })
  const { value, ...rest } = out
  return { opening: value.opening, ...rest }
}

/**
 * Every later reply: the agent reads the visitor's latest message in the
 * context of the whole conversation and the understanding built so far, and
 * returns its move (a question, or the project's purpose stated).
 *
 * @param {{
 *   text: string,
 *   turns: Array<object>,                 the validated history, ending with the visitor's message
 *   understanding: object|null,
 *   budget: { exchanges: number, converge: boolean, final: boolean, statementProposed: boolean },
 *   apiKey: string,
 *   config: ReturnType<import('./config.js').resolveConversationConfig>,
 *   fetchImpl?: typeof fetch, now?: () => number,
 * }} input
 */
export async function generateTurn({ text, turns, understanding, budget, apiKey, config, fetchImpl, now = Date.now }) {
  const previousQuestions = turns.filter(t => t.role === 'compas' && t.question).map(t => t.question)
  const message = turnMessage({ text, turns, understanding, budget })
  const ask = (user) => request({
    apiKey,
    fetchImpl,
    now,
    system: TURN_SYSTEM_PROMPT,
    user,
    schema: TURN_SCHEMA,
    validate: raw => validateTurn(raw, { final: budget.final, previousQuestions }),
    effort: config.turnEffort,
    maxTokens: config.turnMaxTokens,
    timeoutMs: config.turnTimeoutMs,
    model: config.model,
    cacheSystem: true,
  })

  let out
  try {
    out = await ask(message)
  } catch (err) {
    // A reply that came back and failed the checks before a visitor could see it is asked for once more,
    // told why. Only that: a transport failure, a refusal or a timeout is never retried here, and the
    // second request is made only while there is time for it. Mid-conversation, a visitor's "Try again"
    // is the costliest way to find out the model slipped.
    const slipped = err instanceof OpeningError && err.kind === 'malformed' && err.reason && err.reason !== 'max_tokens'
    const roomLeft = err instanceof OpeningError && typeof err.latencyMs === 'number' && err.latencyMs < config.turnTimeoutMs / 2
    if (!slipped || !roomLeft || !(config.turnRepairs > 0)) throw err
    const first = err
    try {
      out = await ask(`${message}\n\n${repairNote(first.reason, budget)}`)
    } catch (second) {
      if (second instanceof OpeningError) throw new OpeningError(second.kind, { status: second.status, reason: second.reason, latencyMs: (first.latencyMs || 0) + (second.latencyMs || 0), stopReason: second.stopReason })
      throw second
    }
    out.repaired = out.repaired ? `retry:${first.reason}+${out.repaired}` : `retry:${first.reason}`
    out.latencyMs += first.latencyMs || 0
    out.attempts = 2
  }
  const { value, ...rest } = out
  return { turn: value.turn, ...rest }
}
