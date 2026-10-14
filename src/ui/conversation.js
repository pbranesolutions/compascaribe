// The first conversation. Presentation only: it renders what the journey
// holds (the visitor's words exactly as written, the model's reflection and
// question exactly as the server validated them, the visitor's answer) and
// computes nothing about any of it.
//
// One exchange at a time, never a transcript: the visitor's words are a
// preview with the full text one tap away, the reflection and the question are
// the page, and the answer field sits under them. Everything that can be long
// fits its box or pages; nothing scrolls. Which parts show is decided by CSS
// from the viewport (so a keyboard opening needs no re-render), and the same
// elements are always present.

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

/** Height the answer field may use: what is left of the reply column after everything else in it. */
function replyRoom(frame) {
  const col = frame && frame.closest('.conv-reply')
  const comp = frame && frame.closest('.composer')
  if (!col || !comp || !frame.isConnected) return 0
  const gap = parseFloat(getComputedStyle(col).rowGap) || 0
  const others = [...col.children].filter(c => c !== comp).reduce((sum, c) => sum + c.offsetHeight + gap, 0)
  const chrome = comp.offsetHeight - frame.offsetHeight
  return col.clientHeight - others - chrome - 2
}

/**
 * @param {object} state  journey state
 * @param {object} actions
 * @param {{ head: Function, foot: Function, primary: Function, ghost: Function, ply: Function, link: Function }} kit  shared view parts
 */
export function conversationView(state, actions, kit) {
  const { head, foot, primary, ghost, ply, link } = kit
  const opening = latestOpening(state.ctx)
  const reply = latestReply(state.ctx)
  const failed = !opening && state.opening.status === 'failed'
  const waiting = !opening && !failed
  const asking = Boolean(opening) && !reply
  const answered = Boolean(opening) && Boolean(reply)
  const words = state.ctx.submission?.text || ''

  const edit = ghost('Edit your words', () => actions.back(), 'conv:edit')

  // --- header ------------------------------------------------------------
  const compactLink = link('Full exchange', () => actions.openOverlay('exchange', 0, 'conv:exchange'), 'conv:exchange')
  compactLink.classList.add('conv-only-compact')
  const tinyEdit = link('Edit your words', () => actions.back(), 'conv:edit-tiny')
  tinyEdit.classList.add('conv-only-tiny')
  // The same fact at three lengths; CSS picks one from the viewport so a keyboard opening needs no re-render.
  const label = opening
    ? h('span', { class: 'label' }, h('b', null,
      h('span', { class: 'conv-l' }, 'Reply written by an AI model'), h('span', { class: 'conv-m' }, 'AI-written reply'), h('span', { class: 'conv-s' }, 'AI reply')))
    : h('span', { class: 'label' }, h('b', null, 'First exchange'), failed ? ' · reply not ready' : ' · reply in progress')
  const header = head(label, h('span', { class: 'conv-links' }, opening ? compactLink : null, tinyEdit))

  // --- the visitor's words: a preview, the full text one tap away ----------
  const wordsButton = h('button', {
    type: 'button',
    class: 'words conv-words',
    'data-focus-key': 'words',
    'aria-label': 'Read your words in full',
    onClick: () => actions.openOverlay('words', 0, 'words'),
  },
  h('span', { class: 'label' }, 'You wrote', h('span', { class: 'conv-more' }, ' · in full ›')),
  h('span', { class: 'prose', 'data-clamp': 'preview' }, words))

  const said = h('div', { class: 'conv-said' }, wordsButton)

  // --- what Compás Caribe understood, and the one question ------------------
  if (opening) {
    // Once answered, the reading and the question are context, not the page: smaller, so the answer has the room.
    const reflection = pagedText({ paragraphs: [opening.reflection], fit: answered ? '13,15' : '13,18', className: 'reflection', maxHeight: 'var(--r-max)', focusKey: 'conv-reflection-pager' })
    const question = pagedText({ paragraphs: [opening.question], fit: answered ? '14,24' : '15,40', className: 'question', maxHeight: answered ? 'var(--r-max)' : 'var(--q-max)', focusKey: 'conv-question-pager' })
    const q = question.querySelector('.question')
    q.id = 'q'
    q.setAttribute('role', 'heading')
    q.setAttribute('aria-level', '1')
    said.append(
      h('div', { class: 'conv-ai' }, h('span', { class: 'label conv-speaker' }, 'Compás Caribe'), reflection),
      question)
  }

  // --- the reply column: waiting, failed, the field, or the recorded answer ---
  const col = h('div', { class: `conv-reply${answered ? ' is-answered' : ''}` })
  if (waiting) {
    col.append(h('div', { class: 'conv-wait' }, processing(['Preparing a reply'], 0)))
  } else if (failed) {
    col.append(h('div', { class: 'error', role: 'alert' }, failureText(state.opening.failure)))
  } else if (reply) {
    col.append(
      h('div', { class: 'conv-answer' },
        h('span', { class: 'label' }, 'Your answer'),
        pagedText({ paragraphs: [reply.text], fit: '14,20', className: 'prose', focusKey: 'conv-answer-pager' })),
      h('p', { class: 'conv-notice', 'data-fit': '12,14', style: { margin: 0, maxHeight: 'var(--s-max)' } },
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
    col.append(errorLine(state), comp)
  }

  const body = h('div', { class: 'ply-body conv', 'data-budget': 'conversation' }, said, col)

  // --- footer ------------------------------------------------------------
  let footer
  if (waiting) footer = foot(edit, h('span', { class: 'label' }, 'Reply in progress'))
  else if (failed) footer = foot(edit, primary('Try again', () => actions.retryOpening(), { disabled: state.busy, autofocus: true, key: 'conv:retry' }))
  else if (reply) footer = foot(ghost('Edit your answer', () => actions.editReply(), 'conv:edit-answer'), edit)
  else footer = foot(edit, h('span', { class: 'label conv-later' }, 'Later replies are not connected yet'))

  return ply([header, body, footer], `is-conversation${asking ? ' is-asking' : ''}${answered ? ' is-answered' : ''}`)
}
