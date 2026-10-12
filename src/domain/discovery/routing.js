// Model routing heuristic (architectural scaffolding).
//
// Production will choose among Claude Haiku, Sonnet and Opus per request based
// on relevance, commercial opportunity, desired experience, reasoning need and
// cost. Nothing here calls a model. The simulated provider records the decision
// so the prototype notes panel can show how routing would behave.

export const MODELS = Object.freeze({
  NONE: 'none',
  HAIKU: 'claude-haiku',
  SONNET: 'claude-sonnet',
  OPUS: 'claude-opus',
})

const COMPLEXITY_WORDS = /\b(integrat\w*|api|real[- ]?time|payments?|sync\w*|multi[- ]?(location|site|tenant|currency|language)|inventory|erp|accounting|quickbooks|sap|offline|gps|iot|sensors?|ai|machine learning|forecast\w*|compliance|regulat\w*|hipaa|audit)\b/i

/**
 * Estimate commercial opportunity from features. 0..3.
 * This is NOT exposed to the visitor.
 */
export function estimateOpportunity(features) {
  let score = 0
  if (features.domain) score += 1
  if (features.organization) score += 0.5
  if (features.scale.length >= 2) score += 0.5
  if (/\b\d{2,4}\b/.test(features.normalized) && /(employees|staff|locations|branches|stores|clients|customers|orders|units|members|students|patients)/.test(features.normalized)) score += 1
  if (features.operations.length >= 2) score += 0.5
  return Math.min(3, score)
}

/** Reasoning complexity, 0..3. */
export function estimateComplexity(features) {
  let score = 0
  const hits = features.raw.match(COMPLEXITY_WORDS) || []
  score += Math.min(2, hits.length * 0.5)
  if (features.operations.length >= 3) score += 0.5
  if (features.wordCount > 60) score += 0.5
  return Math.min(3, score)
}

/**
 * @param {{tier:number, features:Object, stage:'open'|'next'|'compose'|'refine'}} input
 * @returns {{model:string, reason:string, opportunity:number, complexity:number}}
 */
export function routeModel({ tier, features, stage }) {
  const opportunity = estimateOpportunity(features)
  const complexity = estimateComplexity(features)

  if (tier <= 2) {
    return { model: MODELS.NONE, reason: 'Below relevance threshold: classification-only, no generative inference.', opportunity, complexity }
  }

  if (stage === 'compose' || stage === 'refine') {
    if (opportunity >= 2) return { model: MODELS.OPUS, reason: 'Statement for a commercially attractive project: premium experience justified.', opportunity, complexity }
    return { model: MODELS.SONNET, reason: 'Statement composition needs synthesis; Sonnet balances quality and cost.', opportunity, complexity }
  }

  if (tier === 4 && opportunity >= 2) {
    return { model: MODELS.SONNET, reason: 'Clear project with commercial signals: invest in discovery quality.', opportunity, complexity }
  }
  if (tier === 4 && complexity >= 2) {
    return { model: MODELS.SONNET, reason: 'Clear project with reasoning complexity; Sonnet for discovery steps.', opportunity, complexity }
  }
  return { model: MODELS.HAIKU, reason: 'Plausible project, modest opportunity: keep discovery inexpensive until commitment grows.', opportunity, complexity }
}
