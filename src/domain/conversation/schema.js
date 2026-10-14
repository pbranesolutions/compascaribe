// The shape of the first reply, and the server's check that a model response
// really has it. Pure functions shared by the Worker, the browser client and
// the tests; nothing here talks to a model.
//
// The model is constrained to OPENING_SCHEMA by structured output, but a
// schema cannot say "one question", "short", or "no flattery", so validateOpening
// holds the result to those too. A response that fails is never shown.
//
// The same tone and question rules hold every later turn (turn.js builds on the
// primitives exported here), so the agent speaks with one standard throughout.

export const OPENING_SCHEMA_ID = 'compascaribe.conversation/1'

export const DESCRIBES = Object.freeze(['problem', 'opportunity', 'outcome', 'solution', 'unclear'])

/** What the question is about: the parts of a project's purpose, in the order they are usually easiest to answer. */
export const EXPLORES = Object.freeze(['situation', 'people', 'outcome', 'stakes'])

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
    explores: { type: 'string', enum: [...EXPLORES] },
    reflection: { type: 'string' },
    question: { type: 'string' },
  },
  required: ['describes', 'uncertainty', 'explores', 'reflection', 'question'],
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
// An interrogative word after "and", or an auxiliary followed by its subject ("and would they ...");
// "and could not" or "and did nothing" continue the same clause and are left alone.
// (\b is ASCII-only, so after "qué" it finds no boundary: the end of a word is tested as "no letter follows".)
const COMPOUND = /\s(and|y)\s+((what|which|who|whom|whose|how|when|where|why|qué|cuál|cuáles|quién|quiénes|cómo|cuándo|dónde|cuánto|cuántos|por qué)(?![\p{L}\p{N}_])|(would|could|should|do|does|did|is|are|was|were|can|will)\s+(you|they|we|it|he|she|i|the|your|their|that|this|those|these|there|anyone|someone|everyone)(?![\p{L}\p{N}_]))/iu
// What a complete question's main clause starts with.
const QUESTION_LEAD = /^(what|which|who|whom|whose|how|when|where|why|do|does|did|is|are|was|were|can|could|would|should|will|have|has|qué|cuál|cuáles|quién|quiénes|cómo|cuándo|dónde|cuánto|cuántos|por qué)(?![\p{L}\p{N}_])/iu
// Encouragement is as unwelcome as praise, but it usually arrives as its own sentence, which can simply go.
const ENCOURAGEMENT = /\b(that('| i)?s|this is|it is|it's) (a |an )?(good|great|nice|solid|smart|wise|common|natural|useful|worthwhile|right)\b|\b(good|great|right) (place|start|idea|move|call|step|question|goal|instinct)\b|\bcommon (challenge|problem|issue|pain|struggle)\b|\bright track\b|\bwell worth\b/i
const ABBREVIATION = /\b(e\.g|i\.e|etc|vs|approx|mr|mrs|ms|dr|no)\./gi

export const tidy = s => s.replace(/\s+/g, ' ').trim()
export const wordCount = s => (s ? s.split(' ').length : 0)
const words = wordCount

/** Splits tidied prose into sentences without breaking on abbreviations. */
export function sentencesOf(text) {
  const protectedText = text.replace(ABBREVIATION, m => m.replace(/\./g, '\u0001'))
  return protectedText.split(/(?<=[.!?…])\s+/).map(s => s.replace(/\u0001/g, '.')).filter(Boolean)
}

/**
 * Drops sentences of encouragement from a (tidied) reflection. A reflection that
 * is nothing but encouragement is refused.
 *
 * @returns {{ ok: true, text: string, repaired: boolean } | { ok: false, reason: 'praise' }}
 */
export function withoutEncouragement(reflection) {
  const sentences = reflection.split(/(?<=[.!?…])\s+/)
  const kept = sentences.filter(x => !ENCOURAGEMENT.test(x))
  if (kept.length === sentences.length) return { ok: true, text: reflection, repaired: false }
  if (!kept.length) return { ok: false, reason: 'praise' }
  return { ok: true, text: kept.join(' '), repaired: true }
}

/**
 * Exactly one question, and a clean one: ends in one question mark, no second
 * sentence. One known way a second question gets in is ", and what would
 * change?" tacked on; when what precedes it is itself a complete question, that
 * is the question and the surplus clause is dropped (nothing is added).
 * Anything less clear-cut is refused.
 *
 * @param {string} question  tidied
 * @param {{ minWords: number }} limits
 * @returns {{ ok: true, question: string, repaired: boolean } | { ok: false, reason: 'question_form'|'two_questions' }}
 */
export function oneQuestion(question, { minWords }) {
  const fail = reason => ({ ok: false, reason })
  let q = question
  if (!q.endsWith('?')) return fail('question_form')
  if ((q.match(/\?/g) || []).length !== 1 || (q.match(/¿/g) || []).length > 1) return fail('two_questions')
  const flat = s => s.slice(0, -1).replace(ABBREVIATION, m => m.replace(/\./g, ''))
  if (/[.!;]\s+\S/.test(flat(q)) || /[.!;]$/.test(flat(q))) return fail('two_questions')

  let repaired = false
  const asked = q.slice(0, -1)
  const join = COMPOUND.exec(asked)
  if (join) {
    const head = asked.slice(0, join.index).replace(/[\s,;:]+$/, '')
    // The clause that is kept must itself be a question: its main clause (after any leading "If ...," or "Think of the last time:") opens like one.
    const lead = head.replace(/^¿\s*/, '')
    const main = lead.slice(Math.max(lead.lastIndexOf(','), lead.lastIndexOf(':')) + 1).trim()
    if (words(head) >= minWords && QUESTION_LEAD.test(main) && !COMPOUND.test(head)) {
      q = `${head}?`
      repaired = true
    } else {
      return fail('two_questions')
    }
  }
  return { ok: true, question: q, repaired }
}

/**
 * Tone: no greeting, no praise, no exclamation, no markup. Greeting and praise
 * are opening words of the reflection; the others hold anywhere.
 *
 * @returns {'greeting'|'praise'|'exclamation'|'markup'|null}
 */
export function toneProblem(reflection, ...others) {
  if (GREETING.test(reflection)) return 'greeting'
  if (PRAISE.test(reflection)) return 'praise'
  const all = [reflection, ...others]
  if (all.some(s => /!/.test(s))) return 'exclamation'
  if (all.some(s => MARKUP.test(s))) return 'markup'
  return null
}

/**
 * @param {unknown} raw  the parsed JSON the model returned
 * @returns {{ ok: true, repaired: string|null, opening: { describes: string, uncertainty: string, explores: string, reflection: string, question: string } } | { ok: false, reason: string }}
 */
export function validateOpening(raw) {
  const fail = reason => ({ ok: false, reason })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('shape')
  const { describes, uncertainty, explores, reflection, question } = raw
  if (typeof describes !== 'string' || typeof uncertainty !== 'string' || typeof explores !== 'string' || typeof reflection !== 'string' || typeof question !== 'string') return fail('shape')
  if (!DESCRIBES.includes(describes)) return fail('describes')
  if (!EXPLORES.includes(explores)) return fail('explores')

  let r = tidy(reflection)
  let q = tidy(question)
  const L = OPENING_LIMITS
  const repairs = []
  const dropped = withoutEncouragement(r)
  if (!dropped.ok) return fail(dropped.reason)
  if (dropped.repaired) {
    r = dropped.text
    repairs.push('encouragement')
  }
  if (words(r) < L.reflectionWords.min) return fail('reflection_missing')
  if (words(q) < L.questionWords.min) return fail('question_missing')

  // Exactly one question, and it is the question part: not hidden in the reflection, not doubled.
  if (r.includes('?') || r.includes('¿')) return fail('reflection_is_question')
  const single = oneQuestion(q, { minWords: L.questionWords.min })
  if (!single.ok) return fail(single.reason)
  if (single.repaired) {
    q = single.question
    repairs.push('compound_question')
  }

  if (words(r) > L.reflectionWords.max || words(q) > L.questionWords.max || words(r) + words(q) > L.totalWords) return fail('too_long')
  if (r.length > L.reflectionChars || q.length > L.questionChars) return fail('too_long')

  const tone = toneProblem(r, q)
  if (tone) return fail(tone)

  return { ok: true, repaired: repairs.length ? repairs.join('+') : null, opening: { describes, uncertainty: tidy(uncertainty).slice(0, L.uncertaintyChars), explores, reflection: r, question: q } }
}
