// Jev gate configuration: every tunable in one place.
//
// The thresholds are PROVISIONAL. They were set by judgement to favour letting
// a visitor through, and have not been calibrated against real submissions.
// Calibrate them (and the questions in questions.js) before relying on BLOCK.
//
// Overrides come from Worker variables (see resolveConfig); anything missing or
// out of range falls back to the default, so a typo can never disable a guard.

/** The official TypeSafe AI endpoint. Not configurable: the key must only reach this host. */
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

export const DEFAULTS = Object.freeze({
  model: 'jev-latest',
  /** Server-side input ceiling (characters). The page's own composer limit is lower. */
  maxChars: 2000,
  /** Per-attempt timeout. */
  timeoutMs: 6000,
  /** Total time across attempts, including back-off. */
  deadlineMs: 12000,
  /** Attempts per classification; only 429, 529, 5xx, timeouts and network errors are retried. */
  maxAttempts: 2,
  thresholds: Object.freeze({
    /** BLOCK for spam needs spam >= spamBlock AND intent <= spamIntentCeiling. */
    spamBlock: 0.9,
    spamIntentCeiling: 0.5,
    /** BLOCK for irrelevance needs irrelevance >= irrelevanceBlock AND intent <= irrelevanceIntentCeiling. */
    irrelevanceBlock: 0.9,
    irrelevanceIntentCeiling: 0.4,
  }),
})

function number(raw, fallback, { min, max, integer = false }) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return integer ? Math.trunc(n) : n
}

/**
 * @param {Record<string, unknown>} [env]  Worker environment (vars and secrets)
 */
export function resolveConfig(env = {}) {
  const d = DEFAULTS
  const model = typeof env.JEV_MODEL === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(env.JEV_MODEL.trim()) ? env.JEV_MODEL.trim() : d.model
  const timeoutMs = number(env.GATE_TIMEOUT_MS, d.timeoutMs, { min: 500, max: 30000, integer: true })
  const t = d.thresholds
  return {
    model,
    maxChars: number(env.GATE_MAX_CHARS, d.maxChars, { min: 1, max: 20000, integer: true }),
    timeoutMs,
    deadlineMs: number(env.GATE_DEADLINE_MS, Math.max(d.deadlineMs, timeoutMs), { min: timeoutMs, max: 60000, integer: true }),
    maxAttempts: number(env.GATE_MAX_ATTEMPTS, d.maxAttempts, { min: 1, max: 3, integer: true }),
    thresholds: {
      spamBlock: number(env.GATE_SPAM_BLOCK, t.spamBlock, { min: 0, max: 1 }),
      spamIntentCeiling: number(env.GATE_SPAM_INTENT_CEILING, t.spamIntentCeiling, { min: 0, max: 1 }),
      irrelevanceBlock: number(env.GATE_IRRELEVANCE_BLOCK, t.irrelevanceBlock, { min: 0, max: 1 }),
      irrelevanceIntentCeiling: number(env.GATE_IRRELEVANCE_INTENT_CEILING, t.irrelevanceIntentCeiling, { min: 0, max: 1 }),
    },
  }
}
