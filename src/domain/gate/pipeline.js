// The gate pipeline: validate -> Jev -> decide. Nothing here knows about HTTP,
// the Worker, the DOM or what happens after a decision; it returns a plain
// GateResult and stops. Connecting PROCEED to generative AI later means
// consuming this result, not changing it.

import { DECISIONS, decide } from './decide.js'
import { classifyWithJev, JevError } from './jev.js'
import { validateSubmission } from './validate.js'

export const GATE_SCHEMA = 'compascaribe.gate/1'

/**
 * What a visitor may be told about a failure. Provider specifics (credentials,
 * status codes beyond the class of problem) stay in the server log.
 */
export const FAILURE_KINDS = Object.freeze(['configuration', 'rate_limited', 'overloaded', 'timeout', 'network', 'malformed', 'provider_error'])

const PUBLIC_KIND = {
  auth: 'configuration',
  invalid: 'provider_error',
  upstream: 'provider_error',
  rate_limited: 'rate_limited',
  overloaded: 'overloaded',
  timeout: 'timeout',
  network: 'network',
  malformed: 'malformed',
}

/**
 * @typedef {Object} GateResult
 * @property {string} schema
 * @property {'PROCEED'|'BLOCK'|'UNAVAILABLE'} decision
 * @property {string|null} rule        id of the rule that decided; null when unavailable
 * @property {Array} trace             every rule with its conditions evaluated against the signals
 * @property {{intent:number,irrelevance:number,spam:number}|null} signals
 * @property {Object} thresholds       the thresholds that were applied
 * @property {string|null} model       the model Jev reported using
 * @property {string} requestedModel
 * @property {number|null} latencyMs   wall-clock time spent on the Jev call, across attempts
 * @property {number} attempts
 * @property {{inputTokens:number,outputTokens:number}|null} usage
 * @property {{kind:string, status?:number}|null} failure
 */

export function unavailable({ kind, config, attempts = 0, latencyMs = null }) {
  return {
    schema: GATE_SCHEMA,
    decision: DECISIONS.UNAVAILABLE,
    rule: null,
    trace: [],
    signals: null,
    thresholds: config.thresholds,
    model: null,
    requestedModel: config.model,
    latencyMs,
    attempts,
    usage: null,
    failure: { kind },
  }
}

/**
 * @param {{ text: unknown, apiKey?: string, config: ReturnType<import('./config.js').resolveConfig>, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>, now?: () => number, onFailure?: (err: JevError) => void }} input
 * @returns {Promise<{ invalid: 'not_text'|'empty'|'too_long' } | GateResult>}
 */
export async function runGate({ text, apiKey, config, fetchImpl, sleep, now, onFailure }) {
  const checked = validateSubmission(text, { maxChars: config.maxChars })
  if (!checked.ok) return { invalid: checked.reason }
  if (!apiKey) return unavailable({ kind: 'configuration', config })

  try {
    const jev = await classifyWithJev({
      text: checked.text,
      apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
      deadlineMs: config.deadlineMs,
      maxAttempts: config.maxAttempts,
      fetchImpl,
      sleep,
      now,
    })
    const verdict = decide(jev.signals, config.thresholds)
    return {
      schema: GATE_SCHEMA,
      decision: verdict.decision,
      rule: verdict.rule,
      trace: verdict.trace,
      signals: jev.signals,
      thresholds: config.thresholds,
      model: jev.model,
      requestedModel: config.model,
      latencyMs: jev.latencyMs,
      attempts: jev.attempts,
      usage: jev.usage,
      failure: null,
    }
  } catch (err) {
    const e = err instanceof JevError ? err : new JevError('network')
    onFailure?.(e)
    return unavailable({ kind: PUBLIC_KIND[e.kind] || 'provider_error', config, attempts: e.attempts, latencyMs: e.latencyMs })
  }
}
