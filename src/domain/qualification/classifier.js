// Simulated qualification (the Jev boundary).
//
// Production shape: `qualify(submission) -> Promise<Qualification>` backed by
// Jev. The simulated implementation is deterministic and runs in the browser.
// The UI never reads `score` or `signals`; they exist for diagnostics and for
// the model-routing heuristic.

import { analyze } from './analyze.js'

/** Four tiers, as specified. Numbers are stable identifiers. */
export const TIERS = Object.freeze({
  NOT_RELEVANT: 1,
  PROBABLY_NOT: 2,
  PROBABLY: 3,
  RELEVANT: 4,
})

export const TIER_LABELS = Object.freeze({
  1: 'definitely-not-relevant',
  2: 'probably-not-relevant',
  3: 'probably-relevant',
  4: 'definitely-relevant',
})

/**
 * @typedef {Object} Qualification
 * @property {1|2|3|4} tier
 * @property {string} label
 * @property {number} confidence       0..1, how far from the nearest boundary
 * @property {string} reason           machine-readable primary reason
 * @property {{positive:number, negative:number}} score
 * @property {import('./analyze.js').Features} features
 */

const cap = (n, max) => Math.min(n, max)

/**
 * Synchronous scoring used by the simulated provider.
 * @param {string} text
 * @returns {Qualification}
 */
export function classify(text) {
  const f = analyze(text)

  const positive =
    2 * cap(f.build.length, 2) +
    2 * cap(f.artifacts.length, 2) +
    1.5 * cap(f.operations.length, 3) +
    1.5 * cap(f.pains.length, 3) +
    1 * cap(f.outcomes.length, 2) +
    0.5 * cap(f.scale.length, 2) +
    (f.domain ? 1 : 0) +
    (f.actors.length ? 0.5 : 0) +
    (f.operations.length && f.pains.length ? 1.5 : 0) +
    (f.purpose ? 1 : 0)

  const n = f.negatives
  const negative =
    (n.offTopic ? 4 : 0) +
    (n.jobSeeking ? 4 : 0) +
    (n.vendorPitch ? 4 : 0) +
    (n.vendorPitchWeak ? 1.5 : 0) +
    (n.support ? 3 : 0) +
    (n.injection ? 20 : 0) +
    (n.greeting ? 3 : 0)

  let tier
  let reason
  if (n.injection) {
    tier = TIERS.NOT_RELEVANT
    reason = 'instruction-injection'
  } else if (f.gibberish) {
    tier = TIERS.NOT_RELEVANT
    reason = 'unintelligible'
  } else if (n.greeting) {
    tier = TIERS.NOT_RELEVANT
    reason = 'greeting-only'
  } else if (f.tooShort) {
    tier = positive > 0 ? TIERS.PROBABLY_NOT : TIERS.NOT_RELEVANT
    reason = 'too-short'
  } else if (negative >= 3 && positive < negative + 3) {
    tier = TIERS.NOT_RELEVANT
    reason = n.vendorPitch ? 'vendor-pitch' : n.jobSeeking ? 'job-seeking' : n.support ? 'support-request' : 'off-topic'
  } else if (negative >= 3) {
    // Mixed signals: real project language alongside something off-topic.
    tier = TIERS.PROBABLY_NOT
    reason = 'mixed-signals'
  } else if (positive >= 6.5 && f.substance) {
    tier = TIERS.RELEVANT
    reason = 'clear-project'
  } else if (positive >= 2.5 && f.substance) {
    tier = TIERS.PROBABLY
    reason = 'plausible-project'
  } else if (positive >= 2.5) {
    tier = TIERS.PROBABLY_NOT
    reason = 'no-subject'
  } else {
    tier = TIERS.PROBABLY_NOT
    reason = 'unclear'
  }

  // Confidence: distance from the nearest decision boundary, squashed to 0..1.
  const boundaries = [2.5, 6.5]
  const dist = Math.min(...boundaries.map(b => Math.abs(positive - b)))
  let confidence = Math.max(0.35, Math.min(0.98, 0.5 + dist / 6))
  if (reason === 'instruction-injection' || reason === 'unintelligible' || reason === 'greeting-only') confidence = 0.97
  if (reason === 'mixed-signals' || reason === 'too-short') confidence = 0.45

  return {
    tier,
    label: TIER_LABELS[tier],
    confidence: Number(confidence.toFixed(2)),
    reason,
    score: { positive: Number(positive.toFixed(1)), negative },
    features: f,
  }
}

/**
 * Async boundary that a Jev-backed implementation will replace.
 * @param {{text:string}} submission
 * @returns {Promise<Qualification>}
 */
export async function qualify(submission) {
  return classify(submission.text)
}
