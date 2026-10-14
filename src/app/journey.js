// Customer journey: a finite set of interface states with explicit transitions
// and preserved context. The UI renders `state`; it never mutates it.
//
// Entry:   welcome → gate. Begin runs the live Jev gate and the journey STOPS at
//          the diagnostic: the PROCEED / BLOCK decision is displayed, never executed.
//          Everything below is the simulated downstream flow, kept intact and
//          currently unreachable from Begin; it is the work the gate will feed.
// Stages:  welcome → qualifying → (declined | uncertain | discovery)
//          discovery → composing → statement ⇄ refine → continue → handoff → done
// Overlays (review, words, drafts, notes, record) sit on top of any
// stage and never change the stage.

import {
  allAnswered, CONTEXT_VERSION, createContext, LIMITS, nextUnanswered, withClarification,
  withExchanges, withHandoff, withQualification, withStatement, withSubmission,
} from '../domain/context.js'
import { createProvider } from '../domain/discovery/provider.js'
import { createGateClient } from '../domain/gate/client.js'
import { buildHandoffPayload } from '../domain/handoff/payload.js'
import { sendToDecisionChannel } from '../domain/handoff/transport.js'

export { ROUTE } from './route.js'

// The only inline validation: nothing (or only whitespace) was written. Length is never
// judged; whether the words describe a project is the qualifier's call, not a rule here.
export const ASK_MORE = "Tell us a little more about what you'd like to change or accomplish."

// v2: journeys saved before the Jev gate resumed straight into the simulated flow.
export const STORAGE_KEY = 'compascaribe.journey.v2'
const RESUME_WINDOW_MS = 1000 * 60 * 60 * 24 * 7

// Forward transitions push a history entry; everything else replaces it, so
// the browser's Back button walks the journey backwards without piling up.
const ORDER = ['welcome', 'gate', 'qualifying', 'discovery', 'composing', 'statement', 'refine', 'continue', 'handoff', 'done']

const NO_HANDOFF = { status: 'none', receiptId: null, at: null }

function initialState(ctx = createContext()) {
  return {
    stage: 'welcome',
    ctx,
    stepIndex: 0,
    drafts: { welcome: '', clarify: '', ownWords: '', edit: '' },
    selection: null,
    ownWordsOpen: false,
    asideOpen: false,
    editorOpen: false,
    returnTo: null,
    busy: false,
    busyLabel: null,
    error: null,
    overlay: null,
    overlayPage: 0,
    overlayReturn: null,
    notes: [],
    parts: null,
    sketch: null,
    gate: null,
    receipt: null,
    payload: null,
    resumed: false,
    tick: 0,
  }
}

/** UI state for showing a discovery step, derived from its stored answer. */
function uiForStep(ctx, index) {
  const ex = ctx.exchanges[index]
  return {
    stepIndex: index,
    selection: ex?.answer?.optionId || null,
    ownWordsOpen: Boolean(ex?.answer?.text),
    ownWords: ex?.answer?.text || '',
  }
}

function validContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return false
  if (ctx.version !== CONTEXT_VERSION) return false
  if (!ctx.submission || typeof ctx.submission.text !== 'string') return false
  for (const k of ['clarifications', 'exchanges', 'statementHistory']) if (!Array.isArray(ctx[k])) return false
  if (!ctx.exchanges.every(e => e && typeof e.id === 'string' && typeof e.focus === 'string' && Array.isArray(e.options))) return false
  if (ctx.statement && typeof ctx.statement.text !== 'string') return false
  if (!ctx.handoff || typeof ctx.handoff !== 'object') return false
  return true
}

export function createJourney({ storage = safeStorage(), provider = createProvider(), gate = createGateClient(), latency = true, history: hist = typeof history !== 'undefined' ? history : null } = {}) {
  let state = initialState()
  const listeners = new Set()
  let seq = 0

  const notify = () => {
    for (const l of listeners) l(state)
  }

  const set = (patch) => {
    state = { ...state, ...patch, tick: state.tick + 1 }
    // Keystrokes (drafts only) are not persisted; everything else is.
    if (Object.keys(patch).some(k => k !== 'drafts')) persist()
    notify()
  }

  function persist() {
    try {
      const { ctx, stage, stepIndex, parts, receipt } = state
      if (!ctx.submission) {
        storage.removeItem(STORAGE_KEY)
        return
      }
      storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), ctx, stage, stepIndex, parts, receipt }))
    } catch {
      /* storage unavailable: the journey still works for this tab */
    }
  }

  function sketchFor(ctx) {
    try {
      return provider.sketch ? provider.sketch(ctx) : null
    } catch {
      return null
    }
  }

  /** Rebuild state from storage. Returns true when a saved journey was resumed. */
  function restore() {
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) return false
      const saved = JSON.parse(raw)
      if (!saved || typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > RESUME_WINDOW_MS) return false
      const ctx = saved.ctx
      if (!validContext(ctx)) {
        storage.removeItem(STORAGE_KEY)
        return false
      }
      let stage = ORDER.includes(saved.stage) || ['declined', 'uncertain'].includes(saved.stage) ? saved.stage : 'welcome'
      const lastStep = Math.max(0, ctx.exchanges.length - 1)
      let stepIndex = Math.min(Number(saved.stepIndex) || 0, lastStep)
      // Transient stages resume at their stable neighbour, keeping the work.
      // The gate result is a diagnostic of one request; the words are what is kept.
      if (stage === 'gate') stage = 'welcome'
      if (stage === 'qualifying') stage = ctx.exchanges.length ? 'discovery' : 'welcome'
      if (stage === 'composing') {
        stage = ctx.statement ? 'statement' : ctx.exchanges.length ? 'discovery' : 'welcome'
        if (stage === 'discovery') stepIndex = lastStep
      }
      if (stage === 'handoff') stage = ctx.statement ? 'continue' : 'welcome'
      if (['discovery', 'statement', 'refine', 'continue', 'done'].includes(stage) && !ctx.exchanges.length) stage = 'welcome'
      if (['statement', 'refine', 'continue', 'done'].includes(stage) && !ctx.statement) stage = 'discovery'
      if (stage === 'done' && !saved.receipt) stage = 'continue'
      const ui = stage === 'discovery' ? uiForStep(ctx, stepIndex) : { stepIndex, selection: null, ownWordsOpen: false, ownWords: '' }
      const parts = saved.parts && typeof saved.parts === 'object' ? saved.parts : null
      const receipt = stage === 'done' && saved.receipt && typeof saved.receipt === 'object' ? saved.receipt : null
      const next = {
        ...initialState(ctx),
        stage,
        stepIndex: ui.stepIndex,
        selection: ui.selection,
        ownWordsOpen: ui.ownWordsOpen,
        parts,
        receipt,
        payload: receipt ? buildHandoffPayload(ctx, { parts }) : null,
        resumed: true,
        drafts: { ...initialState().drafts, welcome: stage === 'welcome' ? ctx.submission.text : '', ownWords: ui.ownWords, edit: '' },
      }
      next.sketch = sketchFor(ctx)
      state = next
      return true
    } catch {
      try { storage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      return false
    }
  }

  function addNote(n) {
    return [...state.notes.slice(-11), { at: new Date().toISOString(), ...n }]
  }

  /**
   * Run async provider work. `fallback` is the stable stage to return to if
   * the work fails, so a failure is never a dead end.
   */
  async function guarded(label, fallback, fn) {
    const my = ++seq
    set({ busy: true, busyLabel: label, error: null })
    try {
      await fn(() => my === seq)
    } catch (err) {
      if (my !== seq) return
      const error = { message: 'Something went wrong on our side. Your words are kept; try again.', detail: String(err?.message || err) }
      if (fallback && fallback !== state.stage) go(fallback, { busy: false, busyLabel: null, error, ...(fallback === 'welcome' ? { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || state.drafts.welcome } } : {}) }, { replace: true })
      else set({ busy: false, busyLabel: null, error })
      return
    }
    if (my === seq) set({ busy: false, busyLabel: null })
  }

  /** Cancel any in-flight provider work. */
  function cancel() {
    seq++
    if (state.busy) set({ busy: false, busyLabel: null })
  }

  // --- transitions -------------------------------------------------------

  function go(stage, extra = {}, { replace } = {}) {
    const forward = ORDER.indexOf(stage) > ORDER.indexOf(state.stage) || (stage === 'discovery' && state.stage === 'discovery' && (extra.stepIndex ?? state.stepIndex) > state.stepIndex)
    set({ stage, overlay: null, overlayPage: 0, overlayReturn: null, error: null, asideOpen: false, editorOpen: false, ...extra })
    record(replace === true ? false : forward)
  }

  function record(push) {
    try {
      const entry = { stage: state.stage, stepIndex: state.stepIndex }
      if (push) hist?.pushState(entry, '')
      else hist?.replaceState(entry, '')
    } catch {
      /* ignore */
    }
  }

  /**
   * The Jev gate. Obtains the decision and stops: nothing is routed on it. A
   * failure is shown as UNAVAILABLE, never as a decision, and the words stay.
   */
  async function runGate() {
    await guarded('Classifying', 'welcome', async (alive) => {
      const text = state.ctx.submission.text
      const outcome = await gate.classify(text)
      if (!alive()) return
      if (outcome.rejected) {
        const message = outcome.rejected === 'too_long'
          ? `That is more than fits here (${LIMITS.submission} characters). Trim it a little; detail comes next.`
          : ASK_MORE
        return go('welcome', { drafts: { ...state.drafts, welcome: text }, error: { message }, gate: null }, { replace: true })
      }
      set({ gate: outcome.result, notes: addNote({ stage: 'gate', live: true, decision: outcome.result.decision }) })
    })
  }

  async function qualifyAndRoute() {
    await guarded('Reading', 'welcome', async (alive) => {
      const q = await provider.qualify(state.ctx)
      if (!alive()) return
      let ctx = withQualification(state.ctx, q)
      let notes = addNote({ stage: 'qualify', simulated: true })
      if (q.tier <= 1) {
        set({ ctx, notes })
        return go('declined')
      }
      if (q.tier === 2) {
        set({ ctx, notes })
        return go('uncertain')
      }
      const opened = await provider.open(ctx)
      if (!alive()) return
      ctx = withExchanges(ctx, opened.exchanges)
      set({ ctx, notes: [...notes, { at: new Date().toISOString(), ...opened.notes }], stepIndex: 0, selection: null, ownWordsOpen: false, sketch: sketchFor(ctx) })
      go('discovery', { stepIndex: 0 })
    })
  }

  async function compose(alive) {
    const res = await provider.compose(state.ctx)
    if (!alive()) return
    let ctx = withStatement(state.ctx, res.statement, 'generated')
    ctx = withHandoff(ctx, NO_HANDOFF)
    set({ ctx, parts: res.parts, notes: addNote(res.notes), receipt: null, payload: null })
    go('statement')
  }

  const actions = {
    setDraft(key, value) {
      set({ drafts: { ...state.drafts, [key]: value }, error: null })
    },

    async submit() {
      if (state.busy) return
      const text = state.drafts.welcome.trim()
      if (!text) return set({ error: { message: ASK_MORE } })
      if (text.length > LIMITS.submission) return set({ error: { message: `That is more than fits here (${LIMITS.submission} characters). Trim it a little; detail comes next.` } })
      const ctx = withSubmission(createContext(), text)
      set({ ctx, stepIndex: 0, selection: null, ownWordsOpen: false, parts: null, receipt: null, payload: null, sketch: null, gate: null, resumed: false, returnTo: null })
      go('gate')
      await runGate()
    },

    /** Run the gate again on the same, unchanged words. */
    async retryGate() {
      if (state.busy || state.stage !== 'gate' || !state.ctx.submission) return
      set({ gate: null })
      await runGate()
    },

    async clarify() {
      if (state.busy) return
      const text = state.drafts.clarify.trim()
      if (!text) return set({ error: { message: ASK_MORE } })
      if (text.length > LIMITS.clarification) return set({ error: { message: `Keep it under ${LIMITS.clarification} characters; detail comes next.` } })
      const ctx = withClarification(state.ctx, text)
      set({ ctx, drafts: { ...state.drafts, clarify: '' } })
      go('qualifying')
      await qualifyAndRoute()
    },

    select(optionId) {
      if (state.busy) return
      set({ selection: optionId, ownWordsOpen: false, error: null })
    },

    openOwnWords() {
      if (state.busy) return
      set({ ownWordsOpen: true, selection: null, error: null })
    },

    closeOwnWords() {
      if (state.busy) return
      set({ ownWordsOpen: false, error: null })
    },

    async commitAnswer() {
      if (state.busy) return
      const ex = state.ctx.exchanges[state.stepIndex]
      if (!ex) return
      let answer
      if (state.ownWordsOpen) {
        const text = state.drafts.ownWords.trim()
        if (!text) return set({ error: { message: 'Write it in a few words, or pick one of the options.' } })
        if (text.length > LIMITS.ownWords) return set({ error: { message: `Keep it under ${LIMITS.ownWords} characters here; there is room for detail later.` } })
        answer = { optionId: null, label: text, text, value: null }
      } else {
        const opt = ex.options.find(o => o.id === state.selection)
        if (!opt) return set({ error: { message: 'Choose one, or say it in your own words.' } })
        answer = { optionId: opt.id, label: opt.label, text: null, value: opt.value }
      }
      await guarded('Noting that', 'discovery', async (alive) => {
        const res = await provider.answer(state.ctx, ex.id, answer)
        if (!alive()) return
        const ctx = withExchanges(state.ctx, res.exchanges)
        const next = nextUnanswered(ctx)
        const notes = addNote(res.notes)
        set({ ctx, notes, selection: null, ownWordsOpen: false, drafts: { ...state.drafts, ownWords: '' }, sketch: sketchFor(ctx) })
        if (next) {
          const idx = ctx.exchanges.findIndex(e => e.id === next.id)
          go('discovery', { stepIndex: idx, returnTo: null })
        } else {
          go('composing', { returnTo: null })
          await compose(alive)
        }
      })
    },

    /** Open an earlier step. From the statement onwards, Back returns there. */
    revisit(index) {
      if (state.busy) return
      if (index < 0 || index >= state.ctx.exchanges.length) return
      const ui = uiForStep(state.ctx, index)
      const returnTo = state.stage === 'discovery' ? state.returnTo : ['statement', 'refine', 'continue', 'done', 'handoff'].includes(state.stage) ? 'statement' : null
      go('discovery', { stepIndex: ui.stepIndex, selection: ui.selection, ownWordsOpen: ui.ownWordsOpen, returnTo, drafts: { ...state.drafts, ownWords: ui.ownWords } }, { replace: true })
    },

    /** Jump to a completed stage from the route band. */
    jump(stage) {
      if (state.busy) return
      if (stage === 'statement' && state.ctx.statement) return go('statement', {}, { replace: true })
      if (stage === 'discovery' && state.ctx.exchanges.length) return actions.revisit(state.ctx.exchanges.length - 1)
      if (stage === 'continue' && state.ctx.statement) return go('continue', {}, { replace: true })
    },

    back() {
      const s = state.stage
      if (state.overlay) return actions.closeOverlay()
      if (s === 'gate') {
        cancel()
        return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || state.drafts.welcome }, gate: null }, { replace: true })
      }
      if (s === 'qualifying') {
        cancel()
        return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || state.drafts.welcome } }, { replace: true })
      }
      if (s === 'composing') {
        cancel()
        return actions.revisit(Math.max(0, state.ctx.exchanges.length - 1))
      }
      if (state.busy) return
      if (s === 'discovery') {
        if (state.returnTo === 'statement' && state.ctx.statement) return go('statement', { returnTo: null }, { replace: true })
        if (state.stepIndex > 0) return actions.revisit(state.stepIndex - 1)
        return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || state.drafts.welcome } }, { replace: true })
      }
      if (s === 'statement') {
        if (state.ctx.exchanges.length) return actions.revisit(state.ctx.exchanges.length - 1)
        return go('welcome', {}, { replace: true })
      }
      if (s === 'refine') return go('statement', {}, { replace: true })
      if (s === 'continue') return go('statement', {}, { replace: true })
      if (s === 'handoff' || s === 'done') return go('continue', {}, { replace: true })
      if (s === 'declined' || s === 'uncertain') return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || '' } }, { replace: true })
    },

    async refine(mode) {
      if (state.busy) return
      await guarded('Rewriting', 'statement', async (alive) => {
        const res = await provider.refine(state.ctx, mode)
        if (!alive()) return
        let ctx = withStatement(state.ctx, res.statement, `refine:${mode}`)
        ctx = withHandoff(ctx, NO_HANDOFF)
        set({ ctx, parts: res.parts, notes: addNote(res.notes), receipt: null, payload: null })
        go('statement', {}, { replace: true })
      })
    },

    openRefine() {
      if (state.busy) return
      go('refine', { drafts: { ...state.drafts, edit: state.ctx.statement?.text || '' }, editorOpen: false })
    },

    editStatement() {
      if (state.busy) return
      const text = state.drafts.edit.trim()
      if (!text) return set({ error: { message: 'The statement cannot be empty. Say what the project must achieve.' } })
      if (text.length > LIMITS.statement) return set({ error: { message: `Keep the statement under ${LIMITS.statement} characters, one to three sentences.` } })
      let ctx = withStatement(state.ctx, { text, title: state.ctx.statement?.title || 'Your project', source: 'edited' }, 'visitor edit')
      ctx = withHandoff(ctx, NO_HANDOFF)
      set({ ctx, receipt: null, payload: null })
      go('statement', {}, { replace: true })
    },

    useDraft(version) {
      if (state.busy) return
      const entry = state.ctx.statementHistory.find(s => s.version === version)
      if (!entry) return
      let ctx = withStatement(state.ctx, { text: entry.text, title: entry.title, source: entry.source, variant: entry.variant || null }, `restore:${version}`)
      ctx = withHandoff(ctx, NO_HANDOFF)
      set({ ctx, receipt: null, payload: null, overlay: null, overlayPage: 0, overlayReturn: null })
    },

    accept() {
      if (state.busy) return
      go('continue')
    },

    async handoff() {
      if (state.busy) return
      go('handoff')
      await guarded('Preparing the handoff', 'continue', async (alive) => {
        const payload = buildHandoffPayload(state.ctx, { parts: state.parts })
        const receipt = await sendToDecisionChannel(payload, { latency })
        if (!alive()) return
        const ctx = withHandoff(state.ctx, receipt)
        set({ ctx, payload, receipt })
        go('done')
      })
    },

    reset() {
      cancel()
      try { storage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      state = { ...initialState(), tick: state.tick + 1 }
      notify()
      record(false)
    },

    toggleAside() {
      if (state.busy) return
      set({ asideOpen: !state.asideOpen, error: null })
    },

    toggleEditor() {
      if (state.busy) return
      const opening = !state.editorOpen
      const current = state.ctx.statement?.text || ''
      const keep = opening && state.drafts.edit && state.drafts.edit !== current ? state.drafts.edit : current
      set({ editorOpen: opening, error: null, drafts: { ...state.drafts, edit: keep } })
    },

    /** `returnFocus` is a focus key restored when the overlay closes. */
    openOverlay(name, page = 0, returnFocus = null) {
      set({ overlay: name, overlayPage: page, overlayReturn: returnFocus })
    },

    closeOverlay() {
      set({ overlay: null, overlayPage: 0 })
    },

    overlayPage(page) {
      set({ overlayPage: page })
    },

    dismissError() {
      set({ error: null })
    },
  }

  // Browser back/forward: treat as "back" within the journey.
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => actions.back())
  }

  return {
    get state() {
      return state
    },
    actions,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    restore,
    provider,
  }
}

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* fall through */
  }
  const mem = new Map()
  return { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) }
}

export { allAnswered }
