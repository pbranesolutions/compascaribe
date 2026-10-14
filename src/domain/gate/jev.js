// Jev over the official TypeSafe AI API: POST https://api.typesafe.ai/v1/systemone.
//
// One request, three independent Noul questions. Runs wherever `fetch` exists
// (the Worker in production; node in tests and the live check). The API key is
// a parameter: this module never reads the environment.
//
// Failure handling:
//   401 / 403            -> 'auth'          never retried
//   400 / 422            -> 'invalid'       never retried (our request is wrong)
//   429                  -> 'rate_limited'  retried with back-off
//   529                  -> 'overloaded'    retried with back-off
//   5xx                  -> 'upstream'      retried with back-off
//   timeout              -> 'timeout'       retried while the deadline allows
//   fetch rejects        -> 'network'       retried while the deadline allows
//   200 but wrong shape  -> 'malformed'     never retried
// An answer is never guessed: any failure surfaces as a JevError.

import { JEV_ENDPOINT } from './config.js'
import { buildJevRequest, QUESTION_KEYS } from './questions.js'

export class JevError extends Error {
  /**
   * @param {'auth'|'invalid'|'rate_limited'|'overloaded'|'upstream'|'timeout'|'network'|'malformed'} kind
   * @param {{ status?: number, attempts?: number, latencyMs?: number }} [info]
   */
  constructor(kind, info = {}) {
    super(`Jev request failed: ${kind}${info.status ? ` (${info.status})` : ''}`)
    this.name = 'JevError'
    this.kind = kind
    this.status = info.status ?? null
    this.attempts = info.attempts ?? 0
    this.latencyMs = info.latencyMs ?? null
  }
}

const RETRYABLE = new Set(['rate_limited', 'overloaded', 'upstream', 'timeout', 'network'])
const BACKOFF_MS = 300
const BACKOFF_CAP_MS = 1500

const defaultSleep = ms => new Promise(r => setTimeout(r, ms))

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limited'
  if (status === 529) return 'overloaded'
  if (status >= 500) return 'upstream'
  if (status >= 400) return 'invalid'
  return 'malformed'
}

function probability(answer) {
  if (!answer || answer.type !== 'noul') return null
  const p = answer.noul
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null
}

/** Reads the three signals out of a response body, or returns null if any is missing or invalid. */
export function readSignals(body) {
  const answers = body && typeof body === 'object' ? body.answers : null
  if (!answers || typeof answers !== 'object') return null
  const intent = probability(answers[QUESTION_KEYS.intent])
  const irrelevance = probability(answers[QUESTION_KEYS.irrelevance])
  const spam = probability(answers[QUESTION_KEYS.spam])
  return intent === null || irrelevance === null || spam === null ? null : { intent, irrelevance, spam }
}

function readUsage(body) {
  const u = body && typeof body === 'object' ? body.usage : null
  const ok = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
  return u && ok(u.input_tokens) && ok(u.output_tokens) ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : null
}

function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after')
  const s = raw === null || raw === undefined ? NaN : Number(raw)
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, BACKOFF_CAP_MS) : null
}

/**
 * @param {{
 *   text: string, apiKey: string, model: string, timeoutMs: number, deadlineMs: number, maxAttempts: number,
 *   fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => number,
 * }} o
 * @returns {Promise<{ signals: {intent:number,irrelevance:number,spam:number}, model: string|null, usage: {inputTokens:number,outputTokens:number}|null, attempts: number, latencyMs: number }>}
 */
export async function classifyWithJev({ text, apiKey, model, timeoutMs, deadlineMs, maxAttempts, fetchImpl = fetch, sleep = defaultSleep, now = Date.now }) {
  const body = JSON.stringify(buildJevRequest({ text, model }))
  const started = now()
  const elapsed = () => now() - started
  let attempt = 0
  let last = null

  while (attempt < maxAttempts) {
    attempt++
    const budget = Math.min(timeoutMs, deadlineMs - elapsed())
    if (budget <= 0) break
    try {
      return { ...(await once(budget)), attempts: attempt, latencyMs: elapsed() }
    } catch (err) {
      last = err instanceof JevError ? err : new JevError('network')
      if (!RETRYABLE.has(last.kind) || attempt >= maxAttempts) break
      const wait = last.retryAfter ?? Math.min(BACKOFF_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS)
      if (elapsed() + wait >= deadlineMs) break
      await sleep(wait)
    }
  }
  const failure = last || new JevError('timeout')
  throw new JevError(failure.kind, { status: failure.status ?? undefined, attempts: attempt, latencyMs: elapsed() })

  async function once(budget) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), budget)
    try {
      let res
      try {
        res = await fetchImpl(JEV_ENDPOINT, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body,
          signal: controller.signal,
        })
      } catch {
        throw new JevError(controller.signal.aborted ? 'timeout' : 'network')
      }
      if (!res.ok) {
        const err = new JevError(kindForStatus(res.status), { status: res.status })
        err.retryAfter = retryAfterMs(res)
        throw err
      }
      let json
      try {
        json = await res.json()
      } catch {
        throw new JevError(controller.signal.aborted ? 'timeout' : 'malformed', { status: res.status })
      }
      const signals = readSignals(json)
      if (!signals) throw new JevError('malformed', { status: res.status })
      return { signals, model: typeof json.model === 'string' && json.model ? json.model : null, usage: readUsage(json) }
    } finally {
      clearTimeout(timer)
    }
  }
}
