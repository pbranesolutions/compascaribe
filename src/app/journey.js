// Customer journey: a finite set of interface states with explicit transitions
// and preserved context. The UI renders `state`; it never mutates it.
//
// Entry:   welcome → gate → (PROCEED → conversation | BLOCK, UNAVAILABLE → stay at gate).
//          Begin runs the live Jev gate. A PROCEED that carries the server's
//          qualification opens the conversation: a live model request for the
//          first reply, then one for every answer the visitor sends, until the
//          project's purpose is stated and the visitor confirms or corrects it.
//          Anything else stays at the diagnostic, which displays the decision
//          and routes nothing.
// Confirmed: the stated purpose becomes the project statement and the visitor
//          continues into the (simulated) handoff. The discovery stages below
//          are the earlier simulated flow, kept intact and unreachable from Begin.
// Stages:  welcome → qualifying → (declined | uncertain | discovery)
//          discovery → composing → statement ⇄ refine → continue → handoff → done
// Overlays (review, words, drafts, notes, record) sit on top of any
// stage and never change the stage.

import {
  allAnswered, CONTEXT_VERSION, createContext, isConfirmed, latestCompas, latestOpening, latestReply, latestUnderstanding, LIMITS, nextUnanswered,
  openStatement, turnsOf, withClarification, withConfirmation, withExchanges, withHandoff, withOpening, withoutReply, withQualification,
  withReply, withStatement, withSubmission, withTurn,
} from '../domain/context.js'
import { createConversationClient } from '../domain/conversation/client.js'
import { wireTurns } from '../domain/conversation/history.js'
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
const ORDER = ['welcome', 'gate', 'conversation', 'qualifying', 'discovery', 'composing', 'statement', 'refine', 'continue', 'handoff', 'done']

const NO_HANDOFF = { status: 'none', receiptId: null, at: null }

function initialState(ctx = createContext()) {
  return {
    stage: 'welcome',
    ctx,
    stepIndex: 0,
    drafts: { welcome: '', clarify: '', ownWords: '', edit: '', reply: '' },
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
    // The server's qualification for the conversation, renewed by every reply; held in memory only.
    qualification: null,
    // The first model reply: idle until a PROCEED, generating while the request is out, ready, or failed (kind kept).
    opening: { status: 'idle', failure: null },
    // The reply to the visitor's latest answer: idle, generating while the request is out, or failed (kind kept).
    turn: { status: 'idle', failure: null },
    // The visitor is writing a correction to the stated purpose.
    correcting: false,
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

export function createJourney({ storage = safeStorage(), provider = createProvider(), gate = createGateClient(), conversation = createConversationClient(), latency = true, history: hist = typeof history !== 'undefined' ? history : null } = {}) {
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
      // The conversation resumes only if the model already answered; a reply in flight is never replayed.
      if (stage === 'conversation' && !latestOpening(ctx)) stage = 'welcome'
      // A purpose confirmed in conversation has no discovery behind it: its stages are the conversation and what follows it.
      const conversational = Boolean(ctx.statement && ctx.statement.source === 'conversation' && latestOpening(ctx))
      if (conversational && ['statement', 'refine'].includes(stage)) stage = 'conversation'
      if (stage === 'qualifying') stage = ctx.exchanges.length ? 'discovery' : 'welcome'
      if (stage === 'composing') {
        stage = ctx.statement ? 'statement' : ctx.exchanges.length ? 'discovery' : 'welcome'
        if (stage === 'discovery') stepIndex = lastStep
      }
      if (stage === 'handoff') stage = ctx.statement ? 'continue' : 'welcome'
      if (['discovery', 'statement', 'refine', 'continue', 'done'].includes(stage) && !ctx.exchanges.length && !conversational) stage = 'welcome'
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
        opening: { status: stage === 'conversation' ? 'ready' : 'idle', failure: null },
        // An answer was written but its reply never arrived (the page closed first): it is kept, and asking again is one tap.
        turn: stage === 'conversation' && latestReply(ctx) ? { status: 'failed', failure: 'interrupted' } : { status: 'idle', failure: null },
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

  /** The project's statement is the purpose confirmed in the conversation, not one the simulated discovery wrote. */
  function conversational() {
    return Boolean(state.ctx.statement && state.ctx.statement.source === 'conversation' && latestOpening(state.ctx))
  }

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
   * The Jev gate. On PROCEED with the server's qualification it opens the
   * conversation; on anything else it stops and shows the decision, and no
   * model is ever asked. A failure is shown as UNAVAILABLE, never as a decision,
   * and the words stay.
   *
   * `recheck` is the retry from the conversation stage after a qualification
   * ran out: it stays on that stage and only moves if the answer is not PROCEED.
   */
  async function runGate({ recheck = false } = {}) {
    await guarded(recheck ? 'Preparing a reply' : 'Classifying', recheck ? 'conversation' : 'welcome', async (alive) => {
      const text = state.ctx.submission.text
      // A re-check happens mid-conversation too: the reply being waited for is the opening or the next turn.
      const midway = recheck && Boolean(latestOpening(state.ctx))
      const waiting = status => (midway ? { turn: status } : { opening: status })
      if (recheck) set(waiting({ status: 'generating', failure: null }))
      let outcome
      try {
        outcome = await gate.classify(text)
      } catch (err) {
        if (recheck) return set(waiting({ status: 'failed', failure: 'network' }))
        throw err
      }
      if (!alive()) return
      if (outcome.rejected) {
        const message = outcome.rejected === 'too_long'
          ? `That is more than fits here (${LIMITS.submission} characters). Trim it a little; detail comes next.`
          : ASK_MORE
        return go('welcome', { drafts: { ...state.drafts, welcome: text }, error: { message }, gate: null, opening: { status: 'idle', failure: null } }, { replace: true })
      }
      const { result } = outcome
      // A gate that could not answer is not a verdict on words that already passed it: the conversation stays and the visitor can try again.
      if (recheck && result.decision === 'UNAVAILABLE') return set({ gate: result, ...waiting({ status: 'failed', failure: 'network' }) })
      // Only a PROCEED that came with the server's qualification can lead to a model request.
      const qualification = result.decision === 'PROCEED' ? outcome.qualification || null : null
      set({ gate: result, qualification, notes: addNote({ stage: 'gate', live: true, decision: result.decision }) })
      if (qualification) {
        if (state.stage !== 'conversation') go('conversation', { drafts: { ...state.drafts, reply: '' } })
        return continueConversation(alive)
      }
      set({ opening: { status: 'idle', failure: null }, turn: { status: 'idle', failure: null } })
      if (state.stage !== 'gate') go('gate', {}, { replace: true })
    })
  }

  /** What the conversation is waiting for: the answer to the visitor's latest reply, or (before any) the opening. */
  function continueConversation(alive) {
    return latestOpening(state.ctx) && latestReply(state.ctx) ? requestTurn(alive) : openConversation(alive)
  }

  /**
   * The one model request of the first exchange. It does not throw: a failure
   * is recorded as the opening's status so the visitor keeps their words and can
   * try again. Nothing is requested if the opening already exists.
   */
  async function openConversation(alive) {
    if (latestOpening(state.ctx)) return set({ opening: { status: 'ready', failure: null } })
    const q = state.qualification
    if (!q) return set({ opening: { status: 'failed', failure: 'qualification' } })
    set({ opening: { status: 'generating', failure: null } })
    const out = await conversation.open({ text: state.ctx.submission.text, qualification: q.token })
    if (!alive()) return
    if (out.ok) {
      const ctx = withOpening(state.ctx, out.opening, { model: out.model, latencyMs: out.latencyMs, usage: out.usage })
      return set({
        ctx,
        // The conversation continues under the qualification that came back with the reply.
        qualification: out.qualification || null,
        opening: { status: 'ready', failure: null },
        turn: { status: 'idle', failure: null },
        notes: addNote({ stage: 'conversation', live: true, model: out.model, latencyMs: out.latencyMs, usage: out.usage }),
      })
    }
    set({ opening: { status: 'failed', failure: out.ok === false ? out.failure : 'malformed' } })
  }

  /**
   * The model's reply to the visitor's latest answer. As with the opening it
   * does not throw: a failure is recorded as the turn's status, the answer stays
   * in the record, and the visitor can try again or edit it. Nothing is
   * requested without an answer waiting for one.
   */
  async function requestTurn(alive) {
    const ctx = state.ctx
    if (!latestReply(ctx) || !latestOpening(ctx)) return
    const q = state.qualification
    if (!q || q.expiresAt - Date.now() < 5000) {
      // The conversation's qualification ran out (a long pause) or never came: the same words are checked again, then the reply is requested.
      return set({ turn: { status: 'failed', failure: 'qualification' } })
    }
    set({ turn: { status: 'generating', failure: null } })
    let out
    try {
      out = await conversation.next({
        text: ctx.submission.text,
        qualification: q.token,
        turns: wireTurns(turnsOf(ctx)),
        understanding: latestUnderstanding(ctx),
      })
    } catch {
      // The client does not throw; if a stand-in or a bug does, the answer is still kept and trying again is still there.
      out = { ok: false, failure: 'provider_error' }
    }
    if (!alive()) return
    if (out.ok && out.kind === 'turn') {
      const next = withTurn(state.ctx, out.turn, { model: out.model, latencyMs: out.latencyMs, usage: out.usage })
      return set({
        ctx: next,
        qualification: out.qualification || null,
        turn: { status: 'idle', failure: null },
        correcting: false,
        drafts: { ...state.drafts, reply: '' },
        notes: addNote({ stage: 'conversation', live: true, model: out.model, latencyMs: out.latencyMs, usage: out.usage, reading: out.turn.reading, move: out.turn.move, replies: out.progress?.replies ?? null }),
      })
    }
    set({ turn: { status: 'failed', failure: out.ok === false ? out.failure : 'malformed' } })
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
      // The same words already have their opening in this tab (Back, then Begin again): show it, request nothing.
      if (state.ctx.submission?.text === text && latestOpening(state.ctx)) {
        // The conversation as it was: an answer that never got its reply is still there to send again.
        const turn = latestReply(state.ctx) ? { status: 'failed', failure: 'interrupted' } : { status: 'idle', failure: null }
        return go('conversation', { gate: null, opening: { status: 'ready', failure: null }, turn, correcting: false, drafts: { ...state.drafts, reply: '' } })
      }
      const ctx = withSubmission(createContext(), text)
      set({ ctx, stepIndex: 0, selection: null, ownWordsOpen: false, parts: null, receipt: null, payload: null, sketch: null, gate: null, qualification: null, opening: { status: 'idle', failure: null }, turn: { status: 'idle', failure: null }, correcting: false, resumed: false, returnTo: null })
      go('gate')
      await runGate()
    },

    /** Run the gate again on the same, unchanged words. */
    async retryGate() {
      if (state.busy || state.stage !== 'gate' || !state.ctx.submission) return
      set({ gate: null })
      await runGate()
    },

    /**
     * Try the first reply again with the same words. While the qualification is
     * still good that is one more model request; once it has run out (or the
     * server no longer accepts it) the words are checked again first.
     */
    async retryOpening() {
      if (state.busy || state.stage !== 'conversation' || latestOpening(state.ctx) || !state.ctx.submission) return
      const q = state.qualification
      const good = q && q.expiresAt - Date.now() > 5000 && state.opening.failure !== 'qualification'
      if (good) {
        await guarded('Preparing a reply', 'conversation', alive => openConversation(alive))
      } else {
        set({ gate: null })
        await runGate({ recheck: true })
      }
    },

    /**
     * The visitor's answer to what Compás Caribe last said (a question, or the
     * statement of the purpose it proposed). It is recorded, then one model
     * request writes the next reply. If that fails the answer stays in the
     * record, and trying again or editing it is one tap.
     */
    async sendReply() {
      if (state.stage !== 'conversation' || state.busy) return
      const asked = latestCompas(state.ctx)
      if (!asked || latestReply(state.ctx) || isConfirmed(state.ctx)) return
      const text = state.drafts.reply.trim()
      if (!text) return set({ error: { message: 'Write a few words first.' } })
      if (text.length > LIMITS.reply) return set({ error: { message: `Keep it under ${LIMITS.reply} characters; there is room for detail later.` } })
      set({ ctx: withReply(state.ctx, text), drafts: { ...state.drafts, reply: '' }, error: null, turn: { status: 'idle', failure: null } })
      await actions.retryTurn()
    },

    /**
     * Ask for the reply to the visitor's latest answer: the first time (Send),
     * or again after a failure. While the qualification is good that is one
     * model request; once it has run out the words are checked again first.
     */
    async retryTurn() {
      if (state.busy || state.stage !== 'conversation' || !latestReply(state.ctx) || !latestOpening(state.ctx)) return
      const q = state.qualification
      const good = q && q.expiresAt - Date.now() > 5000 && state.turn.failure !== 'qualification'
      if (good) {
        await guarded('Preparing a reply', 'conversation', alive => requestTurn(alive))
      } else {
        set({ gate: null })
        await runGate({ recheck: true })
      }
    },

    /** The right retry for wherever the conversation is waiting. */
    async retryConversation() {
      if (latestOpening(state.ctx)) return actions.retryTurn()
      return actions.retryOpening()
    },

    /** Take the answer back into the field to change it. */
    editReply() {
      const reply = latestReply(state.ctx)
      if (state.stage !== 'conversation' || state.busy || !reply) return
      set({ ctx: withoutReply(state.ctx), drafts: { ...state.drafts, reply: reply.text }, error: null, turn: { status: 'idle', failure: null } })
    },

    /** The visitor says the stated purpose is right. It becomes the project statement and the conversation is complete. */
    confirmStatement() {
      if (state.stage !== 'conversation' || state.busy || isConfirmed(state.ctx)) return
      const ctx = withConfirmation(state.ctx)
      if (ctx === state.ctx) return
      set({ ctx, correcting: false, error: null, turn: { status: 'idle', failure: null }, drafts: { ...state.drafts, reply: '' } })
    },

    /** Start writing a correction to the stated purpose. */
    openCorrection() {
      if (state.stage !== 'conversation' || state.busy || !openStatement(state.ctx)) return
      set({ correcting: true, error: null })
    },

    closeCorrection() {
      if (!state.correcting) return
      set({ correcting: false, error: null, drafts: { ...state.drafts, reply: '' } })
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
      if (stage === 'statement' && state.ctx.statement) return go(conversational() ? 'conversation' : 'statement', {}, { replace: true })
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
      if (s === 'conversation') {
        // Leaving cancels a reply in flight; a reply already written is kept and reused if the same words come back.
        // The qualification is kept: the same words, then Begin, continue the conversation without being checked again.
        cancel()
        return go('welcome', { drafts: { ...state.drafts, welcome: state.ctx.submission?.text || state.drafts.welcome }, gate: null, opening: { status: 'idle', failure: null }, turn: { status: 'idle', failure: null }, correcting: false }, { replace: true })
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
        if (conversational()) return go('conversation', {}, { replace: true })
        if (state.ctx.exchanges.length) return actions.revisit(state.ctx.exchanges.length - 1)
        return go('welcome', {}, { replace: true })
      }
      if (s === 'refine') return go('statement', {}, { replace: true })
      // A purpose confirmed in conversation is shown where it was confirmed.
      if (s === 'continue') return go(conversational() ? 'conversation' : 'statement', {}, { replace: true })
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
