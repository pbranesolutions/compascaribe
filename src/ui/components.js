// Shared UI pieces. Every component is a function returning a DOM element.
// Interactive elements carry `data-focus-key` so the renderer can restore
// focus to "the same control" after a re-render.

import { LIMITS } from '../domain/context.js'
import { FOCUS_TITLES } from '../domain/discovery/vocabulary.js'
import { ROUTE } from '../app/route.js'
import { clear, h } from './dom.js'
import { capacityOf, fitText, paginateToFit } from './fit.js'

export const STAGE_COLORS = {
  welcome: 'var(--indigo)', qualifying: 'var(--wine)', discovery: 'var(--umber)',
  statement: 'var(--bone)', continue: 'var(--green)', handoff: 'var(--slate)',
}

export function isTouch() {
  return matchMedia('(pointer: coarse)').matches
}

export function isNarrow() {
  return window.innerWidth < 900 || (window.visualViewport ? window.visualViewport.height : window.innerHeight) < 540
}

/** How many ranked options fit comfortably: 4 on roomy screens, 3 otherwise. */
export function optionCapacity() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight
  return window.innerWidth >= 600 && h >= 700 ? 4 : 3
}

/** The focus key of the element that currently has focus, if any. */
export function activeFocusKey() {
  const el = document.activeElement
  return el && el.dataset ? el.dataset.focusKey || null : null
}

// --- top bar ---------------------------------------------------------------

export function topBar(state, actions) {
  const routeIndex = ROUTE.findIndex(r => r.stages.includes(state.stage))
  const segs = ROUTE.map((r, i) => {
    const past = i < routeIndex
    const now = i === routeIndex
    const declined = state.stage === 'declined' && r.id === 'discovery'
    const status = now ? 'current step' : past ? 'completed' : 'ahead'
    const cls = `route-seg${past ? ' is-past' : ''}${now ? ' is-now' : ''}${declined ? ' is-cap' : ''}`
    const sr = h('span', { class: 'sr-only' }, `${r.label}, ${status}`)
    const props = { class: cls, style: { '--seg': STAGE_COLORS[r.id] }, 'aria-current': now ? 'step' : null, title: r.label }
    let inner
    if (past && ((r.id === 'discovery' && state.ctx.exchanges.length) || (r.id === 'statement' && state.ctx.statement) || (r.id === 'continue' && state.ctx.statement))) {
      inner = h('button', { ...props, type: 'button', 'data-focus-key': `route:${r.id}`, onClick: () => actions.jump(r.id) }, sr)
    } else {
      inner = h('span', props, sr)
    }
    return h('span', { role: 'listitem', class: 'route-item' }, inner)
  })

  // Engineering labels (live model, stage readouts) are for ?diagnostics; the first conversation is customer-facing.
  const dev = document.documentElement.dataset.diagnostics === 'true'
  const readout = state.stage === 'conversation' && !dev ? null : readoutFor(state)
  const hasWork = Boolean(state.ctx.submission) && state.stage !== 'welcome'
  // Progress is shown once there is progress to show: not before the visitor has begun.
  // The gate is a diagnostic end point: there is no route beyond it to show.
  const showRoute = state.stage !== 'welcome' && state.stage !== 'gate' && state.stage !== 'conversation'
  // The landing page has one purpose: describing the project. Prototype notes
  // are offered once there is simulated output to explain.
  const onLanding = state.stage === 'welcome'
  // The gate and the first conversation are the live AI steps; every other stage after the landing page is simulated.
  const live = state.stage === 'gate' || state.stage === 'conversation'
  const liveLabel = state.stage === 'conversation' ? (dev ? 'Live · AI reply' : null) : 'Live · Jev classification'
  const understandingTarget = state.stage === 'done' || state.stage === 'handoff' ? 'record' : 'review'

  return h('header', { class: 'bar', role: 'banner' },
    h('div', { class: 'brand' }, 'Compás Caribe',
      live ? (liveLabel ? h('small', null, liveLabel) : null) : onLanding ? null : h('small', null, h('button', { type: 'button', class: 'link', 'data-focus-key': 'bar:notes', style: { font: 'inherit', color: 'inherit', letterSpacing: 'inherit' }, onClick: () => actions.openOverlay('notes', 0, 'bar:notes'), 'aria-label': 'Prototype notes: how the AI is simulated' }, 'Prototype · AI simulated'))),
    showRoute
      ? h('nav', { class: 'bar-mid', 'aria-label': 'Journey' },
        h('div', { class: 'route', role: 'list', 'aria-label': 'Route through the journey' }, segs))
      : h('div', { class: 'bar-mid' }),
    h('div', { class: 'bar-end' },
      readout ? h('span', { class: 'readout', html: readout }) : null,
      onLanding || live ? null : h('button', { type: 'button', class: 'link bar-notes', 'data-focus-key': 'bar:notes-tiny', onClick: () => actions.openOverlay('notes', 0, 'bar:notes-tiny') }, 'Simulated'),
      hasWork && state.ctx.exchanges.length ? h('button', { type: 'button', class: 'link bar-understanding', 'data-focus-key': 'bar:understanding', onClick: () => actions.openOverlay(understandingTarget, 0, 'bar:understanding') }, 'Understanding') : null,
      hasWork ? h('button', { type: 'button', class: 'link', 'data-focus-key': 'bar:reset', onClick: () => actions.reset() }, 'Start over') : null),
    showRoute ? h('div', { class: 'route-bar', 'aria-hidden': 'true' },
      h('div', { style: { display: 'grid', gridAutoFlow: 'column', gap: '3px', height: '3px' } },
        ROUTE.map((r, i) => h('span', { style: { background: i < routeIndex ? STAGE_COLORS[r.id] : i === routeIndex ? 'var(--ink)' : 'var(--hair)', outline: i < routeIndex ? '1px solid var(--ink)' : 'none', outlineOffset: '-1px', borderRadius: '2px' } })))) : null,
  )
}

function readoutFor(state) {
  const s = state.stage
  if (s === 'discovery') {
    const ex = state.ctx.exchanges[state.stepIndex]
    return ex ? `<b>${FOCUS_TITLES[ex.focus]}</b> · ${state.stepIndex + 1} / ${state.ctx.exchanges.length}` : null
  }
  if (s === 'statement' || s === 'refine') return `<b>Statement</b> · Draft ${state.ctx.statement?.version || 1}`
  if (s === 'gate') return '<b>Jev gate</b>'
  if (s === 'conversation') return '<b>Conversation</b>'
  if (s === 'qualifying') return '<b>Reading</b>'
  if (s === 'composing') return '<b>Writing</b>'
  if (s === 'continue') return '<b>Continue</b>'
  if (s === 'handoff' || s === 'done') return '<b>Decision Channel</b>'
  if (s === 'uncertain') return '<b>Not sure yet</b>'
  if (s === 'declined') return '<b>Not a project</b>'
  return null
}

// --- understanding ply (desktop) and strip (mobile) ----------------------

export function yourWords(state, actions, { lines = 3 } = {}) {
  const text = state.ctx.submission?.text || ''
  const extra = state.ctx.clarifications.length ? ` + ${state.ctx.clarifications.length} addition${state.ctx.clarifications.length > 1 ? 's' : ''}` : ''
  return h('button', { type: 'button', class: 'words', 'data-focus-key': 'words', style: { textAlign: 'left', display: 'grid', gap: '4px', minWidth: 0 }, onClick: () => actions.openOverlay('words', 0, 'words'), 'aria-label': 'Read your words in full' },
    h('span', { class: 'label' }, 'Your words', extra),
    h('span', { class: 'prose', 'data-clamp': 'preview', style: { fontSize: '15px', lineHeight: '1.3', display: '-webkit-box', WebkitLineClamp: String(lines), WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, text))
}

const SLOT_LABEL = { who: 'who', capability: 'objective', outcome: 'why', current: 'today', success: 'success' }

export function skeleton(state, actions, { fit = '14,24', interactive = true } = {}) {
  const sk = state.sketch
  const exByFocus = Object.fromEntries(state.ctx.exchanges.map(e => [e.focus, e]))
  const slot = (key) => {
    const val = sk ? sk[key] : null
    const focus = sk ? sk.focusFor[key] : null
    const ex = focus ? exByFocus[focus] : null
    if (!val) {
      return h('span', { class: 'slot is-blank' },
        h('span', { class: 'sr-only' }, `${SLOT_LABEL[key]}: not yet known`),
        h('span', { class: 'lbl', 'aria-hidden': 'true' }, SLOT_LABEL[key]))
    }
    if (interactive && ex) {
      // A span with button semantics: real <button>s cannot wrap inline across lines.
      const idx = state.ctx.exchanges.indexOf(ex)
      return h('span', {
        class: 'slot', role: 'button', tabIndex: 0, 'data-focus-key': `slot:${key}`,
        'aria-label': `${SLOT_LABEL[key]}: ${val}. Revisit this answer.`,
        onClick: () => actions.revisit(idx),
        onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.revisit(idx) } },
      }, val)
    }
    return h('span', { class: 'slot', style: { cursor: 'default' } }, val)
  }
  return h('p', { class: 'skeleton', 'data-fit': fit, style: { margin: 0 } },
    'This project gives ', slot('who'), ' one dependable way to ', slot('capability'), ', so that ', slot('outcome'), '. Today ', slot('current'), '; it will have worked when ', slot('success'), '.')
}

export function ledger(state, actions, { interactive = true, numbered = true } = {}) {
  const rows = state.ctx.exchanges.map((e, i) => {
    const v = e.answer ? e.answer.text || e.answer.label : null
    const props = { class: `row${v ? '' : ' is-stub'}` }
    const inner = [
      h('span', { class: 'num' }, numbered ? String(i + 1).padStart(2, '0') : ''),
      h('span', null, h('span', { class: 'k' }, FOCUS_TITLES[e.focus]), h('span', { class: 'v', 'data-clamp': interactive ? 'preview' : null }, v || 'not yet answered')),
    ]
    if (interactive) return h('button', { ...props, type: 'button', 'data-focus-key': `ledger:${e.focus}`, onClick: () => actions.revisit(i), 'aria-label': `${FOCUS_TITLES[e.focus]}: ${v || 'not yet answered'}. Revisit.` }, inner)
    return h('div', props, inner)
  })
  return h('div', { class: 'ledger' }, rows)
}

export function understandingPly(state, actions) {
  const s = state.stage
  const children = []
  if (s === 'statement' || s === 'refine') {
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, 'Built from your answers')))
    children.push(h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto auto', gap: '18px' } }, ledger(state, actions), yourWords(state, actions, { lines: 3 })))
    children.push(h('div', { class: 'ply-foot' }, h('span', { class: 'label' }, 'Select a row to change that answer')))
  } else if (s === 'continue') {
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, h('b', null, 'Your statement'), ' · goes with you')))
    children.push(h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr) auto' } },
      h('p', { class: 'statement', 'data-fit': '14,22', style: { margin: 0 } }, state.ctx.statement?.text || ''),
      pageTwoStub(state)))
    children.push(h('div', { class: 'ply-foot' }, h('span', { class: 'label' }, 'Page 2 is written in Decision Channel')))
  } else if (s === 'handoff' || s === 'done') {
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, h('b', null, 'Decision Channel'), ' · intake record · simulated')))
    children.push(h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr)' } }, recordRows(state, actions)))
    children.push(h('div', { class: 'ply-foot' }, h('button', { type: 'button', class: 'link', 'data-focus-key': 'record:open', onClick: () => actions.openOverlay('record', 0, 'record:open') }, 'Read the full record')))
  } else {
    const sk = skeleton(state, actions, { fit: '14,26' })
    sk.style.maxHeight = 'var(--sk-max)'
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, h('b', null, 'Understanding so far'), ' · simulated')))
    children.push(h('div', { class: 'ply-body', style: { gridTemplateRows: 'auto auto' } }, yourWords(state, actions, { lines: 3 }), sk))
    children.push(h('div', { class: 'ply-foot' }, h('span', { class: 'label' }, state.ctx.exchanges.some(e => e.answer) ? 'Select a filled part to revisit it' : 'Each answer fills in a part of the statement')))
  }
  return h('aside', { class: 'ply ply-understand', 'aria-label': 'Understanding so far' }, children)
}

export function pageTwoStub(state) {
  const success = state.sketch?.success
  return h('div', { class: 'ledger', style: { marginTop: '8px' } },
    h('div', { class: 'label', style: { padding: '6px 0' } }, 'Page 2 · Functional requirements'),
    h('div', { class: 'row is-stub' }, h('span', { class: 'num' }, 'R-01'), h('span', null, h('span', { class: 'v' }, success ? `Measure: ${success}` : 'Measure of success'))),
    h('div', { class: 'row is-stub' }, h('span', { class: 'num' }, 'R-02'), h('span', null, h('span', { class: 'v' }, 'first decision, taken together'))),
    h('div', { class: 'row is-stub' }, h('span', { class: 'num' }, 'R-03'), h('span', null, h('span', { class: 'v' }, '—'))))
}

export function recordRows(state, actions) {
  const st = state.ctx.statement
  const rows = [
    ['01', 'Project', st?.title || '—'],
    ['02', 'Statement', st?.text || '—'],
    ...state.ctx.exchanges.filter(e => e.answer).map((e, i) => [String(i + 3).padStart(2, '0'), FOCUS_TITLES[e.focus], e.answer.text || e.answer.label]),
  ]
  return h('div', { class: 'ledger' }, rows.map(([n, k, v]) =>
    h('button', { type: 'button', class: 'row', 'data-focus-key': `record:${n}`, onClick: () => actions.openOverlay('record', 0, `record:${n}`), 'aria-label': `${k}: ${v}. Read the full record.` },
      h('span', { class: 'num' }, n),
      h('span', null, h('span', { class: 'k' }, k), h('span', { class: 'v', 'data-clamp': 'preview' }, v)))))
}

export function strip(state, actions) {
  const s = state.stage
  if (s === 'continue' || s === 'handoff' || s === 'done') {
    const target = s === 'continue' ? 'review' : 'record'
    return h('button', { type: 'button', class: 'strip', 'data-focus-key': 'strip', onClick: () => actions.openOverlay(target, 0, 'strip'), 'aria-label': 'Review your project' },
      h('span', { class: 'strip-labels', 'data-clamp': 'preview' }, h('span', { class: 'is-filled' }, s === 'continue' ? 'Your statement' : 'Decision Channel record'), h('span', { class: 'strip-more' }, 'Review ›')),
      h('span', { class: 'strip-line', 'data-clamp': 'preview' }, state.ctx.statement?.text || ''))
  }
  const labels = state.ctx.exchanges.map(e => h('span', { class: e.answer ? 'is-filled' : '' }, FOCUS_TITLES[e.focus]))
  const last = [...state.ctx.exchanges].reverse().find(e => e.answer)
  const line = last
    ? h('span', { class: 'strip-line', 'data-clamp': 'preview' }, h('span', { class: 'lbl' }, FOCUS_TITLES[last.focus]), last.answer.text || last.answer.label)
    : h('span', { class: 'strip-line', 'data-clamp': 'preview' }, h('span', { class: 'lbl' }, 'Your words'), state.ctx.submission?.text || '')
  const wide = window.innerWidth >= 600
  const sentence = wide ? skeleton(state, actions, { fit: '16,16', interactive: false }) : null
  if (sentence) {
    sentence.classList.add('strip-sentence')
    sentence.dataset.clamp = 'preview'
    delete sentence.dataset.fit
  }
  return h('button', { type: 'button', class: 'strip', 'data-focus-key': 'strip', onClick: () => actions.openOverlay('review', 0, 'strip'), 'aria-label': 'Understanding so far: review or revisit your answers' },
    h('span', { class: 'strip-labels', 'data-clamp': 'preview' }, labels.length ? labels : h('span', { class: 'is-filled' }, 'Understanding so far'), h('span', { class: 'strip-more' }, 'Review ›')),
    wide ? sentence : line)
}

// --- controls ---------------------------------------------------------------

/**
 * Fixed-height textarea that never scrolls. It holds at most what it can show
 * (dynamic maxlength); when a prefilled or resized text is longer than the
 * box, it shows folios: whole-line pages that follow the caret, flipped with
 * a pager. The textarea itself has no padding or border, so a page is an
 * exact number of lines; the frame around it carries the look.
 *
 * Options for the landing page:
 *   grow        { minLines, room }  Start small and add whole lines as the text
 *               grows, up to room() px of frame height. The limit stays the
 *               same on every screen; text beyond the box turns into pages.
 *   quietCount  Show "N characters left" only once the limit is near.
 *   action      A node (the primary button) placed in the meta row, so the
 *               action reads as the continuation of the field.
 */
export function composer({ id, value, limit, placeholder, onInput, onSubmit, label, hint, rows, autofocus, enterSubmits = false, lang = 'en', grow = null, quietCount = false, action = null }) {
  const count = h('span', { class: 'count' })
  const note = h('span', { class: 'note', 'aria-live': grow ? 'polite' : null }, hint || '')
  const folio = h('span', { class: 'folio' })
  const ta = h('textarea', {
    id,
    'aria-label': label,
    placeholder,
    maxLength: limit,
    enterkeyhint: enterSubmits ? 'done' : 'enter',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'true',
    lang,
    'data-autofocus': autofocus && !isTouch() ? 'true' : null,
    'data-focus-key': `composer:${id}`,
    rows: rows || 3,
  })
  ta.value = value || ''
  const frame = h('div', { class: 'ta-frame' }, ta)

  let capacity = limit
  let lineH = 26
  let lines = 3
  let pageIndex = 0

  const geometry = () => {
    const pageH = lines * lineH
    const contentH = ta.scrollHeight
    const overflowing = contentH > ta.clientHeight + 1
    const total = overflowing ? Math.max(1, Math.ceil(contentH / pageH)) : 1
    return { pageH, total }
  }
  const caretY = () => {
    const cs = getComputedStyle(ta)
    const m = document.createElement('div')
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) m.style[prop] = cs[prop]
    m.style.cssText += ';position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;height:auto;padding:0;border:0'
    m.style.width = `${ta.clientWidth}px`
    m.textContent = ta.value.slice(0, ta.selectionStart || 0) + '​'
    document.body.appendChild(m)
    const y = m.scrollHeight
    m.remove()
    return y
  }
  const showPage = (p, { moveCaret = false } = {}) => {
    const g = geometry()
    pageIndex = Math.max(0, Math.min(p, g.total - 1))
    const top = pageIndex * g.pageH
    ta.scrollTop = top
    if (g.total > 1) {
      ta.dataset.clamp = 'folio'
      folio.replaceChildren(pager({ page: pageIndex, total: g.total, onPage: (np) => showPage(np, { moveCaret: true }), label: 'Page', focusKey: `folio:${id}` }))
    } else {
      delete ta.dataset.clamp
      folio.replaceChildren()
    }
    if (moveCaret && g.total > 1) {
      // Put the caret on the first line of the chosen page so typing stays there.
      let lo = 0
      let hi = ta.value.length
      const probe = (i) => { ta.setSelectionRange(i, i); return caretY() }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (probe(mid) - lineH < top) lo = mid
        else hi = mid
      }
      const at = pageIndex === 0 ? 0 : hi
      ta.setSelectionRange(at, at)
      ta.scrollTop = top
      ta.focus({ preventScroll: true })
    }
  }
  const followCaret = () => {
    const g = geometry()
    if (g.total <= 1) return showPage(0)
    const y = caretY()
    showPage(Math.floor(Math.max(0, y - 1) / g.pageH))
  }
  // Whole lines the current text needs at the current width (matches the textarea's wrapping).
  const neededLines = (text = ta.value) => {
    const cs = getComputedStyle(ta)
    const m = document.createElement('div')
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'wordSpacing']) m.style[prop] = cs[prop]
    m.style.cssText += ';position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;height:auto;padding:0;border:0'
    m.style.width = `${ta.clientWidth}px`
    m.textContent = text + '\u200b'
    document.body.appendChild(m)
    const hgt = m.scrollHeight
    m.remove()
    return Math.max(1, Math.round(hgt / lineH))
  }
  const growNow = () => {
    ta.style.fontSize = ''
    ta.style.lineHeight = ''
    const cs = getComputedStyle(ta)
    lineH = parseFloat(cs.lineHeight) || Math.round(parseFloat(cs.fontSize) * 1.42)
    const fcs = getComputedStyle(frame)
    const padV = (parseFloat(fcs.paddingTop) || 0) + (parseFloat(fcs.paddingBottom) || 0)
    const roomLines = Math.max(1, Math.floor((grow.room() - padV) / lineH))
    // At rest the box is as small as it can be while still showing the whole prompt.
    const minLines = Math.min(Math.max(grow.minLines || 2, ta.placeholder ? neededLines(ta.placeholder) : 1), roomLines)
    lines = Math.max(minLines, Math.min(neededLines(), roomLines))
    ta.style.height = `${lines * lineH}px`
  }
  const countLabel = (left) => {
    const over = left < 0
    count.replaceChildren(h('b', null, String(Math.abs(left))), h('span', { class: 'long' }, ' characters'), over ? ' over' : ' left')
  }
  const refreshCount = () => {
    const len = ta.value.length
    // Never below what is already written, so existing text is never cut.
    const max = grow ? limit : Math.min(limit, Math.max(capacity, len))
    ta.maxLength = Math.max(max, len)
    if (quietCount) {
      if (len >= max * 0.6) countLabel(max - len)
      else count.replaceChildren()
    } else {
      count.textContent = `${len} / ${max}`
    }
    count.classList.toggle('is-hot', len >= max * 0.9)
    const g = geometry()
    if (g.total > 1) note.textContent = 'Pages turn as you type'
    else if (grow) note.textContent = len >= max ? 'That is the limit here · detail comes next' : hint || ''
    else note.textContent = capacity < limit && len >= capacity - 1 ? 'That is the space on this screen · detail comes next' : hint || ''
  }
  ta.addEventListener('input', () => {
    onInput(ta.value)
    if (grow) growNow()
    refreshCount()
    followCaret()
  })
  ta.addEventListener('click', followCaret)
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') followCaret() })
  ta.addEventListener('scroll', () => { const want = pageIndex * geometry().pageH; if (Math.abs(ta.scrollTop - want) > 1) ta.scrollTop = want })
  ta.addEventListener('keydown', (e) => {
    if (((e.ctrlKey || e.metaKey) && e.key === 'Enter') || (enterSubmits && e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault()
      onSubmit?.()
    }
  })
  // No wheel/touch scrolling inside the textarea: it is paged, not scrolled.
  ta.addEventListener('wheel', e => e.preventDefault(), { passive: false })
  ta.addEventListener('touchmove', e => e.preventDefault(), { passive: false })

  const wrap = h('div', { class: 'composer' }, frame, h('div', { class: 'composer-meta' }, note, h('span', { class: 'meta-end' }, folio, count), action))
  const baseSize = () => parseFloat(ta.dataset.baseSize || (ta.dataset.baseSize = getComputedStyle(ta).fontSize))
  wrap.measure = () => {
    if (grow) {
      if (!frame.isConnected) return
      growNow()
      refreshCount()
      followCaret()
      return
    }
    if (!frame.isConnected || frame.clientHeight < 20) return
    // Shrink the type (down to 13px) until the current text fits the frame,
    // then size the textarea to a whole number of lines.
    const fcs = getComputedStyle(frame)
    const inner = frame.clientHeight - parseFloat(fcs.paddingTop || '0') - parseFloat(fcs.paddingBottom || '0')
    let size = baseSize()
    const apply = (f) => {
      lineH = Math.round(f * 1.42)
      lines = Math.max(1, Math.floor(inner / lineH))
      ta.style.fontSize = `${f}px`
      ta.style.lineHeight = `${lineH}px`
      ta.style.height = `${lines * lineH}px`
    }
    apply(size)
    while (ta.scrollHeight > ta.clientHeight + 1 && size > 13) {
      size = Math.max(13, size - 1)
      apply(size)
    }
    capacity = Math.max(40, capacityOf(ta, ta.value))
    refreshCount()
    followCaret()
  }
  wrap.textarea = ta
  queueMicrotask(refreshCount)
  return wrap
}

/** Radio-group of option bars with roving focus. */
export function optionList({ options, selected, onSelect, ownWordsLabel, onOwnWords, labelledBy, max, disabled = false }) {
  const shown = max ? options.slice(0, max) : options
  const group = h('div', { class: 'options', role: 'radiogroup', 'aria-labelledby': labelledBy, 'aria-disabled': disabled ? 'true' : null })
  const buttons = shown.map((o, i) => h('button', {
    type: 'button',
    role: 'radio',
    class: 'option',
    'aria-checked': selected === o.id ? 'true' : 'false',
    tabIndex: selected === o.id || (!selected && i === 0) ? 0 : -1,
    'data-autofocus': i === 0 && !selected ? 'true' : selected === o.id ? 'true' : null,
    'data-focus-key': `option:${o.id}`,
    disabled,
    onClick: () => onSelect(o.id),
  }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'opt-text' }, o.label)))
  group.append(...buttons)
  if (ownWordsLabel) {
    group.append(h('button', { type: 'button', class: 'option is-own', 'data-focus-key': 'option:own', disabled, onClick: onOwnWords }, h('span', { class: 'dot', 'aria-hidden': 'true', style: { borderStyle: 'dashed' } }), h('span', { class: 'opt-text' }, ownWordsLabel)))
  }
  group.addEventListener('keydown', (e) => {
    const items = [...group.querySelectorAll('[role="radio"]')]
    const idx = items.indexOf(document.activeElement)
    if (idx === -1) return
    let next = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = items[(idx + 1) % items.length]
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = items[(idx - 1 + items.length) % items.length]
    if (e.key === 'Home') next = items[0]
    if (e.key === 'End') next = items[items.length - 1]
    if (next) {
      e.preventDefault()
      next.focus()
      next.click()
    }
  })
  return group
}

/**
 * A list that pages itself by measured height instead of scrolling. Call
 * `el.paginate()` after mount (and after resizes). Items taller than a page
 * get their own page and are type-fitted to it; a value that still does not
 * fit at the floor size is split across pages.
 */
export function pagedList({ items, page, onPage, renderItem, label = 'Page', focusKey = 'pager', units = ['entry', 'entries'] }) {
  const list = h('div', { class: 'ledger' })
  const slot = h('div', { class: 'paged-pager', style: { display: 'flex', justifyContent: 'flex-start', minHeight: '0' } })
  const wrap = h('div', { class: 'paged' }, list, slot)
  // `wrap.page` may be changed by the caller before `paginate()` to turn the page without a re-render.
  wrap.page = page
  wrap.paginate = () => {
    if (!wrap.isConnected) return
    const page = wrap.page
    let els = items.map((it, i) => renderItem(it, i))
    for (const el of els) {
      if (el.dataset.fit) {
        el.dataset.fitPage = el.dataset.fit
        delete el.dataset.fit
      }
      el.style.maxHeight = ''
      el.style.fontSize = ''
      for (const v of el.querySelectorAll('[data-fit]')) v.style.fontSize = ''
    }
    clear(list)
    const limit = list.clientHeight
    if (!limit) return
    const measure = (arr) => {
      list.style.cssText = 'display:block;height:auto;max-height:none;overflow:visible'
      list.append(...arr)
      const hs = arr.map(el => el.offsetHeight + 1)
      list.style.cssText = ''
      clear(list)
      return hs
    }
    let heights = measure(els)
    // Split values that cannot fit a page even at the floor size.
    const expanded = []
    els.forEach((el, i) => {
      const v = el.querySelector('.v')
      if (heights[i] > limit && v && !el.dataset.fitPage) {
        const text = v.textContent
        const probe = el.cloneNode(true)
        probe.style.cssText = 'position:absolute;left:-99999px;width:' + list.clientWidth + 'px'
        list.parentElement.appendChild(probe)
        const pv = probe.querySelector('.v')
        pv.style.fontSize = '13px'
        pv.style.lineHeight = '1.3'
        pv.style.maxHeight = `${Math.max(40, limit - 40)}px`
        pv.style.height = `${Math.max(40, limit - 40)}px`
        const slices = paginateToFit(pv, text)
        probe.remove()
        if (slices.length > 1) {
          slices.forEach((s, k) => {
            const part = el.cloneNode(true)
            const pvv = part.querySelector('.v')
            pvv.textContent = s
            pvv.style.fontSize = '13px'
            pvv.style.lineHeight = '1.3'
            const kEl = part.querySelector('.k')
            if (kEl && k > 0) kEl.textContent = `${kEl.textContent} (cont.)`
            expanded.push(part)
          })
          return
        }
      }
      expanded.push(el)
    })
    if (expanded.length !== els.length) {
      els = expanded
      heights = measure(els)
    }
    const pages = []
    let cur = []
    let acc = 0
    els.forEach((el, i) => {
      const hgt = heights[i]
      if (acc + hgt > limit && cur.length) {
        pages.push(cur)
        cur = []
        acc = 0
      }
      cur.push(el)
      acc += hgt
    })
    if (cur.length) pages.push(cur)
    const p = Math.max(0, Math.min(page, pages.length - 1))
    list.append(...pages[p])
    for (const el of pages[p]) {
      if (el.offsetHeight > limit || heights[els.indexOf(el)] > limit) {
        el.style.maxHeight = `${limit}px`
        el.style.overflow = 'hidden'
        if (el.dataset.fitPage) {
          const [mn, mx] = el.dataset.fitPage.split(',').map(Number)
          fitText(el, { min: mn || 12, max: mx || 20 })
        } else {
          const v = el.querySelector('.v')
          if (v) {
            v.style.maxHeight = `${Math.max(40, limit - 36)}px`
            fitText(v, { min: 12, max: 16 })
          }
        }
      }
    }
    slot.replaceChildren(pages.length > 1 ? pager({ page: p, total: pages.length, onPage, label, focusKey }) : h('span', { class: 'label' }, `${items.length} ${items.length === 1 ? units[0] : units[1]}`))
  }
  return wrap
}

/**
 * Prose that fits its box or pages itself, never scrolls. Tries the fit range
 * first; if the text does not fit at the floor size, it is split into pages at
 * the floor size with a local pager. `el.paginate()` runs after mount/resizes.
 */
export function pagedText({ paragraphs, fit = '13,20', className = 'prose', maxHeight, focusKey = 'text-pager' }) {
  const [min, max] = fit.split(',').map(Number)
  const box = h('div', { class: className, style: { whiteSpace: 'pre-wrap', margin: 0, minHeight: 0, maxHeight: maxHeight || null } })
  const slot = h('div', { class: 'paged-pager', style: { minHeight: 0 } })
  const wrap = h('div', { class: 'paged', style: { gridTemplateRows: maxHeight ? 'auto auto' : 'minmax(0, 1fr) auto' } }, box, slot)
  const full = paragraphs.filter(Boolean).join('\n\n')
  let page = 0
  let pages = [full]
  const show = () => {
    box.textContent = pages[page]
    slot.replaceChildren(pages.length > 1 ? pager({ page, total: pages.length, onPage: p => { page = p; show() }, label: 'Page', focusKey }) : h('span'))
  }
  wrap.paginate = () => {
    if (!wrap.isConnected) return
    box.textContent = full
    box.style.fontSize = ''
    // A stylesheet may set the range per composition with --fit-min / --fit-max (px), as fitAll does for [data-fit].
    const cs = getComputedStyle(box)
    const cssMin = parseFloat(cs.getPropertyValue('--fit-min'))
    const cssMax = parseFloat(cs.getPropertyValue('--fit-max'))
    const size = fitText(box, { min: cssMin > 0 ? cssMin : min, max: cssMax > 0 ? cssMax : max })
    if (!box.dataset.overflow) {
      pages = [full]
      page = 0
      show()
      return
    }
    delete box.dataset.overflow
    box.style.fontSize = `${size}px`
    pages = paginateToFit(box, full)
    page = Math.min(page, pages.length - 1)
    show()
  }
  queueMicrotask(() => wrap.paginate())
  return wrap
}

export function pager({ page, total, onPage, label = 'Page', focusKey = 'pager' }) {
  const go = (dir, p) => {
    onPage(p)
    // Keep keyboard focus on the pager after the page changes (the pager may
    // have been re-rendered). Falls back to the other arrow at either end.
    queueMicrotask(() => {
      const same = document.querySelector(`[data-focus-key="${focusKey}:${dir}"]`)
      const target = same && !same.disabled ? same : document.querySelector(`[data-focus-key^="${focusKey}:"]:not(:disabled)`)
      const active = document.activeElement
      if (target && active !== target && (active === document.body || active?.dataset?.focusKey?.startsWith(focusKey) || active?.dataset?.autofocus)) target.focus({ preventScroll: true })
    })
  }
  return h('div', { class: 'pager', role: 'group', 'aria-label': `${label} ${page + 1} of ${total}` },
    h('button', { type: 'button', disabled: page <= 0, 'data-focus-key': `${focusKey}:prev`, onClick: () => go('prev', page - 1), 'aria-label': 'Previous page' }, '‹'),
    h('span', { 'aria-hidden': 'true' }, `${page + 1} / ${total}`),
    h('button', { type: 'button', disabled: page >= total - 1, 'data-focus-key': `${focusKey}:next`, onClick: () => go('next', page + 1), 'aria-label': 'Next page' }, '›'))
}

/** Always returns an element so grid rows stay stable; empty when no error. */
export function errorLine(state) {
  return h('div', { class: 'error-slot' }, state.error ? h('div', { class: 'error', role: 'alert' }, state.error.message) : null)
}

export function processing(steps, activeIndex) {
  return h('div', { class: 'steps', 'aria-live': 'off' }, steps.map((s, i) =>
    h('div', { class: `step${i < activeIndex ? ' is-done' : i === activeIndex ? ' is-now' : ''}` }, h('span', { class: 'pip' }), h('span', null, s))))
}

export { LIMITS }
