// First-conversation configuration: every tunable in one place, server-side.
//
// Overrides come from Worker variables (wrangler.jsonc `vars`, or `.dev.vars`
// locally). Anything missing or out of range falls back to the default, so a
// typo can never loosen a cost guard. Nothing here is read by browser code.

import { resolveConfig as resolveGateConfig } from '../gate/config.js'

export const DEFAULTS = Object.freeze({
  /** Claude Sonnet 5.5. Configurable (CONVERSATION_MODEL); there is deliberately no routing between models. */
  model: 'claude-sonnet-5-5',
  /**
   * Ceiling on generated tokens, thinking included. The reply itself is about
   * 100 tokens; the rest is headroom for reasoning, and the cap on what one
   * request can ever cost.
   */
  maxTokens: 1500,
  /** The whole model request, one attempt. */
  timeoutMs: 25000,
  /**
   * How much the model reasons before it answers. `low` is the documented
   * starting point for conversational turns on Sonnet 5.5; raise it only after
   * `npm run test:live:conversation` shows what it buys.
   */
  effort: 'low',
  /** How long a qualification stays valid. A visitor who is slower than this is re-checked, not refused. */
  qualificationTtlMs: 15 * 60 * 1000,
  /** Model requests one qualification may cause when they fail. A success is returned from memory afterwards. */
  maxAttempts: 3,
})

const EFFORTS = ['low', 'medium', 'high']

function number(raw, fallback, { min, max }) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return Math.trunc(n)
}

/** @param {Record<string, unknown>} [env]  Worker environment (vars and secrets) */
export function resolveConversationConfig(env = {}) {
  const d = DEFAULTS
  const model = typeof env.CONVERSATION_MODEL === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(env.CONVERSATION_MODEL.trim())
    ? env.CONVERSATION_MODEL.trim()
    : d.model
  const effort = typeof env.CONVERSATION_EFFORT === 'string' && EFFORTS.includes(env.CONVERSATION_EFFORT.trim())
    ? env.CONVERSATION_EFFORT.trim()
    : d.effort
  const off = typeof env.CONVERSATION_ENABLED === 'string' && ['false', '0', 'off', 'no'].includes(env.CONVERSATION_ENABLED.trim().toLowerCase())
  return {
    enabled: !off,
    model,
    effort,
    maxTokens: number(env.CONVERSATION_MAX_TOKENS, d.maxTokens, { min: 256, max: 4000 }),
    timeoutMs: number(env.CONVERSATION_TIMEOUT_MS, d.timeoutMs, { min: 2000, max: 60000 }),
    qualificationTtlMs: number(env.CONVERSATION_QUALIFICATION_TTL_MS, d.qualificationTtlMs, { min: 60000, max: 60 * 60 * 1000 }),
    maxAttempts: number(env.CONVERSATION_MAX_ATTEMPTS, d.maxAttempts, { min: 1, max: 5 }),
    // Nothing longer than the gate accepts was ever qualified, so nothing longer is generated on.
    maxChars: resolveGateConfig(env).maxChars,
  }
}
