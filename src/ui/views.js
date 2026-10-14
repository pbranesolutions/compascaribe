// Views: one function per journey state, returning the working ply (and, for
// overlays, the overlay element). Presentation only; all behaviour goes
// through `actions`.

import { LIMITS } from '../domain/context.js'
import { clarifyPrompt } from '../domain/discovery/clarify.js'
import { trimTo } from '../domain/discovery/language.js'
import { FOCUS_TITLES, OVERLAY_TITLES, REFINEMENTS } from '../domain/discovery/vocabulary.js'
import { summarizePayload } from '../domain/handoff/payload.js'
import { gateView } from './diagnostic.js'
import { h } from './dom.js'
import { paginateToFit } from './fit.js'
import {
  composer, errorLine, isNarrow, isTouch, optionCapacity, optionList, pagedList, pagedText, pager,
  processing, skeleton, yourWords,
} from './components.js'

const tiny = () => document.documentElement.dataset.tiny === 'true'

const ASIDES = {
  objective: 'People usually describe the tool they imagine. Naming the result first keeps the project honest about what it is for.',
  people: "Whoever carries the problem day to day decides what 'better' means, and what will actually get used.",
  current: 'The baseline tells us what the project replaces, and how we will know it is better.',
  scope: 'Building for your own operation and building a product for others are different projects with different first steps.',
  success: 'A project without a test of success drifts. One observable change is enough to start.',
}

function head(left, right) {
  return h('div', { class: 'ply-head' }, left, right || null)
}

function foot(left, right) {
  return h('div', { class: 'ply-foot' }, ...[left, right].filter(Boolean))
}

function primary(label, onClick, { disabled = false, autofocus = false, wide = false, key = 'primary' } = {}) {
  return h('button', { type: 'button', class: `btn btn-primary${wide ? ' btn-wide' : ''}`, disabled, onClick, 'data-autofocus': autofocus ? 'true' : null, 'data-focus-key': key }, label)
}

function ghost(label, onClick, key = 'secondary') {
  return h('button', { type: 'button', class: 'btn btn-ghost', onClick, 'data-focus-key': key }, label)
}

function link(label, onClick, key) {
  return h('button', { type: 'button', class: 'link', onClick, 'data-focus-key': key }, label)
}

function ply(children, extraClass = '') {
  return h('section', { class: `ply ply-work ${extraClass}`.trim(), 'aria-live': 'off' }, children)
}

const keyHint = (text) => (isTouch() ? null : text)

// ---------------------------------------------------------------------------

/**
 * Height the description field may use: whatever the page has left once the
 * headline, support line, error slot and the card's own action row are laid out.
 * Keeps the box growing line by line without ever pushing past the viewport.
 */
function landingRoom(body, frame) {
  const ply = body.parentElement
  if (!ply || !frame || !frame.isConnected) return 0
  const cs = getComputedStyle(ply)
  const head = ply.querySelector(':scope > .ply-head')
  const headH = head && getComputedStyle(head).display !== 'none' ? head.offsetHeight + (parseFloat(cs.rowGap) || 0) : 0
  const inner = ply.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - headH
  const others = body.offsetHeight - frame.offsetHeight
  return inner - others - (parseFloat(getComputedStyle(body).marginTop) || 0) - 2
}

export function welcome(state, actions) {
  let body
  // Begin lives inside the field's card: the action is the continuation of the input.
  const begin = primary('Begin', () => actions.submit(), { disabled: state.busy })
  const comp = composer({
    id: 'describe',
    value: state.drafts.welcome,
    limit: LIMITS.submission,
    placeholder: 'A sentence is fine. For example: customers book without calling us.',
    label: 'Describe what you would like to make possible',
    hint: keyHint('Ctrl + Enter to begin'),
    onInput: v => actions.setDraft('welcome', v),
    onSubmit: () => actions.submit(),
    autofocus: true,
    grow: { minLines: 2, room: () => landingRoom(body, comp.querySelector('.ta-frame')) },
    quietCount: true,
    action: begin,
  })
  comp.querySelector('#describe')?.setAttribute('aria-describedby', 'welcome-support')
  body = h('div', { class: 'ply-body' },
    h('div', { class: 'welcome-intro' },
      h('h1', { class: 'question is-hero', id: 'q', 'data-fit': '18,52', style: { margin: 0, maxHeight: 'var(--q-max)' } },
        'What would you like to ', h('span', { class: 'hl' }, 'make possible'), '?'),
      h('p', { class: 'welcome-support', id: 'welcome-support', 'data-fit': '13,21', style: { margin: 0, maxHeight: 'var(--s-max)' } },
        h('span', null, "Tell us what you'd like to accomplish."), ' ', h('span', null, "We'll help you turn it into a clearly defined project."))),
    errorLine(state),
    comp)
  return ply([
    head(h('span', { class: 'label welcome-note' }, state.resumed ? 'Welcome back · your words are kept' : 'No sign-up · start with the idea')),
    body,
  ], 'is-welcome')
}

function steppedProcessing(labels, interval) {
  const steps = processing(labels, 0)
  let i = 0
  const timer = setInterval(() => {
    if (!steps.isConnected && i > 0) return clearInterval(timer)
    i = Math.min(labels.length - 1, i + 1)
    const next = processing(labels, i)
    steps.replaceWith(next)
    Object.assign(steps, { isConnected: next.isConnected })
    if (i >= labels.length - 1) clearInterval(timer)
  }, interval)
  return steps
}

export function qualifying(state, actions) {
  const steps = steppedProcessing(['Reading what you wrote', 'Finding what matters most in it', 'Choosing the first question'], 380)
  // The visitor's own words stay centre stage while they are read. A long description
  // shows its opening; the full text is kept in "Your words" from the first question on.
  const words = h('p', { class: 'question', 'data-fit': '14,44', style: { margin: 0, maxHeight: 'var(--q-max)' } }, trimTo(state.ctx.submission?.text || '', 90))
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'You said'), ' · being read by the prototype')),
    h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr) auto' } }, words, steps),
    foot(ghost('Say it differently', () => actions.back()), h('span', { class: 'label' }, state.busyLabel ? `${state.busyLabel}…` : '')),
  ])
}

const DECLINE_COPY = {
  'greeting-only': ['Hello.', 'This is where prospective customers describe something they want built. Compás Caribe defines and builds software for businesses and organizations.'],
  unintelligible: ['We could not read that.', "Try a few plain words about what you'd like to change or accomplish."],
  'instruction-injection': ['This looks like something else.', 'This is where prospective customers describe something they want built. Compás Caribe defines and builds software for businesses and organizations.'],
  'vendor-pitch': ['This is for prospective customers.', 'If you are offering services rather than describing a project, write to hello@compascaribe.com instead.'],
  'job-seeking': ['This is for prospective customers.', 'If you are looking for work with Compás Caribe rather than describing a project, write to hello@compascaribe.com.'],
  'support-request': ['This is not a support channel.', 'For help with an existing account or order, write to hello@compascaribe.com. This space is for describing new projects.'],
  'off-topic': ['This looks like something else.', 'Compás Caribe defines and builds software for businesses and organizations: tools, websites and automations behind an operation. Questions, writing and advice are outside what we do.'],
}

export function declined(state, actions) {
  const reason = state.ctx.qualification?.reason || 'off-topic'
  const [headline, body] = DECLINE_COPY[reason] || DECLINE_COPY['off-topic']
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Not a project'), ' · as read by the prototype')),
    h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto auto minmax(0, 1fr)' } },
      h('h1', { class: 'question', 'data-fit': '24,56', style: { margin: 0, maxHeight: 'var(--q-max)' } }, headline),
      pagedText({ paragraphs: [body], fit: '13,21', maxHeight: 'var(--w-max)' }),
      tiny() ? h('span') : yourWords(state, actions, { lines: 3 })),
    foot(primary('Describe it differently', () => actions.back(), { autofocus: true })),
  ], 'is-single')
}

export function uncertain(state, actions) {
  const { reflection, question } = clarifyPrompt(state.ctx.qualification?.reason, state.ctx.submission?.text)
  const comp = composer({
    id: 'clarify',
    value: state.drafts.clarify,
    limit: LIMITS.clarification,
    placeholder: 'For example: so the front desk stops double-booking, for our two receptionists.',
    label: 'Tell us a little more',
    hint: keyHint('Ctrl + Enter to continue'),
    onInput: v => actions.setDraft('clarify', v),
    onSubmit: () => actions.clarify(),
    autofocus: true,
  })
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Not sure yet'), ' · one more sentence')),
    h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto auto auto minmax(0, 1fr)' } },
      pagedText({ paragraphs: [reflection], fit: '12,20', className: 'reflection', maxHeight: 'var(--r-max)' }),
      h('h1', { class: 'question', id: 'q', 'data-fit': '22,44', style: { margin: 0, maxHeight: 'var(--q-max)' } }, question),
      errorLine(state),
      comp),
    foot(ghost('Say it differently', () => actions.back()), primary('Read it again', () => actions.clarify(), { disabled: state.busy })),
  ])
}

export function discovery(state, actions) {
  const ex = state.ctx.exchanges[state.stepIndex]
  if (!ex) return welcome(state, actions)
  const total = state.ctx.exchanges.length
  const revisiting = Boolean(ex.answer)
  const qid = 'q'
  const unchanged = revisiting && !state.ownWordsOpen && state.selection === ex.answer.optionId
  const primaryLabel = revisiting ? (unchanged ? 'Keep this answer' : 'Update') : state.stepIndex === total - 1 ? 'Write the statement' : 'Next'
  const canCommitNow = () => (state.ownWordsOpen ? state.drafts.ownWords.trim().length > 0 : Boolean(state.selection))
  const nextBtn = primary(primaryLabel, () => { if (unchanged) actions.back(); else actions.commitAnswer() }, { disabled: !canCommitNow() || state.busy || state.asideOpen })

  let region
  let footLeft
  if (state.asideOpen) {
    region = h('div', { class: 'prose', 'data-fit': '15,22', tabIndex: -1, 'data-autofocus': 'true', style: { margin: 0 } }, ASIDES[ex.focus])
    footLeft = ghost('Back to the options', () => actions.toggleAside())
  } else if (state.ownWordsOpen) {
    const own = composer({
        id: 'own',
        value: state.drafts.ownWords,
        limit: LIMITS.ownWords,
        placeholder: ex.focus === 'success' ? 'What you would look at to know it worked' : 'Say it in a few words',
        label: ex.ownWordsHint || 'In your own words',
        hint: keyHint('Enter to continue'),
        rows: 3,
        enterSubmits: true,
        onInput: v => { actions.setDraft('ownWords', v); nextBtn.disabled = !v.trim() || state.busy },
        onSubmit: () => { if (state.drafts.ownWords.trim()) actions.commitAnswer() },
        autofocus: true,
      })
    own.classList.add('is-short')
    region = h('div', { style: { display: 'grid', gridTemplateRows: 'auto auto', gap: '8px', minHeight: 0, alignContent: 'start' } },
      own,
      link('Back to the options', () => actions.closeOwnWords(), 'own:back'))
    footLeft = ghost('Back', () => actions.back())
  } else {
    region = optionList({
      options: ex.options,
      selected: state.selection,
      onSelect: id => actions.select(id),
      ownWordsLabel: ex.allowOwnWords ? `${ex.ownWordsHint || 'In my own words'}…` : null,
      onOwnWords: () => actions.openOwnWords(),
      labelledBy: qid,
      max: optionCapacity(),
      disabled: state.busy,
    })
    footLeft = ghost(state.returnTo === 'statement' ? 'Back to the statement' : 'Back', () => actions.back())
  }

  const body = h('div', { class: 'ply-body', 'data-budget': 'discovery', style: { gridTemplateRows: 'auto auto auto minmax(0, 1fr)' } },
    pagedText({ paragraphs: [ex.reflection], fit: '12,20', className: 'reflection', maxHeight: 'var(--r-max)' }),
    h('h1', { class: 'question', id: qid, tabIndex: -1, 'data-fit': tiny() ? '15,26' : '22,52', style: { margin: 0, maxHeight: 'var(--q-max)' } }, ex.question),
    errorLine(state),
    region)

  return ply([
    head(h('span', { class: 'label' }, h('b', null, FOCUS_TITLES[ex.focus]), ` · ${state.stepIndex + 1} of ${total}${revisiting ? ' · revisiting' : ''}`),
      state.asideOpen ? null : link('Why this question', () => actions.toggleAside(), 'why')),
    body,
    foot(footLeft, nextBtn),
  ])
}

export function composing(state, actions) {
  const steps = steppedProcessing(['Reading your answers', 'Separating the objective from the tool', 'Writing the statement'], 320)
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Writing'), ' · simulated')),
    h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr) auto' } },
      isNarrow() ? skeleton(state, actions, { fit: '14,22', interactive: false }) : h('div'),
      steps),
    foot(ghost('Back to the answers', () => actions.back()), h('span', { class: 'label' }, 'One to three sentences')),
  ])
}

export function statement(state, actions) {
  const st = state.ctx.statement
  const drafts = state.ctx.statementHistory.length
  const wide = !isNarrow()
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Project statement'), ` · draft ${st?.version || 1}${st?.source === 'edited' ? ' · your words' : ' · simulated'}`),
      drafts > 1 ? link(`${drafts} drafts`, () => actions.openOverlay('drafts', drafts - 1, 'drafts'), 'drafts') : null),
    h('div', { class: `ply-body${wide ? ' is-centered' : ''}`, style: { gridTemplateRows: 'auto minmax(0, 1fr)' } },
      h('h1', { class: 'title', 'data-fit': '18,30', style: { margin: 0, maxHeight: '2.4em' } }, st?.title || 'Your project'),
      h('p', { class: 'statement', 'data-fit': '13,34', style: { margin: 0, maxHeight: wide ? 'min(62vh, 600px)' : null }, tabIndex: -1, 'data-autofocus': 'true' }, st?.text || '')),
    foot(ghost('Refine the wording', () => actions.openRefine()), primary('This is right', () => actions.accept())),
  ])
}

export function refine(state, actions) {
  const st = state.ctx.statement
  if (state.editorOpen) {
    const comp = composer({
      id: 'edit',
      value: state.drafts.edit,
      limit: LIMITS.statement,
      placeholder: 'One to three sentences.',
      label: 'Edit the project statement',
      hint: keyHint('Ctrl + Enter to use it'),
      onInput: v => actions.setDraft('edit', v),
      onSubmit: () => actions.editStatement(),
      autofocus: true,
    })
    return ply([
      head(h('span', { class: 'label' }, h('b', null, 'Edit the statement'), ` · from draft ${st?.version || 1}`)),
      h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto minmax(0, 1fr)' } }, errorLine(state), comp),
      foot(ghost('Cancel', () => actions.toggleEditor()), primary('Use this version', () => actions.editStatement(), { disabled: state.busy })),
    ])
  }
  const currentVariant = st?.source === 'generated' ? st?.variant : null
  const bars = REFINEMENTS
    .filter(r => r.variant !== currentVariant)
    .map(r => h('button', { type: 'button', class: 'option', 'data-focus-key': `refine:${r.id}`, onClick: () => actions.refine(r.variant), disabled: state.busy },
      h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'opt-text' }, r.label)))
  bars.push(h('button', { type: 'button', class: 'option is-own', 'data-focus-key': 'refine:edit', disabled: state.busy, onClick: () => actions.toggleEditor() }, h('span', { class: 'dot', 'aria-hidden': 'true', style: { borderStyle: 'dashed' } }), h('span', { class: 'opt-text' }, 'Edit the words myself…')))
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Refine'), ` · draft ${st?.version || 1}`), link('Change an answer', () => actions.openOverlay('review', 0, 'change-answer'), 'change-answer')),
    h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto minmax(0, 1fr)' } },
      h('p', { class: 'statement refine-preview', 'data-fit': '12,19', style: { margin: 0, maxHeight: 'var(--w-max)', color: 'var(--muted)' } }, st?.text || ''),
      h('div', { class: 'options' }, bars)),
    foot(ghost('Back to the statement', () => actions.back()), primary('Keep this draft', () => actions.back(), { autofocus: true })),
  ])
}

export function continueView(state, actions) {
  const wide = !isNarrow()
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Continue'), ' · what you have now')),
    h('div', { class: `ply-body${wide ? ' is-centered' : ''}`, style: { gridTemplateRows: 'auto minmax(0, 1fr) auto' } },
      h('h1', { class: 'question', 'data-fit': '24,56', style: { margin: 0, maxHeight: 'var(--q-max)' } }, 'This is already the start of your project.'),
      pagedText({ maxHeight: wide ? 'min(44vh, 420px)' : null, paragraphs: [
        'You have a project statement in your own terms: the objective, who it serves, today’s baseline and a test of success.',
        'Decision Channel is where Compás Caribe turns that into structured functional requirements: what the solution must do, decided one question at a time, with you.',
        'When you continue, everything here goes with you into Decision Channel, so nothing is asked twice.',
      ], fit: '13,23' }),
      h('p', { class: 'label', style: { margin: 0 } }, 'Prototype · this handoff is simulated: no account is created and nothing is sent')),
    foot(ghost('Back to the statement', () => actions.back()), primary('Continue into Decision Channel', () => actions.handoff(), { autofocus: true })),
  ])
}

export function handoff(state, actions) {
  const steps = steppedProcessing(['Packaging your words, answers and statement', 'Checking the record', 'Handing off · simulated'], 360)
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Decision Channel'), ' · handoff · simulated')),
    h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto minmax(0, 1fr)' } },
      h('h1', { class: 'question dc-voice', 'data-fit': '22,48', style: { margin: 0, maxHeight: 'var(--q-max)' } }, 'Handing your project to Decision Channel'),
      steps),
    foot(h('span'), h('span', { class: 'label' }, 'Your record does not leave this browser')),
  ])
}

export function done(state, actions) {
  const r = state.receipt
  const wide = !isNarrow()
  const copyBtn = ghost('Copy the record', async () => {
    if (!state.payload) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.payload, null, 2))
      copyBtn.textContent = 'Copied'
    } catch {
      copyBtn.textContent = 'Copy unavailable here'
    }
  })
  if (!state.payload) copyBtn.disabled = true
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Decision Channel'), ' · simulated'), link('Read the record', () => actions.openOverlay('record', 0, 'read-record'), 'read-record')),
    h('div', { class: `ply-body${wide ? ' is-centered' : ''}`, style: { gridTemplateRows: 'auto auto minmax(0, 1fr)' } },
      h('h1', { class: 'question dc-voice', 'data-fit': '22,48', style: { margin: 0, maxHeight: 'var(--q-max)' }, tabIndex: -1, 'data-autofocus': 'true' }, 'Your project is ready for Decision Channel.'),
      h('div', { class: 'receipt' },
        h('span', { class: 'k' }, 'Handoff reference'),
        h('span', { class: 'v' }, r?.receiptId || '—'),
        h('span', { class: 'k', style: { marginTop: '6px' } }, 'Status'),
        h('span', { class: 'v', style: { fontSize: '12px' } }, 'Prepared locally · not transmitted')),
      pagedText({ maxHeight: wide ? 'min(32vh, 300px)' : null, paragraphs: [
        'In production this record opens as your project in Decision Channel, with the statement as its charter and functional requirements structured from it.',
        r?.note || '',
      ], fit: '13,20' })),
    foot(copyBtn, primary('Start another project', () => actions.reset())),
  ])
}

// ---------------------------------------------------------------------------
// Overlays: full-stage states in the deeper tone. Paged, never scrolled.

function noteText(n) {
  const parts = []
  if (n.plan) parts.push(`questions planned: ${n.plan.map(f => FOCUS_TITLES[f] || f).join(' › ')}`)
  if (n.mode) parts.push(`rewritten as: ${(REFINEMENTS.find(r => r.variant === n.mode) || {}).label || n.mode}`)
  if (n.model && n.model !== 'none') parts.push(`would route to ${String(n.model).replace('claude-', 'Claude ')} (no model is called)`)
  if (n.model === 'none') parts.push('would not reach a generative model')
  return parts.join(' · ') || 'simulated step'
}

export function overlay(state, actions) {
  const name = state.overlay
  if (!name) return null
  const page = state.overlayPage || 0
  const close = () => actions.closeOverlay()
  const title0 = OVERLAY_TITLES[name] || name
  let title
  let body
  let footer
  let total = 1

  if (name === 'review') {
    title = h('span', { class: 'label' }, h('b', null, 'Understanding so far'), ' · simulated · select a part to revisit it')
    const rows = pagedList({
      items: [{ skeleton: true }, ...state.ctx.exchanges.map((e, i) => ({ e, i }))],
      page,
      onPage: p2 => actions.overlayPage(p2),
      focusKey: 'overlay-pager',
      renderItem: ({ skeleton: isSk, e, i }) => {
        if (isSk) {
          const sk = skeleton(state, actions, { fit: '12,22' })
          sk.style.padding = '4px 0 10px'
          return sk
        }
        const v = e.answer ? e.answer.text || e.answer.label : null
        return h('button', { type: 'button', class: `row${v ? '' : ' is-stub'}`, 'data-focus-key': `review:${e.focus}`, onClick: () => actions.revisit(i), 'aria-label': `${FOCUS_TITLES[e.focus]}: ${v || 'not yet answered'}. Revisit.` },
          h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
          h('span', null, h('span', { class: 'k' }, FOCUS_TITLES[e.focus]), h('span', { class: 'v', style: { WebkitLineClamp: '4' } }, v || 'not yet answered')))
      },
      label: 'Answers',
    })
    body = h('div', { style: { display: 'grid', gridTemplateRows: tiny() ? 'minmax(0, 1fr)' : 'auto minmax(0, 1fr)', gap: '10px', minHeight: 0 } },
      tiny() ? null : yourWords(state, actions, { lines: 2 }),
      rows)
    body.paginate = () => rows.paginate()
    footer = [h('span'), primary(state.stage === 'discovery' ? 'Back to the question' : 'Back', close, { autofocus: true })]
  } else if (name === 'words') {
    const text = [state.ctx.submission?.text || '', ...state.ctx.clarifications.map(c => `Addition: ${c.text}`)].filter(Boolean).join('\n\n')
    const box = h('p', { class: 'prose', style: { margin: 0, fontSize: '19px', lineHeight: '1.4', whiteSpace: 'pre-wrap' } })
    body = h('div', { style: { display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0 } }, box)
    body.paginate = () => {
      const pages = paginateToFit(box, text)
      const total2 = pages.length
      const p = Math.min(page, total2 - 1)
      box.textContent = pages[p]
      const pg = body.parentElement?.querySelector('.pager, .pager-slot')
      if (pg) pg.replaceWith(total2 > 1 ? pager({ page: p, total: total2, onPage: p2 => actions.overlayPage(p2), focusKey: 'overlay-pager' }) : h('span', { class: 'pager-slot' }))
    }
    title = h('span', { class: 'label' }, h('b', null, 'Your words'), ' · exactly as written')
    footer = [h('span', { class: 'pager-slot' }), primary('Back', close, { autofocus: true })]
  } else if (name === 'drafts') {
    const hist = state.ctx.statementHistory
    total = hist.length
    const entry = hist[Math.min(page, total - 1)]
    const current = entry.version === state.ctx.statement?.version
    const wide = !isNarrow()
    const how = entry.source === 'edited' ? 'your words'
      : entry.reason?.startsWith('refine:') ? `rewritten · ${(REFINEMENTS.find(r => r.variant === entry.variant) || {}).label?.toLowerCase() || 'another way'}`
        : entry.reason?.startsWith('restore:') ? `restored from draft ${entry.reason.split(':')[1]}`
          : 'written from your answers'
    title = h('span', { class: 'label' }, h('b', null, `Draft ${entry.version}`), ` · ${how}`)
    body = h('div', { style: { display: 'grid', gridTemplateRows: wide ? 'auto' : 'minmax(0, 1fr)', minHeight: 0, alignSelf: wide ? 'center' : null } },
      h('p', { class: 'statement', 'data-fit': '14,30', style: { margin: 0, maxHeight: wide ? 'min(60vh, 560px)' : null } }, entry.text))
    footer = [pager({ page, total, onPage: p2 => actions.overlayPage(p2), label: 'Draft', focusKey: 'overlay-pager' }),
      current ? primary('Back', close, { autofocus: true }) : primary('Use this draft', () => actions.useDraft(entry.version), { autofocus: true })]
  } else if (name === 'record') {
    const raw = state.payload ? summarizePayload(state.payload) : summarizePayload({ project: { title: state.ctx.statement?.title, statement: state.ctx.statement?.text }, discovery: { originalInput: state.ctx.submission?.text, answers: state.ctx.exchanges.filter(e => e.answer).map(e => ({ focus: e.focus, answer: e.answer.text || e.answer.label })), statementHistory: state.ctx.statementHistory } })
    const lines = raw.map(([k, v]) => [FOCUS_TITLES[k] || k, v])
    title = h('span', { class: 'label' }, h('b', null, 'Handoff record'), ` · ${state.payload ? 'as prepared · simulated' : 'preview'}`)
    body = pagedList({
      items: lines,
      page,
      onPage: p2 => actions.overlayPage(p2),
      focusKey: 'overlay-pager',
      renderItem: ([k, v], i) => h('div', { class: 'row' }, h('span', { class: 'num' }, String(i + 1).padStart(2, '0')), h('span', null, h('span', { class: 'k' }, k), h('span', { class: 'v', style: { WebkitLineClamp: 'unset', display: 'block' } }, v))),
      label: 'Record',
    })
    footer = [h('span'), primary('Back', close, { autofocus: true })]
  } else if (name === 'notes') {
    const notes = [...state.notes].reverse()
    const intro = [
      ['What is live', 'The classification at Begin: your words go to a Compás Caribe server function, which asks the Jev model (TypeSafe AI) three yes/no questions and applies fixed rules to the probabilities. Nothing is generated and nothing is routed on the result.'],
      ['What is simulated', 'Everything after that gate: discovery questions, reflections and the project statement are produced by deterministic rules in this browser. No generative model is called.'],
      ['What is real', 'The journey, the project context it builds, the limits on every text, the no-scroll layout and the handoff record are the real architecture. Each simulated step sits behind an interface a Claude model or Jev will replace.'],
    ]
    const items = [...intro.map(([k, v]) => ({ k, v })), ...notes.map(n => ({ k: `${n.stage || 'step'} · ${n.at?.slice(11, 19) || ''}`, v: noteText(n) }))]
    title = h('span', { class: 'label' }, h('b', null, 'Prototype notes'), ' · what is simulated')
    body = pagedList({
      items,
      page,
      onPage: p2 => actions.overlayPage(p2),
      focusKey: 'overlay-pager',
      renderItem: (it, i) => h('div', { class: 'row' }, h('span', { class: 'num' }, String(i + 1).padStart(2, '0')), h('span', null, h('span', { class: 'k' }, it.k), h('span', { class: 'v', style: { WebkitLineClamp: 'unset', display: 'block', fontSize: '14px' } }, it.v))),
      label: 'Notes',
    })
    footer = [h('span'), primary('Back', close, { autofocus: true })]
  }

  const el = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title0 },
    h('div', { class: 'ply-head' }, title),
    body,
    h('div', { class: 'ply-foot' }, footer))
  el.paginate = body.paginate || null
  return el
}

const gate = (state, actions) => gateView(state, actions, { head, foot, primary, ghost, ply, link })

export const VIEWS = {
  welcome, gate, qualifying, declined, uncertain, discovery, composing, statement, refine,
  continue: continueView, handoff, done,
}
