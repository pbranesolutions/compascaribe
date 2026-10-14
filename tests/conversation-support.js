// Test doubles for the first conversation. These stand in for api.anthropic.com
// so the application logic (and the real Anthropic SDK in front of it) can be
// exercised deterministically; they are test-only and unreachable from any
// production path. Nothing here is a canned answer shown to a visitor: the
// browser-facing code only ever renders what a response, real or doubled,
// actually contains.

export const GOOD = Object.freeze({
  describes: 'problem',
  uncertainty: 'What a working system would change for the staff who retype the orders.',
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

export function header(init, name) {
  const h = init?.headers
  if (!h) return null
  if (typeof h.get === 'function') return h.get(name)
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? h[key] : null
}
