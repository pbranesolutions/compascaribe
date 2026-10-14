// The conversation. Presentation only: it renders what the journey holds (the
// visitor's project exactly as written, the model's reflection and question
// exactly as the server validated them, the visitor's answer) and computes
// nothing about any of it.
//
// One exchange at a time, never a transcript. The visitor's project and the
// latest reply are one thread: the project (a preview, with the full text and
// the way to edit it beside it), what Compás Caribe took from the last answer
// and the one question, and the answer field. Earlier exchanges stay one tap
// away in "Full exchange", which pages. There is no header or footer chrome:
// the controls sit with the thing they act on. Everything that can be long fits
// its box or pages; nothing scrolls. Which parts show is decided by CSS from the
// viewport (so a keyboard opening needs no re-render); the same elements are
// always present.
//
// When the purpose has been understood the reply is a statement of it: shown as
// the page, with one tap to confirm it and one to say what to change. Once
// confirmed it is the project's statement and the way on is "Continue".
//
// Customer-facing wording is plain. That the reply is written by an AI model
// is stated once, quietly, on the reply itself; engineering detail (model,
// latency, tokens, what the agent read and understood) is in `.conv-diag`,
// shown only with ?diagnostics.

import { isConfirmed, latestCompas, latestReply, LIMITS, turnsOf } from '../domain/context.js'
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
  interrupted: 'The reply was not ready when this page was closed.',
  limit: 'This conversation has reached the length it can have here.',
}

/** What a visitor is told when a reply could not be prepared; `kept` names what was saved ('words' before the first reply, 'answer' after). */
export const failureText = (kind, kept = 'words') => `${FAILURE_TEXT[kind] || FAILURE_TEXT.provider_error} Your ${kept} ${kept === 'words' ? 'are' : 'is'} kept.`

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

/** The agent's private notes for the diagnostics line: what it read, the scope it holds, why it asked, how much is established. */
function understandingLine(turn) {
  const u = turn.understanding
  if (!u) return ''
  const cov = Object.entries(u.coverage || {}).map(([k, v]) => `${k[0]}:${v === 'clear' ? '●' : v === 'partial' ? '◐' : '○'}`).join(' ')
  const n = k => (Array.isArray(u[k]) ? u[k].length : 0)
  const objectives = n('objectives') ? ` · objectives: ${u.objectives.join(' | ')}` : ''
  return ` · read ${turn.reading || '—'} · ${n('objectives')} objectives, ${n('evidence')} evidence, ${n('inferred')} inferred, ${n('open')} open · ${cov}${objectives}${u.purpose ? ` · purpose: ${u.purpose}` : ''}${turn.rationale ? ` · why: ${turn.rationale}` : ''}`
}

/**
 * @param {object} state  journey state
 * @param {object} actions
 * @param {{ primary: Function, ply: Function, link: Function }} kit  shared view parts
 */
export function conversationView(state, actions, kit) {
  const { primary, ply, link } = kit
  const ctx = state.ctx
  const turn = latestCompas(ctx)
  const reply = latestReply(ctx)
  const confirmed = isConfirmed(ctx)
  const stated = Boolean(turn) && turn.kind === 'statement'
  const failedOpening = !turn && state.opening.status === 'failed'
  const waiting = !turn && !failedOpening
  const answered = Boolean(turn) && Boolean(reply)
  const asking = Boolean(turn) && !reply && !confirmed
  const correcting = stated && asking && state.correcting
  // Earlier exchanges exist beyond the first reply: they are one tap away, at every size.
  const history = turnsOf(ctx).length > 2
  const words = ctx.submission?.text || ''

  // --- the visitor's project: a preview, the full text and the way to change it beside it ---
  const readFull = link('Read in full', () => actions.openOverlay('words', 0, 'conv:full'), 'conv:full')
  readFull.classList.add('conv-read')
  const exchange = link('Full exchange', () => actions.openOverlay('exchange', 0, 'conv:exchange'), 'conv:exchange')
  exchange.classList.add(history ? 'conv-history' : 'conv-only-compact')
  const edit = link('Edit', () => actions.back(), 'conv:edit')
  edit.setAttribute('aria-label', 'Edit your words')

  const project = h('div', { class: 'conv-node conv-project' },
    h('div', { class: 'conv-meta' },
      h('span', { class: 'label' }, 'Your project'),
      // The exchange overlay opens with the whole project, so once there is more than the first reply "Read in full" has nothing to add.
      h('span', { class: 'conv-actions' }, history ? null : readFull, turn ? exchange : null, edit)),
    h('p', { class: 'conv-quote', 'data-clamp': 'preview', 'data-clamp-detect': 'true' }, words))

  const said = h('div', { class: 'conv-said' }, project)

  // --- what Compás Caribe took from the last answer, and the one question (or the purpose, stated) ---
  if (turn) {
    const speaker = h('span', { class: 'label conv-speaker' }, stated ? 'Compás Caribe · the project’s purpose' : 'Compás Caribe', h('span', { class: 'conv-tag' }, ' · AI-assisted'))
    if (stated) {
      // The statement is the page: the confirming question is a quiet line under it.
      const statement = pagedText({ paragraphs: [turn.statement], fit: answered || confirmed ? '14,20' : '17,30', className: 'question conv-statement', maxHeight: 'var(--st-max)', focusKey: 'conv-statement-pager' })
      const q = statement.querySelector('.question')
      q.id = 'q'
      q.setAttribute('role', 'heading')
      q.setAttribute('aria-level', '1')
      const confirmQuestion = confirmed
        ? null
        : pagedText({ paragraphs: [turn.question], fit: answered ? '13,15' : '14,17', className: 'reflection', maxHeight: 'var(--r-max)', focusKey: 'conv-confirm-pager' })
      if (confirmQuestion) confirmQuestion.classList.add('conv-reading')
      said.append(h('div', { class: 'conv-node conv-ai conv-stated' }, speaker, statement, confirmQuestion))
    } else {
      // Once answered, the reading and the question are context, not the page: smaller, so the answer has the room.
      // A follow-up may carry no reflection at all: a question that stands on its own is better than a paraphrase.
      const reflection = turn.reflection ? pagedText({ paragraphs: [turn.reflection], fit: answered ? '13,15' : '14,19', className: 'reflection', maxHeight: 'var(--r-max)', focusKey: 'conv-reflection-pager' }) : null
      if (reflection) reflection.classList.add('conv-reading')
      const question = pagedText({ paragraphs: [turn.question], fit: answered ? '14,24' : '16,44', className: 'question', maxHeight: answered ? 'var(--r-max)' : 'var(--q-max)', focusKey: 'conv-question-pager' })
      const q = question.querySelector('.question')
      q.id = 'q'
      q.setAttribute('role', 'heading')
      q.setAttribute('aria-level', '1')
      said.append(h('div', { class: 'conv-node conv-ai' }, speaker, reflection, question))
    }
  }

  // --- the reply column: waiting, failed, the field, the confirmation or the recorded answer ---------
  const col = h('div', { class: `conv-node conv-reply${answered ? ' is-answered' : ''}` })
  if (waiting) {
    col.append(h('div', { class: 'conv-wait' }, processing(['Preparing a reply'], 0)))
  } else if (failedOpening) {
    col.append(
      h('div', { class: 'error', role: 'alert' }, failureText(state.opening.failure)),
      h('div', { class: 'conv-retry' }, primary('Try again', () => actions.retryConversation(), { disabled: state.busy, autofocus: true, key: 'conv:retry' })))
  } else if (confirmed) {
    col.append(
      h('div', { class: 'conv-confirm' }, primary('Continue', () => actions.accept(), { autofocus: true, key: 'conv:continue' })),
      h('p', { class: 'conv-note conv-notice', 'data-fit': '12,14', style: { margin: 0, maxHeight: 'var(--s-max)' } },
        'Saved in this browser. Next is a simulated handoff; nothing is sent.'))
  } else if (reply) {
    const failed = state.turn.status === 'failed'
    const editAnswer = failed || state.turn.status === 'idle' ? link('Edit', () => actions.editReply(), 'conv:edit-answer') : null
    if (editAnswer) editAnswer.setAttribute('aria-label', 'Edit your answer')
    const answerBox = h('div', { class: 'conv-answer', 'data-measure': 'true' },
      h('div', { class: 'conv-meta' }, h('span', { class: 'label' }, stated ? 'Your correction' : 'Your answer'), editAnswer),
      pagedText({ paragraphs: [reply.text], fit: '14,20', className: 'prose', focusKey: 'conv-answer-pager' }))
    answerBox.measure = () => answerRoom(answerBox)
    col.append(answerBox)
    if (failed) {
      const limit = state.turn.failure === 'limit'
      col.append(
        h('div', { class: 'error', role: 'alert' }, failureText(state.turn.failure, 'answer')),
        h('div', { class: 'conv-retry' },
          limit && turnsOf(ctx).some(t => t.kind === 'statement')
            ? primary('Keep this statement', () => actions.confirmStatement(), { disabled: state.busy, autofocus: true, key: 'conv:keep' })
            : primary('Try again', () => actions.retryConversation(), { disabled: state.busy, autofocus: true, key: 'conv:retry' })))
    } else {
      col.append(h('div', { class: 'conv-wait' }, processing(['Preparing a reply'], 0)))
    }
  } else if (stated && !correcting) {
    col.append(
      errorLine(state),
      h('div', { class: 'conv-confirm' },
        primary('That’s right', () => actions.confirmStatement(), { autofocus: true, key: 'conv:confirm' }),
        link('Change something', () => actions.openCorrection(), 'conv:correct')))
  } else {
    const send = primary('Send', () => actions.sendReply(), { key: 'conv:send', disabled: state.busy })
    const comp = composer({
      id: 'reply',
      value: state.drafts.reply,
      limit: LIMITS.reply,
      placeholder: correcting ? 'What you would change, in your own words' : 'Your answer, in your own words',
      label: correcting ? 'What you would change in the statement of your project’s purpose' : 'Your answer to Compás Caribe’s question',
      hint: isTouch() ? null : 'Ctrl + Enter to send',
      onInput: v => actions.setDraft('reply', v),
      onSubmit: () => actions.sendReply(),
      autofocus: true,
      grow: { minLines: 2, room: () => replyRoom(comp.querySelector('.ta-frame')) },
      quietCount: true,
      action: send,
    })
    if (correcting) {
      const back = link('Cancel', () => actions.closeCorrection(), 'conv:cancel-correction')
      col.append(h('div', { class: 'conv-meta' }, h('span', { class: 'label' }, 'What would you change?'), back))
    }
    col.append(errorLine(state), comp)
  }

  // --- development diagnostics: present, hidden unless ?diagnostics ---------------
  if (turn) {
    const src = turn.source || {}
    const a = turn.analysis || {}
    const usage = src.usage ? `${src.usage.inputTokens} in · ${src.usage.outputTokens} out` : 'tokens not reported'
    const base = `${src.model || 'model not reported'} · ${small(src.latencyMs)} ms · ${usage}`
    const detail = turn.kind === 'opening'
      ? ` · describes ${a.describes || '—'} · explores ${a.explores || '—'}${a.uncertainty ? ` · unknown: ${a.uncertainty}` : ''}`
      : understandingLine(turn)
    col.append(h('p', { class: 'conv-diag' }, base + detail))
  }

  const body = h('div', { class: 'ply-body conv', 'data-budget': 'conversation' }, said, col)
  return ply([body], `is-conversation${asking ? ' is-asking' : ''}${answered ? ' is-answered' : ''}${stated ? ' is-stated' : ''}${confirmed ? ' is-confirmed' : ''}`)
}
