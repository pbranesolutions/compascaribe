// Renderer: turns journey state into the shell (top bar + stage), manages
// focus and announcements, fits text to its boxes, and (in audit mode) proves
// nothing overflows after every render.

import { latestOpening } from '../domain/context.js'
import { FOCUS_TITLES, OVERLAY_TITLES } from '../domain/discovery/vocabulary.js'
import { activeFocusKey, strip, topBar, understandingPly } from './components.js'
import { clear, h } from './dom.js'
import { auditOverflow, describe, fitAll } from './fit.js'
import { VIEWS, overlay } from './views.js'

const TWO_PLY = new Set(['uncertain', 'discovery', 'composing', 'statement', 'refine', 'continue', 'handoff', 'done'])

export function createRenderer({ root, live, journey, audit = false }) {
  let lastKey = null
  let lastStage = null
  let lastOverlay = null
  let lastAnnounced = ''
  let composers = []

  function keyOf(s) {
    return JSON.stringify([
      s.stage, s.stepIndex, s.overlay, s.overlayPage, s.busy, s.error?.message || null, s.selection,
      s.ownWordsOpen, s.asideOpen, s.editorOpen, s.ctx.updatedAt, s.ctx.statement?.version || 0,
      s.receipt?.receiptId || null, s.notes.length, s.resumed, s.ctx.id, s.returnTo,
      s.gate ? [s.gate.decision, s.gate.latencyMs, s.gate.failure?.kind || null] : null,
      s.opening.status, s.opening.failure, s.ctx.conversation?.turns?.length || 0,
    ])
  }

  function message(s) {
    if (s.error) return s.error.message
    if (s.overlay) return `${OVERLAY_TITLES[s.overlay] || s.overlay} opened.`
    if (s.stage === 'discovery') {
      const ex = s.ctx.exchanges[s.stepIndex]
      return ex ? `${FOCUS_TITLES[ex.focus]}, question ${s.stepIndex + 1} of ${s.ctx.exchanges.length}. ${ex.question}` : ''
    }
    if (s.stage === 'statement') return `Project statement, draft ${s.ctx.statement?.version || 1}, ready to review.`
    if (s.stage === 'conversation') {
      const o = latestOpening(s.ctx)
      if (o) return `Compás Caribe: ${o.reflection} ${o.question}`
      return s.opening.status === 'failed' ? 'The reply could not be prepared. Your words are kept.' : 'Preparing a reply.'
    }
    if (s.stage === 'gate') return s.gate ? `Classification complete. Decision: ${s.gate.decision}.` : 'Classifying your words.'
    if (s.stage === 'qualifying') return 'Reading your words.'
    if (s.stage === 'composing') return 'Writing your project statement.'
    if (s.stage === 'continue') return 'Your statement is ready. You can continue into Decision Channel.'
    if (s.stage === 'done') return 'Handoff prepared. Prototype: nothing was transmitted.'
    if (s.stage === 'declined') return 'This does not look like a project we build.'
    if (s.stage === 'uncertain') return 'We are not sure yet. One more sentence will help.'
    if (s.stage === 'welcome') return 'What would you like to make possible?'
    return ''
  }

  function announce(s) {
    // The inline alert already announces errors; the live region only speaks
    // when the message actually changes.
    const msg = s.error ? '' : message(s)
    if (!live || !msg || msg === lastAnnounced) return
    lastAnnounced = msg
    live.textContent = msg
  }

  function render(s = journey.state) {
    const key = keyOf(s)
    if (key === lastKey) return
    const stageChanged = s.stage !== lastStage
    const overlayClosed = Boolean(lastOverlay) && !s.overlay
    const prevFocusKey = activeFocusKey()
    const prevCaret = document.activeElement && 'selectionStart' in document.activeElement ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null
    lastKey = key
    lastStage = s.stage
    const returnKey = overlayClosed ? s.overlayReturn || lastOverlayReturn : null
    lastOverlayReturn = s.overlay ? s.overlayReturn : lastOverlayReturn
    lastOverlay = s.overlay

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
    if (ov) {
      stage.append(ov)
      trapFocus(ov)
    }
    stage.append(h('div', { class: 'guard', hidden: true, 'aria-hidden': 'true' }, h('p', { class: 'question' }, 'Turn your phone upright to keep writing.')))

    const bar = topBar(s, journey.actions)
    clear(root)
    root.append(bar, stage)

    // Behind an overlay, everything else is inert for keyboard and AT users.
    const inert = Boolean(ov)
    bar.inert = inert
    for (const el of stage.children) if (el !== ov) el.inert = inert

    // Composers and any block that sizes itself to the room it is left (data-measure) are measured on every layout.
    composers = [...root.querySelectorAll('.composer, [data-measure]')].filter(c => typeof c.measure === 'function')
    layout()
    focus(s, { stageChanged, prevFocusKey, prevCaret, returnKey })
    announce(s)
    if (audit) requestAnimationFrame(() => runAudit('render'))
  }
  let lastOverlayReturn = null

  const repaginate = () => {
    for (const el of root.querySelectorAll('.paged')) el.paginate?.()
    root.querySelector('.overlay')?.paginate?.()
  }

  /** A preview that is cut short says so: its "Read in full" control is shown only then. */
  function markClamps() {
    for (const el of root.querySelectorAll('[data-clamp-detect]')) {
      el.parentElement.classList.toggle('is-clamped', el.scrollHeight > el.clientHeight + 1)
    }
  }

  function layout() {
    fitAll(root)
    for (const c of composers) c.measure()
    repaginate()
    budget()
    markClamps()
    // A second pass after fonts/metrics settle.
    requestAnimationFrame(() => {
      fitAll(root)
      for (const c of composers) c.measure()
      repaginate()
      budget()
      markClamps()
    })
  }

  /**
   * Height budget for the working ply: when its body still overflows after
   * fitting, compact the discovery composition step by step (tighter
   * reflection, tighter question, two-column options, one fewer option) and
   * re-fit after each step, so nothing is ever cut off.
   */
  function budget() {
    const body = root.querySelector('.ply-work .ply-body[data-budget]')
    if (!body) return
    const over = () => body.scrollHeight > body.clientHeight + 2
    if (!over()) return
    const steps = [
      () => { const r = body.querySelector('.reflection'); if (r) r.style.maxHeight = '2.7em' },
      () => { const q = body.querySelector('.question'); if (q) q.style.maxHeight = '2.3em' },
      () => { const o = body.querySelector('.options'); if (o && body.clientWidth >= 440) o.classList.add('is-two-col') },
      () => { const o = body.querySelector('.options'); if (o) { const radios = o.querySelectorAll('[role="radio"]'); if (radios.length > 2) radios[radios.length - 1].hidden = true } },
      () => { const r = body.querySelector('.reflection'); if (r) r.style.maxHeight = '1.4em' },
    ]
    for (const step of steps) {
      step()
      fitAll(body)
      for (const el of body.querySelectorAll('.paged')) el.paginate?.()
      if (!over()) return
    }
  }

  function trapFocus(ov) {
    ov.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return
      const items = [...ov.querySelectorAll('button:not([disabled]), [href], input, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    })
  }

  function focus(s, { stageChanged, prevFocusKey, prevCaret, returnKey }) {
    const byKey = (k) => (k ? root.querySelector(`[data-focus-key="${CSS.escape(k)}"]`) : null)
    // 1. An overlay just closed: return to the control that opened it.
    // 2. Same control as before the re-render (option, pager, link…).
    // 3. The view's own autofocus target.
    let target = (returnKey && byKey(returnKey)) || (!stageChanged && prevFocusKey && byKey(prevFocusKey)) || root.querySelector('.overlay [data-autofocus]') || root.querySelector('[data-autofocus]')
    if (target && target.disabled) target = root.querySelector('.overlay [data-autofocus]') || root.querySelector('[data-autofocus]')
    if (!target) return
    try {
      target.focus({ preventScroll: true })
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
        const n = target.value.length
        if (prevCaret && prevCaret.id === target.id && prevCaret.start <= n) target.setSelectionRange(prevCaret.start, prevCaret.end)
        else target.setSelectionRange(n, n)
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
