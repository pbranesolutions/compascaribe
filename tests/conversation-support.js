// Test doubles for the first conversation. These stand in for api.anthropic.com
// so the application logic (and the real Anthropic SDK in front of it) can be
// exercised deterministically; they are test-only and unreachable from any
// production path. Nothing here is a canned answer shown to a visitor: the
// browser-facing code only ever renders what a response, real or doubled,
// actually contains.

export const GOOD = Object.freeze({
  describes: 'problem',
  objectives: ['Orders that arrive over WhatsApp are not lost'],
  uncertainty: 'What a working system would change for the staff who retype the orders.',
  explores: 'outcome',
  reflection: 'Orders arrive over WhatsApp and get retyped into a notebook, so they are easy to lose.',
  question: 'When an order does slip through, what is it that you most need to stop happening?',
})

/** A Messages API response body whose single text block is the given opening (or raw text). */
export function messageBody(opening = GOOD, { stopReason = 'end_turn', model = 'claude-sonnet-5-5', input = 640, output = 150, thinking = true } = {}) {
  const text = typeof opening === 'string' ? opening : JSON.stringify(opening)
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model,
    content: [...(thinking ? [{ type: 'thinking', thinking: '', signature: 'sig' }] : []), { type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: input, output_tokens: output },
  }
}

/** What the agent returns for a follow-up: how it read the answer, what it now understands about the whole project, why it asks, and one more question. */
export const GOOD_TURN = Object.freeze({
  reading: 'answers',
  understanding: {
    purpose: 'Orders that arrive over WhatsApp reach the kitchen without anyone retyping them.',
    objectives: ['Orders that arrive over WhatsApp are not lost on the way to the kitchen'],
    dropped: [],
    beneficiaries: ['Marta, who retypes the orders', 'The kitchen'],
    outcomes: ['No order is lost'],
    evidence: ['Marta retypes the orders into a notebook every evening: how orders are lost'],
    inferred: ['The person who retypes them is the one who loses time'],
    open: ['What a lost order costs'],
    coverage: { problem: 'clear', beneficiaries: 'partial', outcome: 'partial', value: 'unknown', success: 'unknown' },
  },
  rationale: 'The problem and who does the retyping are clear; what a lost order costs would change why the project matters.',
  move: 'ask',
  reflection: 'Lost orders come from the retyping, and Marta is the one who does it every evening.',
  question: 'What happened the last time an order was lost?',
  statement: '',
})

/** The same, when the purpose is understood and stated for the visitor to confirm or correct. */
export const GOOD_STATEMENT = Object.freeze({
  ...GOOD_TURN,
  move: 'statement',
  reflection: '',
  question: 'Does this capture what the project is for, or is there something you would change?',
  statement: 'Orders that arrive over WhatsApp should reach the kitchen without Marta retyping them each evening, so that none are lost and she is free to prepare the next day.',
})

/** The history a browser sends for the first follow-up: the opening, then the visitor's answer. */
export const HISTORY = Object.freeze([
  { role: 'compas', kind: 'opening', reflection: GOOD.reflection, question: GOOD.question, analysis: { describes: GOOD.describes, objectives: GOOD.objectives, uncertainty: GOOD.uncertainty, explores: GOOD.explores } },
  { role: 'visitor', kind: 'reply', text: 'Marta retypes them every evening, and some get lost.' },
])

export function header(init, name) {
  const h = init?.headers
  if (!h) return null
  if (typeof h.get === 'function') return h.get(name)
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? h[key] : null
}
