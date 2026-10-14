// The decision: explicit, deterministic, independent of the UI and of Jev.
//
// Input is the three probabilities Jev returned (0..1, probability of "yes").
// Rules are evaluated in order and the first that is met decides; if none is
// met the submission PROCEEDs. There is deliberately no rule that blocks on low
// intent alone: a brief, vague or unusual description is not evidence of
// irrelevance, and conflicting signals (for example high spam and high intent)
// resolve in the visitor's favour.
//
// Thresholds live in config.js and are provisional until calibrated.

export const DECISIONS = Object.freeze({ PROCEED: 'PROCEED', BLOCK: 'BLOCK', UNAVAILABLE: 'UNAVAILABLE' })

const f = n => n.toFixed(3)

/**
 * @typedef {{ intent: number, irrelevance: number, spam: number }} Signals
 * @typedef {{ id: string, label: string, met: boolean, parts: Array<{ text: string, ok: boolean }> }} RuleTrace
 */

/**
 * @param {Signals} signals
 * @param {import('./config.js').DEFAULTS['thresholds']} t
 * @returns {{ decision: 'PROCEED' | 'BLOCK', rule: string, trace: RuleTrace[] }}
 */
export function decide(signals, t) {
  const { intent, irrelevance, spam } = signals
  const rules = [
    {
      id: 'block.spam',
      label: 'Spam or meaningless input',
      parts: [
        { text: `spam ${f(spam)} ≥ ${f(t.spamBlock)}`, ok: spam >= t.spamBlock },
        { text: `intent ${f(intent)} ≤ ${f(t.spamIntentCeiling)}`, ok: intent <= t.spamIntentCeiling },
      ],
    },
    {
      id: 'block.irrelevance',
      label: 'Clear irrelevance',
      parts: [
        { text: `irrelevance ${f(irrelevance)} ≥ ${f(t.irrelevanceBlock)}`, ok: irrelevance >= t.irrelevanceBlock },
        { text: `intent ${f(intent)} ≤ ${f(t.irrelevanceIntentCeiling)}`, ok: intent <= t.irrelevanceIntentCeiling },
      ],
    },
  ]
  const trace = rules.map(r => ({ ...r, met: r.parts.every(p => p.ok) }))
  const hit = trace.find(r => r.met)
  return hit
    ? { decision: DECISIONS.BLOCK, rule: hit.id, trace }
    : { decision: DECISIONS.PROCEED, rule: 'proceed.default', trace }
}
