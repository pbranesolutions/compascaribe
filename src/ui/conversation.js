// The conversation. Presentation only: it renders what the journey holds (the
// visitor's project exactly as written, the model's reflection and question
// exactly as the server validated them, the visitor's answer) and computes
// nothing about any of it.
//
// One exchange at a time, never a transcript. The current exchange is the
// page: what Compás Caribe took from the last answer, the one question, and
// the field for the answer. Beside it (or above it, on a phone) is the project:
// the visitor's own words with the way to edit them, and the exchanges so far,
// so the visitor stays oriented in the larger conversation without a transcript.
// Everything that can be long fits its box or pages; nothing scrolls. The same
// elements are always present; CSS composes them per viewport (desktop: two
// columns; tablet: one column with the exchanges so far below; phone: one
// column, the exchanges so far one tap away), so a keyboard opening needs no
// re-render.
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
import { composer, errorLine, isTouch, pagedList, pagedText, processing } from './components.js'
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
 * Room a block in the reply column may use: the column's own height (its grid
 * track is whatever the reading above it leaves) minus its siblings. `inner`
 * is the part of `block` that may grow (the textarea frame); the rest of the
 * block is chrome that must fit too.
 */
function roomIn(block, inner = block) {
  const col = block && block.closest('.conv-reply')
  if (!col || !block.isConnected) return 0
  const gap = parseFloat(getComputedStyle(col).rowGap) || 0
  const others = [...col.children].filter(c => c !== block).reduce((sum, c) => sum + (c.offsetHeight ? c.offsetHeight + gap : 0), 0)
  const chrome = block.offsetHeight - inner.offsetHeight
  return col.clientHeight - others - chrome - 2
}

const replyRoom = (frame) => roomIn(frame && frame.closest('.composer'), frame)

const small = (n) => (typeof n === 'number' ? Math.round(n) : '—')

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
 * The exchanges completed before `current` (the reply being answered or
 * waited on): each thing Compás Caribe said, paired with what the visitor
 * answered. Shown as the record so far, never rewritten.
 */
function exchangesBefore(ctx, current) {
  const turns = turnsOf(ctx)
  const end = current ? turns.indexOf(current) : turns.length
  const items = []
  for (let i = 0; i < end; i++) {
    const t = turns[i]
    if (t.role !== 'compas') continue
    const next = i + 1 < end ? turns[i + 1] : null
    const reply = next && next.role === 'visitor' ? next : null
    items.push({
      asked: t.kind === 'statement' ? t.statement : t.question,
      stated: t.kind === 'statement',
      answer: reply ? (reply.kind === 'confirmation' ? 'This is right.' : reply.text) : null,
    })
  }
  return items
}

// Which page of the exchanges so far is open; the latest by default, and after every new exchange.
let soFarPage = Infinity

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
  const earlier = exchangesBefore(ctx, turn)

  // --- the project: the visitor's words, the way to change them, and the exchanges so far ---
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

  // The exchanges so far: a numbered record that pages, or, before there is one, where this is going.
  let soFar
  if (earlier.length) {
    soFar = pagedList({
      items: earlier,
      page: soFarPage,
      onPage: p => { soFarPage = p; soFar.page = p; soFar.paginate() },
      focusKey: 'conv-sofar-pager',
      label: 'Exchanges',
      units: ['exchange', 'exchanges'],
      renderItem: (it, i) => h('div', { class: `sofar-item${it.stated ? ' is-stated' : ''}` },
        h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'sofar-body' },
          h('span', { class: 'sofar-q', 'data-clamp': 'preview' }, it.asked),
          h('span', { class: 'sofar-a', 'data-clamp': 'preview' }, it.answer || '—'))),
    })
    soFar.classList.add('conv-sofar-list')
  } else {
    soFar = h('p', { class: 'conv-orient', 'data-fit': '13,16', style: { margin: 0, maxHeight: 'var(--o-max)' } },
      'One question at a time. Each answer sharpens what your project is for; when that is clear, it is put in a sentence or two for you to confirm.')
  }
  const soFarBlock = h('div', { class: 'conv-sofar' },
    h('div', { class: 'conv-meta' }, h('span', { class: 'label' }, h('b', null, 'So far'), earlier.length ? ` · ${earlier.length} ${earlier.length === 1 ? 'exchange' : 'exchanges'}` : '')),
    soFar)

  const side = h('aside', { class: 'conv-side', 'aria-label': 'Your project and the exchanges so far' }, project, soFarBlock)

  // --- what Compás Caribe took from the last answer, and the one question (or the purpose, stated) ---
  let ai = null
  if (turn) {
    const speaker = h('span', { class: 'label conv-speaker' }, stated ? 'Compás Caribe · the project’s purpose' : 'Compás Caribe', h('span', { class: 'conv-tag' }, ' · AI-assisted'))
    if (stated) {
      // The statement is the page: the confirming question is a quiet line under it.
      const statement = pagedText({ paragraphs: [turn.statement], fit: answered || confirmed ? '15,22' : '18,32', className: 'question conv-statement', maxHeight: 'var(--st-max)', focusKey: 'conv-statement-pager' })
      const q = statement.querySelector('.question')
      q.id = 'q'
      q.setAttribute('role', 'heading')
      q.setAttribute('aria-level', '1')
      const confirmQuestion = confirmed
        ? null
        : pagedText({ paragraphs: [turn.question], fit: answered ? '14,16' : '15,19', className: 'reflection', maxHeight: 'var(--r-max)', focusKey: 'conv-confirm-pager' })
      if (confirmQuestion) confirmQuestion.classList.add('conv-reading')
      ai = h('div', { class: 'conv-node conv-ai conv-stated' }, speaker, statement, confirmQuestion)
    } else {
      // Once answered, the reading and the question are context, not the page: smaller, so the answer has the room.
      // A follow-up may carry no reflection at all: a question that stands on its own is better than a paraphrase.
      const reflection = turn.reflection ? pagedText({ paragraphs: [turn.reflection], fit: answered ? '14,16' : '15,21', className: 'reflection', maxHeight: 'var(--r-max)', focusKey: 'conv-reflection-pager' }) : null
      if (reflection) reflection.classList.add('conv-reading')
      const question = pagedText({ paragraphs: [turn.question], fit: answered ? '16,26' : '18,48', className: 'question', maxHeight: answered ? 'var(--r-max)' : 'var(--q-max)', focusKey: 'conv-question-pager' })
      const q = question.querySelector('.question')
      q.id = 'q'
      q.setAttribute('role', 'heading')
      q.setAttribute('aria-level', '1')
      ai = h('div', { class: 'conv-node conv-ai' }, speaker, reflection, question)
    }
  } else {
    // Before the first reply the thread has one node: what is being prepared.
    ai = h('div', { class: 'conv-node conv-ai is-empty' }, h('span', { class: 'label conv-speaker' }, 'Compás Caribe', h('span', { class: 'conv-tag' }, ' · AI-assisted')))
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
      h('p', { class: 'conv-note conv-notice', 'data-fit': '13,15', style: { margin: 0, maxHeight: 'var(--s-max)' } },
        'Saved in this browser. Next is a simulated handoff; nothing is sent.'))
  } else if (reply) {
    const failed = state.turn.status === 'failed'
    const editAnswer = failed || state.turn.status === 'idle' ? link('Edit', () => actions.editReply(), 'conv:edit-answer') : null
    if (editAnswer) editAnswer.setAttribute('aria-label', 'Edit your answer')
    const answerBox = h('div', { class: 'conv-answer', 'data-measure': 'true' },
      h('div', { class: 'conv-meta' }, h('span', { class: 'label' }, stated ? 'Your correction' : 'Your answer'), editAnswer),
      pagedText({ paragraphs: [reply.text], fit: '15,21', className: 'prose', focusKey: 'conv-answer-pager' }))
    // The recorded answer takes the room the reading leaves (minus its own notice), and pages only if it truly cannot fit.
    answerBox.measure = () => { if (answerBox.isConnected) answerBox.style.maxHeight = `${Math.max(60, roomIn(answerBox) + 2)}px` }
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

  const body = h('div', { class: 'ply-body conv', 'data-budget': 'conversation' }, side, ai, col)
  return ply([body], `is-conversation${asking ? ' is-asking' : ''}${answered ? ' is-answered' : ''}${stated ? ' is-stated' : ''}${confirmed ? ' is-confirmed' : ''}${waiting ? ' is-waiting' : ''}`)
}
