// The first conversation. Presentation only: it renders what the journey
// holds (the visitor's project exactly as written, the model's reflection and
// question exactly as the server validated them, the visitor's answer) and
// computes nothing about any of it.
//
// One exchange at a time, never a transcript. The visitor's project and the
// reply are one thread: the project (a preview, with the full text and the way
// to edit it beside it), what Compás Caribe took from it and the one question,
// and the answer field. There is no header or footer chrome: the controls sit
// with the thing they act on. Everything that can be long fits its box or pages;
// nothing scrolls. Which parts show is decided by CSS from the viewport (so a
// keyboard opening needs no re-render); the same elements are always present.
//
// Customer-facing wording is plain. That the reply is written by an AI model is
// stated once, quietly, on the reply itself; engineering detail (model, latency,
// tokens, what the question explores) is in `.conv-diag`, shown only with
// ?diagnostics.

import { latestOpening, latestReply, LIMITS } from '../domain/context.js'
import { composer, errorLine, isTouch, pagedText, processing } from './components.js'
import { h } from './dom.js'

const FAILURE_TEXT = {
  configuration: 'The reply service is not available right now.',
  rate_limited: 'There are too many requests right now. Wait a moment, then try again.',
  overloaded: 'The reply service is busy right now.',
  timeout: 'The reply took too long to prepare.',
  network: 'The reply service could not be reached.',
  qualification: 'Your words need to be checked again before a reply can be prepared.',
  refused: 'A reply could not be prepared for this.',
  malformed: 'A reply could not be prepared this time.',
  provider_error: 'A reply could not be prepared this time.',
}

export const failureText = kind => `${FAILURE_TEXT[kind] || FAILURE_TEXT.provider_error} Your words are kept.`

/**
 * Height the answer field may use: what the body leaves once the project and the
 * reply above it are laid out (single column), or the reply column's own height
 * (two columns, side by side).
 */
function replyRoom(frame) {
  const col = frame && frame.closest('.conv-reply')
  const comp = frame && frame.closest('.composer')
  const body = col && col.parentElement
  if (!col || !comp || !body || !frame.isConnected) return 0
  const bodyStyle = getComputedStyle(body)
  const sideBySide = bodyStyle.gridTemplateColumns.trim().split(/\s+/).length > 1
  const gap = parseFloat(getComputedStyle(col).rowGap) || 0
  const others = [...col.children].filter(c => c !== comp).reduce((sum, c) => sum + c.offsetHeight + gap, 0)
  const chrome = comp.offsetHeight - frame.offsetHeight
  let available = col.clientHeight
  if (!sideBySide) {
    const said = body.querySelector('.conv-said')
    available = body.clientHeight - (said ? said.offsetHeight : 0) - (parseFloat(bodyStyle.rowGap) || 0)
  }
  return available - others - chrome - 2
}

const small = (n) => (typeof n === 'number' ? Math.round(n) : '—')

/**
 * The recorded answer takes the room the project and the reading above it leave
 * (minus its own notice), and pages only if it truly cannot fit; the notice then
 * sits right under it rather than at the bottom of the screen.
 */
function answerRoom(box) {
  const col = box.closest('.conv-reply')
  const body = col && col.parentElement
  if (!col || !body || !box.isConnected) return
  const bodyStyle = getComputedStyle(body)
  const sideBySide = bodyStyle.gridTemplateColumns.trim().split(/\s+/).length > 1
  const gap = parseFloat(getComputedStyle(col).rowGap) || 0
  const others = [...col.children].filter(c => c !== box).reduce((sum, c) => sum + (c.offsetHeight ? c.offsetHeight + gap : 0), 0)
  let available = col.parentElement.clientHeight
  if (!sideBySide) {
    const said = body.querySelector('.conv-said')
    available = body.clientHeight - (said ? said.offsetHeight : 0) - (parseFloat(bodyStyle.rowGap) || 0)
  }
  box.style.maxHeight = `${Math.max(60, available - others - 2)}px`
}

/**
 * @param {object} state  journey state
 * @param {object} actions
 * @param {{ primary: Function, ply: Function, link: Function }} kit  shared view parts
 */
export function conversationView(state, actions, kit) {
  const { primary, ply, link } = kit
  const turn = latestOpening(state.ctx)
  const reply = latestReply(state.ctx)
  const failed = !turn && state.opening.status === 'failed'
  const waiting = !turn && !failed
  const asking = Boolean(turn) && !reply
  const answered = Boolean(turn) && Boolean(reply)
  const words = state.ctx.submission?.text || ''

  // --- the visitor's project: a preview, the full text and the way to change it beside it ---
  const readFull = link('Read in full', () => actions.openOverlay('words', 0, 'conv:full'), 'conv:full')
  readFull.classList.add('conv-read')
  const exchange = link('Full exchange', () => actions.openOverlay('exchange', 0, 'conv:exchange'), 'conv:exchange')
  exchange.classList.add('conv-only-compact')
  const edit = link('Edit', () => actions.back(), 'conv:edit')
  edit.setAttribute('aria-label', 'Edit your words')

  const project = h('div', { class: 'conv-node conv-project' },
    h('div', { class: 'conv-meta' },
      h('span', { class: 'label' }, 'Your project'),
      h('span', { class: 'conv-actions' }, readFull, turn ? exchange : null, edit)),
    h('p', { class: 'conv-quote', 'data-clamp': 'preview', 'data-clamp-detect': 'true' }, words))

  const said = h('div', { class: 'conv-said' }, project)

  // --- what Compás Caribe took from it, and the one question ---------------------
  if (turn) {
    // Once answered, the reading and the question are context, not the page: smaller, so the answer has the room.
    const reflection = pagedText({ paragraphs: [turn.reflection], fit: answered ? '13,15' : '14,19', className: 'reflection', maxHeight: 'var(--r-max)', focusKey: 'conv-reflection-pager' })
    reflection.classList.add('conv-reading')
    const question = pagedText({ paragraphs: [turn.question], fit: answered ? '14,24' : '16,44', className: 'question', maxHeight: answered ? 'var(--r-max)' : 'var(--q-max)', focusKey: 'conv-question-pager' })
    const q = question.querySelector('.question')
    q.id = 'q'
    q.setAttribute('role', 'heading')
    q.setAttribute('aria-level', '1')
    said.append(h('div', { class: 'conv-node conv-ai' },
      h('span', { class: 'label conv-speaker' }, 'Compás Caribe', h('span', { class: 'conv-tag' }, ' · AI-assisted')),
      reflection,
      question))
  }

  // --- the reply column: waiting, failed, the field, or the recorded answer ---------
  const col = h('div', { class: `conv-node conv-reply${answered ? ' is-answered' : ''}` })
  if (waiting) {
    col.append(h('div', { class: 'conv-wait' }, processing(['Preparing a reply'], 0)))
  } else if (failed) {
    col.append(
      h('div', { class: 'error', role: 'alert' }, failureText(state.opening.failure)),
      h('div', { class: 'conv-retry' }, primary('Try again', () => actions.retryOpening(), { disabled: state.busy, autofocus: true, key: 'conv:retry' })))
  } else if (reply) {
    const editAnswer = link('Edit', () => actions.editReply(), 'conv:edit-answer')
    editAnswer.setAttribute('aria-label', 'Edit your answer')
    const answerBox = h('div', { class: 'conv-answer', 'data-measure': 'true' },
      h('div', { class: 'conv-meta' }, h('span', { class: 'label' }, 'Your answer'), editAnswer),
      pagedText({ paragraphs: [reply.text], fit: '14,20', className: 'prose', focusKey: 'conv-answer-pager' }))
    answerBox.measure = () => answerRoom(answerBox)
    col.append(
      answerBox,
      h('p', { class: 'conv-note conv-notice', 'data-fit': '12,14', style: { margin: 0, maxHeight: 'var(--s-max)' } },
        'Your answer is saved in this browser. Compás Caribe’s next reply is not connected yet.'))
  } else {
    const send = primary('Send', () => actions.sendReply(), { key: 'conv:send' })
    const comp = composer({
      id: 'reply',
      value: state.drafts.reply,
      limit: LIMITS.reply,
      placeholder: 'Your answer, in your own words',
      label: 'Your answer to Compás Caribe’s question',
      hint: isTouch() ? null : 'Ctrl + Enter to send',
      onInput: v => actions.setDraft('reply', v),
      onSubmit: () => actions.sendReply(),
      autofocus: true,
      grow: { minLines: 2, room: () => replyRoom(comp.querySelector('.ta-frame')) },
      quietCount: true,
      action: send,
    })
    col.append(
      errorLine(state),
      comp,
      h('p', { class: 'conv-note' }, 'Your answer is saved in this browser. Later replies are not connected yet.'))
  }

  // --- development diagnostics: present, hidden unless ?diagnostics ---------------
  if (turn) {
    const src = turn.source || {}
    const a = turn.analysis || {}
    const usage = src.usage ? `${src.usage.inputTokens} in · ${src.usage.outputTokens} out` : 'tokens not reported'
    col.append(h('p', { class: 'conv-diag' },
      `${src.model || 'model not reported'} · ${small(src.latencyMs)} ms · ${usage} · describes ${a.describes || '—'} · explores ${a.explores || '—'}${a.uncertainty ? ` · unknown: ${a.uncertainty}` : ''}`))
  }

  const body = h('div', { class: 'ply-body conv', 'data-budget': 'conversation' }, said, col)
  return ply([body], `is-conversation${asking ? ' is-asking' : ''}${answered ? ' is-answered' : ''}`)
}
