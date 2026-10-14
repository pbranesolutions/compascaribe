// The conversation as it travels: the turns after the visitor's first words,
// in order, ending with the visitor's latest message. Pure functions shared by
// the browser client (which builds it) and the Worker (which refuses anything
// that is not exactly this shape), so the server never reasons over an
// unbounded or malformed history.
//
// The history is the visitor's own to send: nothing in it is trusted as
// instruction (the prompt contains it as data), and nothing in it can raise
// the budget (the signed qualification carries the count).

import { normalizeUnderstanding } from './turn.js'

const COMPAS_KINDS = ['opening', 'followup', 'statement']

const FIELD_CHARS = { reflection: 700, question: 500, statement: 700, uncertainty: 300 }

const str = (v, max) => typeof v === 'string' && v.length <= max

/**
 * The wire form of the turns held in a project context: what a later reply is
 * built from, and nothing private to the browser (ids, timings, token usage).
 *
 * @param {Array<object>} turns  ctx.conversation.turns
 */
export function wireTurns(turns) {
  const out = []
  for (const t of turns || []) {
    if (t.role === 'compas') {
      const w = { role: 'compas', kind: t.kind, reflection: t.reflection || '', question: t.question || '' }
      if (t.kind === 'statement') w.statement = t.statement || ''
      if (t.kind === 'opening' && t.analysis) w.analysis = { describes: t.analysis.describes, uncertainty: t.analysis.uncertainty, explores: t.analysis.explores }
      out.push(w)
    } else if (t.role === 'visitor' && t.kind === 'reply') {
      out.push({ role: 'visitor', kind: 'reply', text: t.text })
    }
  }
  return out
}

const significant = s => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []))

/**
 * Whether the visitor's latest message says (nearly) what their previous one
 * said. Someone who repeats themselves believes they have told you what they
 * have; the agent is told so, and moves on.
 *
 * @param {Array<{ role: string, kind?: string, text?: string }>} turns  a validated history
 */
export function repeatsItself(turns) {
  const said = turns.filter(t => t.role === 'visitor' && t.kind === 'reply').map(t => t.text)
  if (said.length < 2) return false
  const a = significant(said.at(-1))
  const b = significant(said.at(-2))
  if (a.size < 3 || b.size < 3) return said.at(-1).trim().toLowerCase() === said.at(-2).trim().toLowerCase()
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.max(a.size, b.size) >= 0.8
}

/**
 * @param {unknown} rawTurns
 * @param {unknown} rawUnderstanding
 * @param {{ replyMaxChars: number, maxReplies: number }} limits
 * @returns {{ ok: true, turns: Array<object>, understanding: object|null, compasTurns: number, visitorTurns: number }
 *   | { ok: false, error: 'invalid_history'|'reply_too_long'|'empty_reply' }}
 */
export function validateHistory(rawTurns, rawUnderstanding, { replyMaxChars, maxReplies }) {
  const bad = (error = 'invalid_history') => ({ ok: false, error })
  if (rawTurns === undefined || rawTurns === null) return { ok: true, turns: [], understanding: null, compasTurns: 0, visitorTurns: 0 }
  if (!Array.isArray(rawTurns)) return bad()
  if (rawTurns.length === 0) return { ok: true, turns: [], understanding: null, compasTurns: 0, visitorTurns: 0 }
  // Opening, then (reply, turn) pairs, then the visitor's latest message: an even count, bounded by the budget.
  if (rawTurns.length % 2 !== 0 || rawTurns.length > maxReplies * 2) return bad()

  const turns = []
  for (let i = 0; i < rawTurns.length; i++) {
    const t = rawTurns[i]
    if (!t || typeof t !== 'object' || Array.isArray(t)) return bad()
    if (i % 2 === 0) {
      if (t.role !== 'compas' || !COMPAS_KINDS.includes(t.kind)) return bad()
      if ((t.kind === 'opening') !== (i === 0)) return bad()
      if (!str(t.reflection, FIELD_CHARS.reflection) || !str(t.question, FIELD_CHARS.question)) return bad()
      if (t.kind === 'statement' && !str(t.statement, FIELD_CHARS.statement)) return bad()
      if (t.kind !== 'statement' && t.statement !== undefined && !str(t.statement, FIELD_CHARS.statement)) return bad()
      if (!t.question.trim()) return bad()
      const turn = { role: 'compas', kind: t.kind, reflection: t.reflection, question: t.question }
      if (t.kind === 'statement') turn.statement = t.statement
      if (t.kind === 'opening' && t.analysis && typeof t.analysis === 'object') {
        const a = t.analysis
        if (str(a.describes, 40) && str(a.uncertainty, FIELD_CHARS.uncertainty) && str(a.explores, 40)) turn.analysis = { describes: a.describes, uncertainty: a.uncertainty, explores: a.explores }
      }
      turns.push(turn)
    } else {
      if (t.role !== 'visitor' || t.kind !== 'reply' || typeof t.text !== 'string') return bad()
      const text = t.text.trim()
      if (!text) return bad('empty_reply')
      if (text.length > replyMaxChars) return bad('reply_too_long')
      turns.push({ role: 'visitor', kind: 'reply', text })
    }
  }

  let understanding = null
  if (rawUnderstanding !== undefined && rawUnderstanding !== null) {
    understanding = normalizeUnderstanding(rawUnderstanding)
    if (!understanding) return bad()
  }
  return { ok: true, turns, understanding, compasTurns: turns.length / 2, visitorTurns: turns.length / 2 }
}
