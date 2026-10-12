// Project context: the single structured record of everything learned during
// public discovery. This is what eventually travels into Decision Channel.
//
// Plain data, pure update functions. No UI concerns.

export const CONTEXT_VERSION = 1

/** Hard limits that keep every screen fit-to-viewport. Shared with the UI. */
export const LIMITS = Object.freeze({
  submission: 480,
  ownWords: 140,
  statement: 360,
})

/**
 * @typedef {Object} Answer
 * @property {string|null} optionId
 * @property {string} label        human label of the chosen option, or the visitor's own words
 * @property {string|null} text    visitor's own words, when used
 * @property {Object} [value]      structured payload from the option
 *
 * @typedef {Object} Exchange
 * @property {string} id
 * @property {string} focus        objective | people | current | success | scope
 * @property {string} reflection
 * @property {string} question
 * @property {Array<{id:string,label:string,value?:Object}>} options
 * @property {Answer|null} answer
 *
 * @typedef {Object} ProjectContext
 * @property {number} version
 * @property {string} id
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {{text:string, submittedAt:string}|null} submission
 * @property {{tier:number,label:string,confidence:number,reason:string}|null} qualification
 * @property {Array<{text:string, at:string}>} clarifications   extra text given from the "tell us more" state
 * @property {Exchange[]} exchanges
 * @property {{text:string,title:string,version:number,source:string,at:string}|null} statement
 * @property {Array<{text:string,version:number,source:string,reason:string,at:string}>} statementHistory
 * @property {{status:string, receiptId:string|null, at:string|null}} handoff
 */

function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

const now = () => new Date().toISOString()

/** @returns {ProjectContext} */
export function createContext() {
  const t = now()
  return {
    version: CONTEXT_VERSION,
    id: uid('cc'),
    createdAt: t,
    updatedAt: t,
    submission: null,
    qualification: null,
    clarifications: [],
    exchanges: [],
    statement: null,
    statementHistory: [],
    handoff: { status: 'none', receiptId: null, at: null },
  }
}

function touch(ctx) {
  return { ...ctx, updatedAt: now() }
}

export function withSubmission(ctx, text) {
  return touch({
    ...ctx,
    submission: { text: String(text).trim(), submittedAt: now() },
    qualification: null,
    clarifications: [],
    exchanges: [],
    statement: null,
    statementHistory: [],
    handoff: { status: 'none', receiptId: null, at: null },
  })
}

export function withClarification(ctx, text) {
  return touch({
    ...ctx,
    clarifications: [...ctx.clarifications, { text: String(text).trim(), at: now() }],
  })
}

/** The text the engine reasons over: submission plus any clarifications. */
export function effectiveText(ctx) {
  const parts = [ctx.submission?.text || '', ...ctx.clarifications.map(c => c.text)]
  return parts.filter(Boolean).join('. ')
}

export function withQualification(ctx, q) {
  return touch({
    ...ctx,
    qualification: { tier: q.tier, label: q.label, confidence: q.confidence, reason: q.reason },
  })
}

export function withExchanges(ctx, exchanges) {
  return touch({ ...ctx, exchanges })
}

export function withAnswer(ctx, exchangeId, answer) {
  const exchanges = ctx.exchanges.map(e => (e.id === exchangeId ? { ...e, answer, answeredAt: now() } : e))
  return touch({ ...ctx, exchanges })
}

export function withStatement(ctx, statement, reason = 'generated') {
  const version = (ctx.statement?.version || 0) + 1
  const entry = { text: statement.text, title: statement.title, version, source: statement.source || 'generated', variant: statement.variant || null, reason, at: now() }
  return touch({
    ...ctx,
    statement: entry,
    statementHistory: [...ctx.statementHistory, entry],
  })
}

export function withHandoff(ctx, receipt) {
  return touch({ ...ctx, handoff: { status: receipt.status, receiptId: receipt.receiptId, at: now() } })
}

/** Answers keyed by focus, for the engine and the review screen. */
export function answersByFocus(ctx) {
  const out = {}
  for (const e of ctx.exchanges) if (e.answer) out[e.focus] = e.answer
  return out
}

export function nextUnanswered(ctx) {
  return ctx.exchanges.find(e => !e.answer) || null
}

export function allAnswered(ctx) {
  return ctx.exchanges.length > 0 && ctx.exchanges.every(e => e.answer)
}

export function newId(prefix = 'x') {
  return uid(prefix)
}
