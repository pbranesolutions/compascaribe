// Customer journey: a finite set of interface states with explicit transitions
// and preserved context. The UI renders `state`; it never mutates it.
//
// Stages:  welcome → qualifying → (declined | uncertain | discovery)
//          discovery → composing → statement ⇄ refine → continue → handoff → done
// Overlays (about, review, words, notes, drafts) sit on top of any stage and
// never change the stage.

import {
  allAnswered, answersByFocus, createContext, LIMITS, nextUnanswered, withClarification,
  withExchanges, withHandoff, withQualification, withStatement, withSubmission,
} from '../domain/context.js'
import { createProvider } from '../domain/discovery/provider.js'
import { buildHandoffPayload } from '../domain/handoff/payload.js'
import { sendToDecisionChannel } from '../domain/handoff/transport.js'

export const STAGES = ['welcome', 'qualifying', 'declined', 'uncertain', 'discovery', 'composing', 'statement', 'refine', 'continue', 'handoff', 'done']

/** Positions on the route band in the top bar. */
export const ROUTE = [
  { id: 'welcome', label: 'Idea', stages: ['welcome', 'declined', 'uncertain'] },
  { id: 'qualifying', label: 'Reading', stages: ['qualifying'] },
  { id: 'discovery', label: 'Discovery', stages: ['discovery', 'composing'] },
  { id: 'statement', label: 'Statement', stages: ['statement', 'refine'] },
  { id: 'continue', label: 'Continue', stages: ['continue'] },
  { id: 'handoff', label: 'Decision Channel', stages: ['handoff', 'done'] },
]

const STORAGE_KEY = 'compascaribe.journey.v1'
const RESUME_WINDOW_MS = 1000 * 60 * 60 * 24 * 7

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
    busy: false,
    busyLabel: null,
    error: null,
    overlay: null,
    overlayPage: 0,
    notes: [],
    parts: null,
    sketch: null,
    receipt: null,
    payload: null,
    resumed: false,
    tick: 0,
  }
}

export function createJourney({ storage = safeStorage(), provider = createProvider(), history: hist = typeof history !== 'undefined' ? history : null } = {}) {
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

  function restore() {
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) return false
      const saved = JSON.parse(raw)
      if (!saved?.ctx?.submission || Date.now() - saved.savedAt > RESUME_WINDOW_MS) return false
      let stage = saved.stage
      // Transient stages resume at their stable neighbour.
      if (stage === 'qualifying' || stage === 'composing') stage = 'welcome'
      if (stage === 'handoff') stage = 'continue'
      state = {
        ...initialState(saved.ctx),
        stage,
        stepIndex: Math.min(saved.stepIndex || 0, Math.max(0, (saved.ctx.exchanges?.length || 1) - 1)),
        parts: saved.parts || null,
        receipt: saved.receipt || null,
        resumed: true,
        drafts: { ...initialState().drafts, welcome: stage === 'welcome' ? saved.ctx.submission.text : '' },
      }
      if (stage === 'discovery') state.selection = state.ctx.exchanges[state.stepIndex]?.answer?.optionId || null
      state.sketch = sketch()
      return true
    } catch {
      return false
    }
  }

  function sketch() {
    try {
      return provider.sketch ? provider.sketch(state.ctx) : null
    } catch {
      return null
    }
  }

  function addNote(n) {
    return [...state.notes.slice(-11), { at: new Date().toISOString(), ...n }]
  }

  async function guarded(label, fn) {
    const my = ++seq
    set({ busy: true, busyLabel: label, error: null })
    try {
      await fn(() => my === seq)
    } catch (err) {
      if (my !== seq) return
      set({ busy: false, busyLabel: null, error: { message: 'Something went wrong on our side. Your words are kept; try again.', detail: String(err?.message || err) } })
      return
    }
    if (my === seq) set({ busy: false, busyLabel: null })
  }

  // --- transitions -------------------------------------------------------

  function go(stage, extra = {}) {
    set({ stage, overlay: null, overlayPage: 0, error: null, asideOpen: false, editorOpen: false, ...extra })
    pushHistory()
  }

  function pushHistory() {
    try {
      hist?.pushState({ stage: state.stage, stepIndex: state.stepIndex }, '')
    } catch {
      /* ignore */
    }
  }

  const actions = {
    setDraft(key, value) {
      set({ drafts: { ...state.drafts, [key]: value }, error: null })
    },

    async submit() {
      const text = state.drafts.welcome.trim()
      if (!text) return set({ error: { message: 'Start with a sentence or two: what is it, and who is it for?' } })
      if (text.split(/\s+/).length < 3 && text.length < 24) return set({ error: { message: 'A few more words will help: what should it do, and for whom?' } })
      if (text.length > LIMITS.submission) return set({ error: { message: `That is more than fits here (${LIMITS.submission} characters). Trim it a little; detail comes next.` } })
      const ctx = withSubmission(createContext(), text)
      set({ ctx, stepIndex: 0, selection: null, ownWordsOpen: false, parts: null, receipt: null, payload: null, sketch: null, resumed: false })
      go('qualifying')
      await qualifyAndRoute()
    },

    async clarify() {
      const text = state.drafts.clarify.trim()
      if (!text) return set({ error: { message: 'Add one sentence: what would it help you do, and for whom?' } })
      const ctx = withClarification(state.ctx, text)
      set({ ctx, drafts: { ...state.drafts, clarify: '' } })
      go('qualifying')
      await qualifyAndRoute()
    },

    select(optionId) {
      set({ selection: optionId, ownWordsOpen: false, error: null })
    },

    openOwnWords() {
      set({ ownWordsOpen: true, selection: null, error: null })
    },

    closeOwnWords() {
      set({ ownWordsOpen: false, error: null })
    },

    async commitAnswer() {
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
      await guarded('Noting that', async (alive) => {
        const res = await provider.answer(state.ctx, ex.id, answer)
        if (!alive()) return
        const ctx = withExchanges(state.ctx, res.exchanges)
        const next = nextUnanswered(ctx)
        const notes = addNote(res.notes)
        if (next) {
          const idx = ctx.exchanges.findIndex(e => e.id === next.id)
          set({ ctx, notes, selection: null, ownWordsOpen: false, drafts: { ...state.drafts, ownWords: '' } })
          set({ sketch: sketch() })
          go('discovery', { stepIndex: idx })
        } else {
          set({ ctx, notes, selection: null, ownWordsOpen: false, drafts: { ...state.drafts, ownWords: '' } })
          set({ sketch: sketch() })
          go('composing')
          await compose(alive)
        }
      })
    },

    revisit(index) {
      if (index < 0 || index >= state.ctx.exchanges.length) return
      const ex = state.ctx.exchanges[index]
      go('discovery', {
        stepIndex: index,
        selection: ex.answer?.optionId || null,
        ownWordsOpen: Boolean(ex.answer?.text),
        drafts: { ...state.drafts, ownWords: ex.answer?.text || '' },
      })
    },

    back() {
      const s = state.stage
      if (state.overlay) return actions.closeOverlay()
      if (s === 'discovery') {
        if (state.stepIndex > 0) return actions.revisit(state.stepIndex - 1)
        return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || state.drafts.welcome } })
      }
      if (s === 'statement') {
        if (state.ctx.exchanges.length) return actions.revisit(state.ctx.exchanges.length - 1)
        return go('welcome')
      }
      if (s === 'refine') return go('statement')
      if (s === 'continue') return go('statement')
      if (s === 'handoff' || s === 'done') return go('continue')
      if (s === 'declined' || s === 'uncertain') return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || '' } })
      if (s === 'welcome') return
    },

    async refine(mode) {
      await guarded('Rewriting', async (alive) => {
        const res = await provider.refine(state.ctx, mode)
        if (!alive()) return
        const ctx = withStatement(state.ctx, res.statement, `refine:${mode}`)
        set({ ctx, parts: res.parts, notes: addNote(res.notes) })
        go('statement')
      })
    },

    openRefine() {
      go('refine', { drafts: { ...state.drafts, edit: state.ctx.statement?.text || '' }, editorOpen: false })
    },

    editStatement() {
      const text = state.drafts.edit.trim()
      if (!text) return set({ error: { message: 'The statement cannot be empty. Say what the project must achieve.' } })
      if (text.length > LIMITS.statement) return set({ error: { message: `Keep the statement under ${LIMITS.statement} characters, one to three sentences.` } })
      const ctx = withStatement(state.ctx, { text, title: state.ctx.statement?.title || 'Your project', source: 'edited' }, 'visitor edit')
      set({ ctx })
      go('statement')
    },

    useDraft(version) {
      const entry = state.ctx.statementHistory.find(s => s.version === version)
      if (!entry) return
      const ctx = withStatement(state.ctx, { text: entry.text, title: entry.title, source: 'restored' }, `restore:${version}`)
      set({ ctx, overlay: null })
    },

    accept() {
      go('continue')
    },

    async handoff() {
      go('handoff')
      await guarded('Preparing the handoff', async (alive) => {
        const payload = buildHandoffPayload(state.ctx, { parts: state.parts })
        const receipt = await sendToDecisionChannel(payload)
        if (!alive()) return
        const ctx = withHandoff(state.ctx, receipt)
        set({ ctx, payload, receipt })
        go('done')
      })
    },

    reset() {
      seq++
      try { storage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      state = { ...initialState(), tick: state.tick + 1 }
      notify()
      pushHistory()
    },

    toggleAside() {
      set({ asideOpen: !state.asideOpen, error: null })
    },

    toggleEditor() {
      set({ editorOpen: !state.editorOpen, error: null, drafts: { ...state.drafts, edit: state.ctx.statement?.text || '' } })
    },

    openOverlay(name, page = 0) {
      set({ overlay: name, overlayPage: page })
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

  async function qualifyAndRoute() {
    await guarded('Reading', async (alive) => {
      const q = await provider.qualify(state.ctx)
      if (!alive()) return
      let ctx = withQualification(state.ctx, q)
      let notes = addNote({ stage: 'qualify', simulated: true, tier: q.tier, qualificationReason: q.reason, confidence: q.confidence })
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
      set({ ctx, notes: [...notes, { at: new Date().toISOString(), ...opened.notes }], stepIndex: 0, selection: null, ownWordsOpen: false })
      set({ sketch: sketch() })
      go('discovery', { stepIndex: 0 })
    })
  }

  async function compose(alive) {
    const res = await provider.compose(state.ctx)
    if (!alive()) return
    const ctx = withStatement(state.ctx, res.statement, 'generated')
    set({ ctx, parts: res.parts, notes: addNote(res.notes) })
    go('statement')
  }

  // Browser back/forward: treat as "back" within the journey.
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      if (state.busy) return pushHistory()
      actions.back()
    })
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
    helpers: { answersByFocus, allAnswered, LIMITS },
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
