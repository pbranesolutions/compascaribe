import './styles/tokens.css'
import './styles/app.css'

import { createJourney, STORAGE_KEY } from './app/journey.js'
import { createProvider } from './domain/discovery/provider.js'
import { bindViewport, auditOverflow, describe } from './ui/fit.js'
import { createRenderer } from './ui/render.js'

const params = new URLSearchParams(location.search)
const audit = params.has('audit')
const fast = params.has('fast') // skips simulated latency, for automated tests

if (params.has('fresh')) {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

const provider = createProvider({ mode: 'simulated', latency: !fast })
const journey = createJourney({ provider, latency: !fast })
const root = document.getElementById('app')
const live = document.getElementById('live')
const renderer = createRenderer({ root, live, journey, audit })

journey.restore()
journey.subscribe(renderer.render)

// Viewport: keep --vvh current (virtual keyboard, browser chrome, rotation) and re-fit.
bindViewport(() => {
  renderer.layout()
  const guard = root.querySelector('.guard')
  if (guard) guard.hidden = document.documentElement.dataset.unusable !== 'true'
  if (audit) requestAnimationFrame(() => renderer.runAudit('viewport'))
})

// Composer focus tells the layout a keyboard may be open.
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('textarea, input')) root.classList.add('is-typing')
})
document.addEventListener('focusout', () => root.classList.remove('is-typing'))

// Esc = back one level (overlay → stage, own words → options).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  const s = journey.state
  if (s.overlay) return journey.actions.closeOverlay()
  if (s.ownWordsOpen) return journey.actions.closeOwnWords()
  if (s.asideOpen) return journey.actions.toggleAside()
  if (s.editorOpen) return journey.actions.toggleEditor()
})

// Never let the document scroll, even if something slips through.
window.addEventListener('scroll', () => window.scrollTo(0, 0), { passive: true })
document.addEventListener('wheel', (e) => { if (!e.target.closest?.('textarea')) e.preventDefault() }, { passive: false })
document.addEventListener('touchmove', (e) => { if (!e.target.closest?.('textarea')) e.preventDefault() }, { passive: false })

document.fonts?.ready.then(() => renderer.layout())

renderer.render(journey.state)

// Test and diagnostics hooks (harmless in production).
window.__cc = {
  get state() { return journey.state },
  actions: journey.actions,
  provider,
  audit: () => {
    const issues = auditOverflow(root)
    return { viewport: `${window.innerWidth}x${window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight}`, stage: journey.state.stage, issues: issues.map(i => ({ el: describe(i.el), kind: i.kind, detail: i.detail })) }
  },
  layout: renderer.layout,
}
