// The shape of every reply after the first, and the server's check that a model
// response really has it. Pure functions shared by the Worker, the browser
// client and the tests; nothing here talks to a model.
//
// A turn is the agent's whole move: what it read in the visitor's latest
// message, how its understanding of the project changed, and then either one
// more question or the project's purpose stated for the visitor to confirm. The
// understanding travels with the conversation (the browser keeps it and sends it
// back), so each turn builds on the last without the server holding any state.
//
// As with the opening, a schema cannot say "one question" or "no flattery", so
// validateTurn holds the result to those too. A response that fails is never shown.

import { oneQuestion, sentencesOf, tidy, toneProblem, withoutEncouragement, wordCount } from './schema.js'

export const TURN_SCHEMA_ID = 'compascaribe.conversation/1'

/** What the visitor's latest message did, as the agent read it. */
export const READINGS = Object.freeze(['answers', 'adds', 'changes', 'contradicts', 'unsure', 'asks', 'diversion', 'corrects'])

/** The agent's move: ask one more question, or state the purpose. */
export const MOVES = Object.freeze(['ask', 'statement'])

/** The parts of a purpose, as a map of how well each is established. Not a sequence. */
export const COVERAGE_KEYS = Object.freeze(['problem', 'beneficiaries', 'outcome', 'value', 'success'])
export const COVERAGE_LEVELS = Object.freeze(['unknown', 'partial', 'clear'])

const stringList = { type: 'array', items: { type: 'string' } }

/**
 * JSON Schema for structured output. Field order is generation order: the
 * model settles how it read the message and what it now understands before it
 * decides the move and writes what the visitor will read.
 */
export const TURN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    reading: { type: 'string', enum: [...READINGS] },
    understanding: {
      type: 'object',
      properties: {
        purpose: { type: 'string' },
        confirmed: stringList,
        inferred: stringList,
        open: stringList,
        coverage: {
          type: 'object',
          properties: Object.fromEntries(COVERAGE_KEYS.map(k => [k, { type: 'string', enum: [...COVERAGE_LEVELS] }])),
          required: [...COVERAGE_KEYS],
          additionalProperties: false,
        },
      },
      required: ['purpose', 'confirmed', 'inferred', 'open', 'coverage'],
      additionalProperties: false,
    },
    move: { type: 'string', enum: [...MOVES] },
    reflection: { type: 'string' },
    question: { type: 'string' },
    statement: { type: 'string' },
  },
  required: ['reading', 'understanding', 'move', 'reflection', 'question', 'statement'],
  additionalProperties: false,
})

/** Bounds the display relies on: the interface fits (and pages) text within these. */
export const TURN_LIMITS = Object.freeze({
  reflectionWords: { min: 3, max: 55 },
  questionWords: { min: 3, max: 40 },
  /** A statement's confirming question is short: the statement is the content. */
  confirmWords: { min: 3, max: 30 },
  statementWords: { min: 6, max: 75 },
  statementSentences: 4,
  totalWords: 95,
  reflectionChars: 380,
  questionChars: 260,
  statementChars: 460,
  purposeChars: 320,
  itemChars: 220,
  confirmedMax: 8,
  inferredMax: 5,
  openMax: 5,
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
 * does not have the shape yields null rather than a guess.
 *
 * @returns {{ purpose: string, confirmed: string[], inferred: string[], open: string[], coverage: Record<string, string> } | null}
 */
export function normalizeUnderstanding(raw) {
  const L = TURN_LIMITS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.purpose !== 'string') return null
  const confirmed = cleanList(raw.confirmed, L.confirmedMax, L.itemChars)
  const inferred = cleanList(raw.inferred, L.inferredMax, L.itemChars)
  const open = cleanList(raw.open, L.openMax, L.itemChars)
  if (!confirmed || !inferred || !open) return null
  const cov = raw.coverage
  if (!cov || typeof cov !== 'object') return null
  const coverage = {}
  for (const k of COVERAGE_KEYS) {
    if (!COVERAGE_LEVELS.includes(cov[k])) return null
    coverage[k] = cov[k]
  }
  return { purpose: tidy(raw.purpose).slice(0, L.purposeChars), confirmed, inferred, open, coverage }
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
 * @returns {{ ok: true, repaired: string|null, turn: { reading: string, understanding: object, move: string, reflection: string, question: string, statement: string } } | { ok: false, reason: string }}
 */
export function validateTurn(raw, { final = false, previousQuestions = [] } = {}) {
  const fail = reason => ({ ok: false, reason })
  const L = TURN_LIMITS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('shape')
  const { reading, understanding: rawUnderstanding, move, reflection, question, statement } = raw
  if (typeof reading !== 'string' || typeof move !== 'string' || typeof reflection !== 'string' || typeof question !== 'string' || typeof statement !== 'string') return fail('shape')
  if (!READINGS.includes(reading)) return fail('reading')
  if (!MOVES.includes(move)) return fail('move')
  const understanding = normalizeUnderstanding(rawUnderstanding)
  if (!understanding) return fail('understanding')
  if (final && move !== 'statement') return fail('not_final')

  const repairs = []
  let r = tidy(reflection)
  let q = tidy(question)
  let s = tidy(statement)

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
    if (words(r) < L.reflectionWords.min) return fail('reflection_missing')
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
    turn: { reading, understanding, move, reflection: r, question: q, statement: s },
  }
}
