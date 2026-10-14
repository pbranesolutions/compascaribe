// The shape of every reply after the first, and the server's check that a model
// response really has it. Pure functions shared by the Worker, the browser
// client and the tests; nothing here talks to a model.
//
// A turn is the agent's whole move: what it read in the visitor's latest
// message, how its understanding of the project changed, why it is asking (or
// not), and then either one more question or the project's purpose stated for
// the visitor to confirm. The understanding travels with the conversation (the
// browser keeps it and sends it back), so each turn builds on the last without
// the server holding any state.
//
// The understanding is structured so that investigating one detail cannot
// silently narrow the project: every distinct objective the visitor named is
// kept as its own entry until they drop it, and the examples and incidents that
// illustrate an objective are kept apart from the objectives themselves.
//
// As with the opening, a schema cannot say "one question" or "no flattery", so
// validateTurn holds the result to those too. A response that fails is never shown.

import { oneQuestion, sentencesOf, tidy, toneProblem, withoutEncouragement, wordCount } from './schema.js'

export const TURN_SCHEMA_ID = 'compascaribe.conversation/2'

/** What the visitor's latest message did, as the agent read it. */
export const READINGS = Object.freeze(['answers', 'adds', 'changes', 'contradicts', 'unsure', 'asks', 'diversion', 'corrects'])

/** The agent's move: ask one more question, or state the purpose. */
export const MOVES = Object.freeze(['ask', 'statement'])

/** The parts of a purpose, as a map of how well each is established. Not a sequence. */
export const COVERAGE_KEYS = Object.freeze(['problem', 'beneficiaries', 'outcome', 'value', 'success'])
export const COVERAGE_LEVELS = Object.freeze(['unknown', 'partial', 'clear'])

/**
 * The lists that make up the understanding, with how many entries each keeps.
 * The bounds keep what travels with every request small; the order is the
 * order the model fills them in.
 *
 * - objectives: every distinct thing the visitor said the project is for. The scope.
 * - dropped: objectives the visitor explicitly removed, so they are not re-added or restated.
 * - beneficiaries: who it is for, and who is affected.
 * - outcomes: the changes that would matter, in their words.
 * - evidence: specific incidents, examples, numbers and quotes. Illustrations of an objective, never objectives themselves.
 * - inferred: the agent's readings the visitor has not confirmed.
 * - open: what is still not known that matters for stating the purpose, most consequential first.
 */
export const UNDERSTANDING_LISTS = Object.freeze({ objectives: 6, dropped: 4, beneficiaries: 4, outcomes: 5, evidence: 6, inferred: 4, open: 4 })

const stringList = { type: 'array', items: { type: 'string' } }

/**
 * JSON Schema for structured output. Field order is generation order: the
 * model settles how it read the message, what it now understands about the
 * whole project and why it would ask (or not) before it decides the move and
 * writes what the visitor will read.
 */
export const TURN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    reading: { type: 'string', enum: [...READINGS] },
    understanding: {
      type: 'object',
      properties: {
        purpose: { type: 'string' },
        ...Object.fromEntries(Object.keys(UNDERSTANDING_LISTS).map(k => [k, stringList])),
        coverage: {
          type: 'object',
          properties: Object.fromEntries(COVERAGE_KEYS.map(k => [k, { type: 'string', enum: [...COVERAGE_LEVELS] }])),
          required: [...COVERAGE_KEYS],
          additionalProperties: false,
        },
      },
      required: ['purpose', ...Object.keys(UNDERSTANDING_LISTS), 'coverage'],
      additionalProperties: false,
    },
    rationale: { type: 'string' },
    move: { type: 'string', enum: [...MOVES] },
    reflection: { type: 'string' },
    question: { type: 'string' },
    statement: { type: 'string' },
  },
  required: ['reading', 'understanding', 'rationale', 'move', 'reflection', 'question', 'statement'],
  additionalProperties: false,
})

/** Bounds the display relies on: the interface fits (and pages) text within these. */
export const TURN_LIMITS = Object.freeze({
  /** A reflection is optional when the agent asks: a question that stands on its own is better than a paraphrase. */
  reflectionWords: { min: 3, max: 55 },
  questionWords: { min: 3, max: 40 },
  /** A statement's confirming question is short: the statement is the content. */
  confirmWords: { min: 3, max: 30 },
  /** A statement that keeps several objectives needs a little more room than one that keeps one. */
  statementWords: { min: 6, max: 85 },
  statementSentences: 4,
  totalWords: 95,
  reflectionChars: 380,
  questionChars: 260,
  statementChars: 520,
  purposeChars: 320,
  rationaleChars: 400,
  itemChars: 220,
})

const words = wordCount

function cleanList(value, max, chars) {
  if (!Array.isArray(value)) return null
  const out = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') return null
    const t = tidy(item).slice(0, chars)
    const key = t.toLowerCase()
    if (!t || seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/**
 * Tolerant read of an understanding object (the model's, or one the browser
 * sends back): lists are bounded and tidied, coverage is checked. Anything that
 * does not have the shape yields null rather than a guess; a browser holding an
 * understanding of an earlier shape therefore sends nothing, and the agent
 * rebuilds it from the conversation.
 *
 * @returns {{ purpose: string, objectives: string[], dropped: string[], beneficiaries: string[], outcomes: string[], evidence: string[], inferred: string[], open: string[], coverage: Record<string, string> } | null}
 */
export function normalizeUnderstanding(raw) {
  const L = TURN_LIMITS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.purpose !== 'string') return null
  const out = { purpose: tidy(raw.purpose).slice(0, L.purposeChars) }
  for (const [name, max] of Object.entries(UNDERSTANDING_LISTS)) {
    const list = cleanList(raw[name], max, L.itemChars)
    if (!list) return null
    out[name] = list
  }
  const cov = raw.coverage
  if (!cov || typeof cov !== 'object') return null
  const coverage = {}
  for (const k of COVERAGE_KEYS) {
    if (!COVERAGE_LEVELS.includes(cov[k])) return null
    coverage[k] = cov[k]
  }
  out.coverage = coverage
  return out
}

/** Words that carry a question's meaning, for noticing a question asked twice. */
const contentWords = s => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []))

/** True when two questions say (nearly) the same thing in the same words. */
export function sameQuestion(a, b) {
  const x = contentWords(a)
  const y = contentWords(b)
  if (!x.size || !y.size) return false
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / Math.min(x.size, y.size) >= 0.85 && shared / Math.max(x.size, y.size) >= 0.7
}

/**
 * @param {unknown} raw  the parsed JSON the model returned
 * @param {{ final?: boolean, previousQuestions?: string[] }} [options]
 *   final: the conversation's budget is spent, so the purpose must be stated now
 *   previousQuestions: what was already asked, so a question is never asked twice
 * @returns {{ ok: true, repaired: string|null, turn: { reading: string, understanding: object, rationale: string, move: string, reflection: string, question: string, statement: string } } | { ok: false, reason: string }}
 */
export function validateTurn(raw, { final = false, previousQuestions = [] } = {}) {
  const fail = reason => ({ ok: false, reason })
  const L = TURN_LIMITS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('shape')
  const { reading, understanding: rawUnderstanding, rationale, move, reflection, question, statement } = raw
  if (typeof reading !== 'string' || typeof move !== 'string' || typeof reflection !== 'string' || typeof question !== 'string' || typeof statement !== 'string') return fail('shape')
  if (rationale !== undefined && typeof rationale !== 'string') return fail('shape')
  if (!READINGS.includes(reading)) return fail('reading')
  if (!MOVES.includes(move)) return fail('move')
  const understanding = normalizeUnderstanding(rawUnderstanding)
  if (!understanding) return fail('understanding')
  if (final && move !== 'statement') return fail('not_final')

  const repairs = []
  let r = tidy(reflection)
  let q = tidy(question)
  let s = tidy(statement)
  const why = tidy(rationale || '').slice(0, L.rationaleChars)

  if (r) {
    const dropped = withoutEncouragement(r)
    if (!dropped.ok) return fail(dropped.reason)
    if (dropped.repaired) {
      r = dropped.text
      repairs.push('encouragement')
    }
    if (r.includes('?') || r.includes('¿')) return fail('reflection_is_question')
  }

  if (move === 'ask') {
    // A statement alongside a question is the model hedging; the question is the move.
    if (s) {
      s = ''
      repairs.push('statement_dropped')
    }
    // The reflection may be left out; when it is there, it is at least a short sentence.
    if (r && words(r) < L.reflectionWords.min) return fail('reflection_missing')
    if (words(q) < L.questionWords.min) return fail('question_missing')
    const single = oneQuestion(q, { minWords: L.questionWords.min })
    if (!single.ok) return fail(single.reason)
    if (single.repaired) {
      q = single.question
      repairs.push('compound_question')
    }
    if (words(r) > L.reflectionWords.max || words(q) > L.questionWords.max || words(r) + words(q) > L.totalWords) return fail('too_long')
    if (r.length > L.reflectionChars || q.length > L.questionChars) return fail('too_long')
    // Asking again is right when they did not answer (they asked something, wandered, or did not know); after an answer it is not.
    const answered = !['asks', 'diversion', 'unsure'].includes(reading)
    if (answered && previousQuestions.some(p => sameQuestion(p, q))) return fail('repeats_question')
  } else {
    // The purpose, stated. Its lead-in is the statement itself; the reflection stays empty or very short.
    if (words(s) < L.statementWords.min) return fail('statement_missing')
    if (words(s) > L.statementWords.max || s.length > L.statementChars) return fail('statement_long')
    if (sentencesOf(s).length > L.statementSentences) return fail('statement_long')
    if (s.includes('?') || s.includes('¿')) return fail('statement_is_question')
    // A purpose with no objective behind it is not one: the scope the statement must cover has to be on record.
    if (!understanding.objectives.length) return fail('scope_empty')
    if (words(r) > 30) return fail('too_long')
    if (words(q) < L.confirmWords.min) return fail('question_missing')
    const single = oneQuestion(q, { minWords: L.confirmWords.min })
    if (!single.ok) return fail(single.reason)
    if (single.repaired) {
      q = single.question
      repairs.push('compound_question')
    }
    if (words(q) > L.confirmWords.max || q.length > L.questionChars) return fail('too_long')
  }

  const tone = toneProblem(r, q, s)
  if (tone) return fail(tone)
  if (s && toneProblem(s)) return fail(toneProblem(s))

  return {
    ok: true,
    repaired: repairs.length ? repairs.join('+') : null,
    turn: { reading, understanding, rationale: why, move, reflection: r, question: q, statement: s },
  }
}
