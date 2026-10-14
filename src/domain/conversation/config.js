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

  // --- the conversation after the first reply ---------------------------------------
  /**
   * Replies the agent writes in one conversation, the opening included. This is
   * the inference budget: it bounds what one qualification can cost, and the
   * final reply is always the statement, so a visitor who reaches it still gets
   * somewhere. It is a cost ceiling, not a target: most conversations end sooner.
   */
  maxReplies: 10,
  /** From this many replies the agent is told to draw the conversation to a close unless something essential reopened. */
  convergeAfter: 6,
  /** The visitor's answer, in characters. Same room as the first description in the interface. */
  replyMaxChars: 480,
  /** Follow-up turns weigh a whole conversation and decide when it is understood, so they reason a little more than the opening. */
  turnEffort: 'medium',
  /** Ceiling on generated tokens for a follow-up, thinking and the understanding included. */
  turnMaxTokens: 3000,
  /**
   * Extra requests a follow-up may make when the model's reply fails the checks that run before a visitor
   * sees it (and only then; never for a refusal, a timeout or a transport failure). Mid-conversation, a
   * visible failure costs the visitor far more than one more request costs us.
   */
  turnRepairs: 1,
  /** The whole follow-up request, one attempt. */
  turnTimeoutMs: 40000,
  /** How long the renewed qualification that comes with each reply stays valid: a visitor may think for a while. */
  sessionTtlMs: 30 * 60 * 1000,
  /** The longest a conversation may run from its first qualification, however many replies it has. */
  sessionMaxMs: 3 * 60 * 60 * 1000,
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
    maxReplies: number(env.CONVERSATION_MAX_REPLIES, d.maxReplies, { min: 2, max: 16 }),
    convergeAfter: number(env.CONVERSATION_CONVERGE_AFTER, d.convergeAfter, { min: 2, max: 14 }),
    replyMaxChars: number(env.CONVERSATION_REPLY_MAX_CHARS, d.replyMaxChars, { min: 80, max: 1000 }),
    turnEffort: typeof env.CONVERSATION_TURN_EFFORT === 'string' && EFFORTS.includes(env.CONVERSATION_TURN_EFFORT.trim())
      ? env.CONVERSATION_TURN_EFFORT.trim()
      : d.turnEffort,
    turnMaxTokens: number(env.CONVERSATION_TURN_MAX_TOKENS, d.turnMaxTokens, { min: 512, max: 8000 }),
    turnRepairs: number(env.CONVERSATION_TURN_REPAIRS, d.turnRepairs, { min: 0, max: 1 }),
    turnTimeoutMs: number(env.CONVERSATION_TURN_TIMEOUT_MS, d.turnTimeoutMs, { min: 2000, max: 90000 }),
    sessionTtlMs: number(env.CONVERSATION_SESSION_TTL_MS, d.sessionTtlMs, { min: 60000, max: 2 * 60 * 60 * 1000 }),
    sessionMaxMs: number(env.CONVERSATION_SESSION_MAX_MS, d.sessionMaxMs, { min: 5 * 60 * 1000, max: 12 * 60 * 60 * 1000 }),
    // Nothing longer than the gate accepts was ever qualified, so nothing longer is generated on.
    maxChars: resolveGateConfig(env).maxChars,
  }
}
