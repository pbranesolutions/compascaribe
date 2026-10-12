// Renderer: turns journey state into the shell (top bar + stage), manages
// focus and announcements, fits text to its boxes, and (in audit mode) proves
// nothing overflows after every render.

import { FOCUS_TITLES } from '../domain/discovery/questions.js'
import { strip, topBar, understandingPly } from './components.js'
import { clear, h } from './dom.js'
import { auditOverflow, describe, fitAll } from './fit.js'
import { VIEWS, overlay } from './views.js'

const TWO_PLY = new Set(['uncertain', 'discovery', 'composing', 'statement', 'refine', 'continue', 'handoff', 'done'])

export function createRenderer({ root, live, journey, audit = false }) {
  let lastKey = null
  let lastStage = null
  let composers = []

  function keyOf(s) {
    return JSON.stringify([
      s.stage, s.stepIndex, s.overlay, s.overlayPage, s.busy, s.error?.message || null, s.selection,
      s.ownWordsOpen, s.asideOpen, s.editorOpen, s.ctx.updatedAt, s.ctx.statement?.version || 0,
      s.receipt?.receiptId || null, s.notes.length, s.resumed, s.ctx.id,
    ])
  }

  function announce(s) {
    let msg = ''
    if (s.stage === 'discovery') {
      const ex = s.ctx.exchanges[s.stepIndex]
      if (ex) msg = `${FOCUS_TITLES[ex.focus]}, question ${s.stepIndex + 1} of ${s.ctx.exchanges.length}. ${ex.question}`
    } else if (s.stage === 'statement') msg = `Project statement, draft ${s.ctx.statement?.version || 1}, ready to review.`
    else if (s.stage === 'qualifying') msg = 'Reading your words.'
    else if (s.stage === 'composing') msg = 'Writing your project statement.'
    else if (s.stage === 'continue') msg = 'Your statement is ready. You can continue into Decision Channel.'
    else if (s.stage === 'done') msg = 'Handoff prepared. Prototype: nothing was transmitted.'
    else if (s.stage === 'declined') msg = 'This does not look like a project we build.'
    else if (s.stage === 'uncertain') msg = 'We are not sure yet. One more sentence will help.'
    else if (s.stage === 'welcome') msg = 'What would you like to build?'
    if (s.overlay) msg = `${s.overlay} opened.`
    if (s.error) msg = s.error.message
    if (msg && live) live.textContent = msg
  }

  function render(s = journey.state) {
    const key = keyOf(s)
    if (key === lastKey) return
    const stageChanged = s.stage !== lastStage
    lastKey = key
    lastStage = s.stage

    root.dataset.stage = s.stage
    root.dataset.step = String(Math.min(3, s.stepIndex))
    root.dataset.overlay = s.overlay ? 'true' : 'false'
    root.classList.toggle('is-busy', s.busy)

    const twoPly = TWO_PLY.has(s.stage) && Boolean(s.ctx.submission)
    const view = VIEWS[s.stage] || VIEWS.welcome
    const work = view(s, journey.actions)
    if (stageChanged) work.classList.add('enter')

    const stage = h('main', { class: `stage${twoPly ? '' : ' is-single'}`, id: 'stage' })
    if (twoPly) stage.append(strip(s, journey.actions))
    stage.append(work)
    if (twoPly) stage.append(understandingPly(s, journey.actions))
    const ov = overlay(s, journey.actions)
    if (ov) stage.append(ov)
    stage.append(h('div', { class: 'guard', hidden: true, 'aria-hidden': 'true' }, h('p', { class: 'question' }, 'Turn your phone upright to keep writing.')))

    clear(root)
    root.append(topBar(s, journey.actions), stage)

    composers = [...root.querySelectorAll('.composer')].filter(c => typeof c.measure === 'function')
    layout()
    focus(s, stageChanged)
    announce(s)
    if (audit) requestAnimationFrame(() => runAudit('render'))
  }

  const repaginate = () => {
    for (const el of root.querySelectorAll('.paged')) el.paginate?.()
    root.querySelector('.overlay')?.paginate?.()
  }

  function layout() {
    fitAll(root)
    for (const c of composers) c.measure()
    repaginate()
    // A second pass after fonts/metrics settle.
    requestAnimationFrame(() => {
      fitAll(root)
      for (const c of composers) c.measure()
      repaginate()
    })
  }

  function focus(s, stageChanged) {
    const target = root.querySelector('.overlay [data-autofocus]') || root.querySelector('[data-autofocus]')
    if (!target) return
    // Keep the visitor's caret if they are typing in the same field.
    if (!stageChanged && document.activeElement && document.activeElement.tagName === 'TEXTAREA' && document.activeElement.id === target.id) return
    try {
      target.focus({ preventScroll: true })
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        const n = target.value.length
        target.setSelectionRange(n, n)
      }
    } catch {
      /* ignore */
    }
  }

  function runAudit(reason) {
    const issues = auditOverflow(root)
    const result = { reason, at: new Date().toISOString(), viewport: `${window.innerWidth}x${window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight}`, stage: journey.state.stage, issues: issues.map(i => ({ el: describe(i.el), kind: i.kind, detail: i.detail })) }
    window.__ccAudit = result
    if (issues.length) console.warn('[cc audit] overflow', result)
    else console.info('[cc audit] clean', result.viewport, result.stage)
    for (const el of root.querySelectorAll('[data-audit-flag]')) delete el.dataset.auditFlag
    for (const i of issues) if (i.el instanceof HTMLElement) i.el.dataset.auditFlag = i.kind
    return result
  }

  return { render, layout, runAudit }
}
