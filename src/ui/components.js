// Shared UI pieces. Every component is a function returning a DOM element.

import { LIMITS } from '../domain/context.js'
import { FOCUS_TITLES } from '../domain/discovery/questions.js'
import { ROUTE } from '../app/journey.js'
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

// --- top bar ---------------------------------------------------------------

export function topBar(state, actions) {
  const routeIndex = ROUTE.findIndex(r => r.stages.includes(state.stage))
  const segs = ROUTE.map((r, i) => {
    const past = i < routeIndex
    const now = i === routeIndex
    const declined = state.stage === 'declined' && r.id === 'discovery'
    const cls = `route-seg${past ? ' is-past' : ''}${now ? ' is-now' : ''}${declined ? ' is-cap' : ''}`
    const props = { class: cls, style: { '--seg': STAGE_COLORS[r.id] }, 'aria-current': now ? 'step' : null }
    if (past && r.id === 'discovery' && state.ctx.exchanges.length) {
      return h('button', { ...props, type: 'button', title: r.label, 'aria-label': `Back to ${r.label}`, onClick: () => actions.revisit(state.ctx.exchanges.length - 1) })
    }
    if (past && r.id === 'statement' && state.ctx.statement) {
      return h('button', { ...props, type: 'button', title: r.label, 'aria-label': `Back to ${r.label}`, onClick: () => actions.back() })
    }
    return h('span', { ...props, title: r.label })
  })

  const readout = readoutFor(state)
  const hasWork = Boolean(state.ctx.submission) && state.stage !== 'welcome'

  return h('header', { class: 'bar', role: 'banner' },
    h('div', { class: 'brand' }, 'Compás Caribe',
      h('small', null, h('button', { type: 'button', class: 'link', style: { font: 'inherit', color: 'inherit', letterSpacing: 'inherit' }, onClick: () => actions.openOverlay('notes'), 'aria-label': 'Prototype notes: how the AI is simulated' }, 'Prototype · AI simulated'))),
    h('nav', { class: 'bar-mid', 'aria-label': 'Journey' },
      h('div', { class: 'route', role: 'list', 'aria-label': 'Route' }, segs)),
    h('div', { class: 'bar-end' },
      readout ? h('span', { class: 'readout', html: readout }) : null,
      hasWork && state.ctx.exchanges.length ? h('button', { type: 'button', class: 'link bar-understanding', onClick: () => actions.openOverlay(state.stage === 'done' || state.stage === 'handoff' ? 'record' : 'review') }, 'Understanding') : null,
      hasWork ? h('button', { type: 'button', class: 'link', onClick: () => actions.reset() }, 'Start over') : null),
    h('div', { class: 'route-bar', 'aria-hidden': 'true', style: { display: undefined } },
      h('div', { style: { display: 'grid', gridAutoFlow: 'column', gap: '3px', height: '3px' } },
        ROUTE.map((r, i) => h('span', { style: { background: i < routeIndex ? STAGE_COLORS[r.id] : i === routeIndex ? 'var(--ink)' : 'var(--hair)', outline: i < routeIndex ? '1px solid var(--ink)' : 'none', outlineOffset: '-1px', borderRadius: '2px' } })))),
  )
}

function readoutFor(state) {
  const s = state.stage
  if (s === 'discovery') {
    const ex = state.ctx.exchanges[state.stepIndex]
    return ex ? `<b>${FOCUS_TITLES[ex.focus]}</b> · ${state.stepIndex + 1} / ${state.ctx.exchanges.length}` : null
  }
  if (s === 'statement' || s === 'refine') return `<b>Statement</b> · Draft ${state.ctx.statement?.version || 1}`
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
  return h('button', { type: 'button', class: 'words', style: { textAlign: 'left', display: 'grid', gap: '4px', minWidth: 0 }, onClick: () => actions.openOverlay('words'), 'aria-label': 'Read your words in full' },
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
    if (!val) return h('span', { class: 'slot is-blank', 'aria-label': `${SLOT_LABEL[key]}: not yet known` }, h('span', { class: 'lbl' }, SLOT_LABEL[key]))
    if (interactive && ex) {
      // A span with button semantics: real <button>s cannot wrap inline across lines.
      const idx = state.ctx.exchanges.indexOf(ex)
      return h('span', {
        class: 'slot', role: 'button', tabIndex: 0,
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
    if (interactive) return h('button', { ...props, type: 'button', onClick: () => actions.revisit(i), 'aria-label': `${FOCUS_TITLES[e.focus]}: ${v || 'not yet answered'}. Revisit.` }, inner)
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
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, h('b', null, 'Your statement'), ' · travels with you')))
    children.push(h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr) auto' } },
      h('p', { class: 'statement', 'data-fit': '14,22', style: { margin: 0 } }, state.ctx.statement?.text || ''),
      pageTwoStub(state)))
    children.push(h('div', { class: 'ply-foot' }, h('span', { class: 'label' }, 'Page 2 is written in Decision Channel')))
  } else if (s === 'handoff' || s === 'done') {
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, h('b', null, 'Decision Channel'), ' · intake record · simulated')))
    children.push(h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr)' } }, recordRows(state, actions)))
    children.push(h('div', { class: 'ply-foot' }, h('button', { type: 'button', class: 'link', onClick: () => actions.openOverlay('record') }, 'Read the full record')))
  } else {
    children.push(h('div', { class: 'ply-head' }, h('span', { class: 'label' }, h('b', null, 'Understanding so far'), ' · simulated')))
    const sk = skeleton(state, actions, { fit: '14,26' })
    sk.style.maxHeight = 'var(--sk-max)'
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
    h('button', { type: 'button', class: 'row', onClick: () => actions.openOverlay('record'), 'aria-label': `${k}: ${v}. Read the full record.` },
      h('span', { class: 'num' }, n),
      h('span', null, h('span', { class: 'k' }, k), h('span', { class: 'v', 'data-clamp': 'preview' }, v)))))
}

export function strip(state, actions) {
  const s = state.stage
  if (s === 'continue' || s === 'handoff' || s === 'done') {
    return h('button', { type: 'button', class: 'strip', onClick: () => actions.openOverlay(s === 'continue' ? 'review' : 'record'), 'aria-label': 'Review your project' },
      h('span', { class: 'strip-labels' }, h('span', { class: 'is-filled' }, s === 'continue' ? 'Your statement' : 'Decision Channel record'), h('span', { class: 'strip-more' }, 'Review ›')),
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
  return h('button', { type: 'button', class: 'strip', onClick: () => actions.openOverlay('review'), 'aria-label': 'Understanding so far. Open to review or revisit.' },
    h('span', { class: 'strip-labels' }, labels.length ? labels : h('span', { class: 'is-filled' }, 'Understanding so far'), h('span', { class: 'strip-more' }, 'Simulated ›')),
    wide ? sentence : line)
}

// --- controls ---------------------------------------------------------------

/**
 * Fixed-height textarea with a dynamic maxlength: it never holds more than it
 * can show. `onInput(value)` is called on every change.
 */
export function composer({ id, value, limit, placeholder, onInput, onSubmit, label, hint, rows, autofocus, lang = 'en' }) {
  const count = h('span', { class: 'count' })
  const note = h('span', { class: 'note' }, hint || '')
  const folio = h('span', { class: 'folio' })
  const ta = h('textarea', {
    id,
    'aria-label': label,
    placeholder,
    maxLength: limit,
    enterkeyhint: 'enter',
    autocomplete: 'off',
    autocapitalize: 'sentences',
    spellcheck: 'true',
    lang,
    'data-autofocus': autofocus && !isTouch() ? 'true' : null,
    rows: rows || 3,
  })
  ta.value = value || ''
  let capacity = limit
  // Folios: when the text is longer than the box, the box shows one page at a
  // time, following the caret. Pages are flipped with the pager, never scrolled.
  const geometry = () => {
    const cs = getComputedStyle(ta)
    const lh = parseFloat(cs.lineHeight) || 24
    const padT = parseFloat(cs.paddingTop) || 0
    const padB = parseFloat(cs.paddingBottom) || 0
    const inner = ta.clientHeight - padT - padB
    const lines = Math.max(1, Math.floor(inner / lh))
    const pageH = lines * lh
    const contentH = ta.scrollHeight - padT - padB
    const overflowing = ta.scrollHeight > ta.clientHeight + 1
    const total = overflowing ? Math.max(1, Math.ceil(contentH / pageH)) : 1
    return { lh, padT, pageH, total }
  }
  const caretY = () => {
    const cs = getComputedStyle(ta)
    const m = document.createElement('div')
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'width']) m.style[prop] = cs[prop]
    m.style.cssText += ';position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;height:auto'
    m.style.width = `${ta.clientWidth}px`
    m.textContent = ta.value.slice(0, ta.selectionStart || 0) + '\u200b'
    document.body.appendChild(m)
    const y = m.scrollHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
    m.remove()
    return y
  }
  let pageIndex = 0
  const showPage = (p, { moveCaret = false } = {}) => {
    const g = geometry()
    pageIndex = Math.max(0, Math.min(p, g.total - 1))
    // Align the page to line boundaries: after page 0 the top padding scrolls away.
    const top = () => (pageIndex === 0 ? 0 : g.padT + pageIndex * g.pageH)
    ta.scrollTop = top()
    if (g.total > 1) {
      ta.dataset.clamp = 'folio'
      folio.replaceChildren(pager({ page: pageIndex, total: g.total, onPage: (np) => showPage(np, { moveCaret: true }), label: 'Page' }))
    } else {
      delete ta.dataset.clamp
      folio.replaceChildren()
    }
    if (moveCaret && g.total > 1) {
      // Put the caret on the first line of the chosen page so typing stays there.
      const target = pageIndex * g.pageH
      let lo = 0
      let hi = ta.value.length
      const probe = (i) => { ta.setSelectionRange(i, i); return caretY() }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (probe(mid) - geometry().lh < target) lo = mid
        else hi = mid
      }
      ta.setSelectionRange(pageIndex === 0 ? 0 : hi, pageIndex === 0 ? 0 : hi)
      ta.scrollTop = top()
      ta.focus({ preventScroll: true })
    }
  }
  const followCaret = () => {
    const g = geometry()
    if (g.total <= 1) return showPage(0)
    const y = caretY()
    showPage(Math.floor(Math.max(0, y - 1) / g.pageH))
  }
  const refreshCount = () => {
    const len = ta.value.length
    const max = Math.min(limit, Math.max(capacity, len))
    ta.maxLength = Math.max(max, len)
    count.textContent = `${len} / ${max}`
    count.classList.toggle('is-hot', len >= max * 0.9)
    const g = geometry()
    if (g.total > 1) note.textContent = 'Pages turn as you type'
    else note.textContent = capacity < limit && len >= capacity - 1 ? 'That is the space on this screen · detail comes next' : hint || ''
  }
  ta.addEventListener('input', () => {
    onInput(ta.value)
    refreshCount()
    followCaret()
  })
  ta.addEventListener('click', followCaret)
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') followCaret() })
  ta.addEventListener('scroll', () => { const g = geometry(); const want = pageIndex === 0 ? 0 : g.padT + pageIndex * g.pageH; if (Math.abs(ta.scrollTop - want) > 1) ta.scrollTop = want })
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmit?.()
    }
  })
  // No wheel/touch scrolling inside the textarea: it is sized to its content cap.
  ta.addEventListener('wheel', e => e.preventDefault(), { passive: false })
  ta.addEventListener('touchmove', e => e.preventDefault(), { passive: false })
  const wrap = h('div', { class: 'composer' }, ta, h('div', { class: 'composer-meta' }, note, h('span', { class: 'meta-end' }, folio, count)))
  const baseSize = () => parseFloat(ta.dataset.baseSize || (ta.dataset.baseSize = getComputedStyle(ta).fontSize))
  wrap.measure = () => {
    if (!ta.isConnected || ta.clientHeight < 20) return
    // Shrink the type (down to 13px) until the current text fits the box, so a
    // prefilled or resized composer never needs to scroll.
    const base = baseSize()
    let size = base
    const apply = (f) => {
      ta.style.fontSize = `${f}px`
      ta.style.lineHeight = `${Math.round(f * 1.42)}px`
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

export function lineInput({ id, value, limit, placeholder, onInput, onSubmit, label, autofocus }) {
  const count = h('span', { class: 'count' })
  const input = h('input', { id, type: 'text', 'aria-label': label, placeholder, maxLength: limit, autocomplete: 'off', enterkeyhint: 'done', 'data-autofocus': autofocus ? 'true' : null })
  input.value = value || ''
  const refresh = () => {
    count.textContent = `${input.value.length} / ${limit}`
    count.classList.toggle('is-hot', input.value.length >= limit * 0.9)
  }
  input.addEventListener('input', () => { onInput(input.value); refresh() })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit?.() } })
  refresh()
  return h('div', { class: 'composer', style: { gridTemplateRows: 'auto auto' } }, input, h('div', { class: 'composer-meta' }, h('span', null, 'Enter to continue'), count))
}

/** Radio-group of option bars with roving focus. */
export function optionList({ options, selected, onSelect, ownWordsLabel, onOwnWords, labelledBy, max }) {
  const shown = max ? options.slice(0, max) : options
  const group = h('div', { class: 'options', role: 'radiogroup', 'aria-labelledby': labelledBy })
  const buttons = shown.map((o, i) => h('button', {
    type: 'button',
    role: 'radio',
    class: 'option',
    'aria-checked': selected === o.id ? 'true' : 'false',
    tabIndex: selected === o.id || (!selected && i === 0) ? 0 : -1,
    'data-autofocus': i === 0 && !selected ? 'true' : selected === o.id ? 'true' : null,
    onClick: () => onSelect(o.id),
  }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'opt-text' }, o.label)))
  group.append(...buttons)
  if (ownWordsLabel) {
    group.append(h('button', { type: 'button', class: 'option is-own', onClick: onOwnWords }, h('span', { class: 'dot', 'aria-hidden': 'true', style: { borderStyle: 'dashed' } }), h('span', { class: 'opt-text' }, ownWordsLabel)))
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
 * get their own page and are type-fitted to it.
 */
export function pagedList({ items, page, onPage, renderItem, label = 'Page' }) {
  const list = h('div', { class: 'ledger' })
  const slot = h('div', { class: 'paged-pager', style: { display: 'flex', justifyContent: 'flex-start', minHeight: '0' } })
  const wrap = h('div', { class: 'paged' }, list, slot)
  wrap.paginate = () => {
    if (!wrap.isConnected) return
    const els = items.map((it, i) => renderItem(it, i))
    // Items fit by this list carry data-fit-page so the global fitter leaves them alone.
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
    // Measure natural heights with the list unconstrained.
    list.style.cssText = 'display:block;height:auto;max-height:none;overflow:visible'
    list.append(...els)
    const heights = els.map(el => el.offsetHeight + 1)
    list.style.cssText = ''
    clear(list)
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
    // A single item taller than the page: bound it and shrink its type.
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
            v.dataset.fit = v.dataset.fit || '12,16'
            fitText(v, { min: 12, max: 16 })
          }
        }
      }
    }
    slot.replaceChildren(pages.length > 1 ? pager({ page: p, total: pages.length, onPage, label }) : h('span', { class: 'label' }, `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`))
  }
  return wrap
}

/**
 * Prose that fits its box or pages itself, never scrolls. Tries the fit range
 * first; if the text does not fit at the floor size, it is split into pages at
 * the floor size with a local pager. `el.paginate()` runs after mount/resizes.
 * @param {{paragraphs: string[], fit?: string, className?: string, maxHeight?: string}} opts
 */
export function pagedText({ paragraphs, fit = '13,20', className = 'prose', maxHeight }) {
  const [min, max] = fit.split(',').map(Number)
  const box = h('div', { class: className, style: { whiteSpace: 'pre-wrap', margin: 0, minHeight: 0, maxHeight: maxHeight || null } })
  const slot = h('div', { class: 'paged-pager', style: { minHeight: 0 } })
  const wrap = h('div', { class: 'paged', style: { gridTemplateRows: maxHeight ? 'auto auto' : 'minmax(0, 1fr) auto' } }, box, slot)
  const full = paragraphs.filter(Boolean).join('\n\n')
  let page = 0
  let pages = [full]
  const show = () => {
    box.textContent = pages[page]
    slot.replaceChildren(pages.length > 1 ? pager({ page, total: pages.length, onPage: p => { page = p; show() } }) : h('span'))
  }
  wrap.paginate = () => {
    if (!wrap.isConnected) return
    box.textContent = full
    box.style.fontSize = ''
    const size = fitText(box, { min, max })
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

export function pager({ page, total, onPage, label = 'Page' }) {
  return h('div', { class: 'pager', role: 'group', 'aria-label': `${label} ${page + 1} of ${total}` },
    h('button', { type: 'button', disabled: page <= 0, onClick: () => onPage(page - 1), 'aria-label': 'Previous page' }, '‹'),
    h('span', null, `${page + 1} / ${total}`),
    h('button', { type: 'button', disabled: page >= total - 1, onClick: () => onPage(page + 1), 'aria-label': 'Next page' }, '›'))
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
