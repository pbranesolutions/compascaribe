// The shape of the first reply, and the server's check that a model response
// really has it. Pure functions shared by the Worker, the browser client and
// the tests; nothing here talks to a model.
//
// The model is constrained to OPENING_SCHEMA by structured output, but a
// schema cannot say "one question", "short", or "no flattery", so validateOpening
// holds the result to those too. A response that fails is never shown.

export const OPENING_SCHEMA_ID = 'compascaribe.conversation/1'

export const DESCRIBES = Object.freeze(['problem', 'opportunity', 'outcome', 'solution', 'unclear'])

/**
 * JSON Schema for structured output. Field order is generation order: the model
 * settles what was described and what is uncertain before it writes what the
 * visitor will read. Length limits are not expressible in structured-output
 * schemas; validateOpening enforces them.
 */
export const OPENING_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    describes: { type: 'string', enum: [...DESCRIBES] },
    uncertainty: { type: 'string' },
    reflection: { type: 'string' },
    question: { type: 'string' },
  },
  required: ['describes', 'uncertainty', 'reflection', 'question'],
  additionalProperties: false,
})

/** Bounds the display relies on: the interface fits (and pages) text within these. */
export const OPENING_LIMITS = Object.freeze({
  reflectionWords: { min: 3, max: 60 },
  questionWords: { min: 3, max: 45 },
  totalWords: 90,
  reflectionChars: 420,
  questionChars: 280,
  uncertaintyChars: 240,
})

const PRAISE = /^\W*(great|excellent|wonderful|fantastic|awesome|amazing|brilliant|love|what an? (great|good|excellent|wonderful|fascinating|interesting)|that('| i)?s (a |an )?(great|good|excellent|wonderful|fantastic|brilliant|smart|interesting|fascinating)|how (great|exciting|wonderful)|qué (buena|gran|excelente|interesante)|excelente|genial|estupend[oa]|fant[aá]stic[oa]|maravillos[oa])\b/i
const GREETING = /^\W*(hi|hello|hey|greetings|welcome|thanks|thank you|dear|hola|buen[oa]s|bienvenid[oa]|gracias|saludos)\b/i
const MARKUP = /[`*#]|^\s*([-•>]|\d+[.)])\s/m
// A second question joined to the first ("..., and what would change?") is still two questions.
const COMPOUND = /\s(and|y)\s+(what|which|who|whom|whose|how|when|where|why|would|could|should|do|does|did|is|are|was|were|can|will|qué|cuál|cuáles|quién|quiénes|cómo|cuándo|dónde|cuánto|cuántos|por qué)\b/i
// What a complete question's main clause starts with.
const QUESTION_LEAD = /^(what|which|who|whom|whose|how|when|where|why|do|does|did|is|are|was|were|can|could|would|should|will|have|has|qué|cuál|cuáles|quién|quiénes|cómo|cuándo|dónde|cuánto|cuántos|por qué)\b/i
const ABBREVIATION = /\b(e\.g|i\.e|etc|vs|approx|mr|mrs|ms|dr|no)\./gi

const tidy = s => s.replace(/\s+/g, ' ').trim()
const words = s => (s ? s.split(' ').length : 0)

/**
 * @param {unknown} raw  the parsed JSON the model returned
 * @returns {{ ok: true, repaired: string|null, opening: { describes: string, uncertainty: string, reflection: string, question: string } } | { ok: false, reason: string }}
 */
export function validateOpening(raw) {
  const fail = reason => ({ ok: false, reason })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('shape')
  const { describes, uncertainty, reflection, question } = raw
  if (typeof describes !== 'string' || typeof uncertainty !== 'string' || typeof reflection !== 'string' || typeof question !== 'string') return fail('shape')
  if (!DESCRIBES.includes(describes)) return fail('describes')

  const r = tidy(reflection)
  let q = tidy(question)
  const L = OPENING_LIMITS
  if (words(r) < L.reflectionWords.min) return fail('reflection_missing')
  if (words(q) < L.questionWords.min) return fail('question_missing')

  // Exactly one question, and it is the question part: not hidden in the reflection, not doubled.
  if (r.includes('?') || r.includes('¿')) return fail('reflection_is_question')
  if (!q.endsWith('?')) return fail('question_form')
  if ((q.match(/\?/g) || []).length !== 1 || (q.match(/¿/g) || []).length > 1) return fail('two_questions')
  const flat = s => s.slice(0, -1).replace(ABBREVIATION, m => m.replace(/\./g, ''))
  if (/[.!;]\s+\S/.test(flat(q)) || /[.!;]$/.test(flat(q))) return fail('two_questions')

  // One known way a second question gets in: ", and what would change?" tacked on. When what comes
  // before it is itself a complete question, that is the question; the surplus clause is dropped,
  // nothing is added. Anything less clear-cut is refused.
  let repaired = null
  const asked = q.slice(0, -1)
  const join = COMPOUND.exec(asked)
  if (join) {
    const head = asked.slice(0, join.index).replace(/[\s,;:]+$/, '')
    // The clause that is kept must itself be a question: its main clause (after any leading "If ...,") opens like one.
    const lead = head.replace(/^¿\s*/, '')
    const main = (lead.includes(',') ? lead.slice(lead.lastIndexOf(',') + 1) : lead).trim()
    if (words(head) >= L.questionWords.min && QUESTION_LEAD.test(main) && !COMPOUND.test(head)) {
      q = `${head}?`
      repaired = 'compound_question'
    } else {
      return fail('two_questions')
    }
  }

  if (words(r) > L.reflectionWords.max || words(q) > L.questionWords.max || words(r) + words(q) > L.totalWords) return fail('too_long')
  if (r.length > L.reflectionChars || q.length > L.questionChars) return fail('too_long')

  if (GREETING.test(r)) return fail('greeting')
  if (PRAISE.test(r)) return fail('praise')
  if (/!/.test(r) || /!/.test(q)) return fail('exclamation')
  if (MARKUP.test(r) || MARKUP.test(q)) return fail('markup')

  return { ok: true, repaired, opening: { describes, uncertainty: tidy(uncertainty).slice(0, L.uncertaintyChars), reflection: r, question: q } }
}
