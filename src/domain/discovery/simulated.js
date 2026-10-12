// Simulated discovery provider.
//
// Deterministic, runs entirely in the browser, labeled as simulated in the UI.
// It produces believable, input-specific reflections, questions and project
// statements from the extracted features and the visitor's answers. Replace
// with a remote provider (see provider.js) without touching the UI.

import { answersByFocus, effectiveText, newId } from '../context.js'
import { classify } from '../qualification/classifier.js'
import { BUILDERS, openingReflection, planFocuses } from './questions.js'
import { routeModel } from './routing.js'
import { composeStatement, deriveParts, sketchParts } from './statement.js'
import { deriveUnderstanding } from './understanding.js'

const wait = ms => new Promise(r => setTimeout(r, ms))

/** Believable, bounded think-time. Deterministic per text length. */
function thinkTime(text, base = 650) {
  const len = String(text || '').length
  return base + Math.min(700, len * 2)
}

export function createSimulatedProvider({ latency = true } = {}) {
  // Per-context memo of analysis so answer() and compose() agree with open().
  const memo = new Map()

  function analysis(ctx) {
    const text = effectiveText(ctx)
    const key = `${ctx.id}:${text}`
    let a = memo.get(key)
    if (!a) {
      const q = classify(text)
      const u = deriveUnderstanding(q.features)
      a = { q, u, f: q.features }
      memo.set(key, a)
    }
    return a
  }

  function regenerate(ctx, exchanges) {
    // Rebuild every exchange's reflection and options from current answers,
    // preserving answers whose option still exists (or that are own words).
    const { u, f } = analysis(ctx)
    const answers = {}
    const out = []
    exchanges.forEach((e, index) => {
      const built = BUILDERS[e.focus](u, f, answers)
      // The first step always opens with the engine's reading of the submission.
      if (index === 0) built.reflection = openingReflection(u, f)
      let answer = e.answer
      if (answer && answer.optionId && !built.options.some(o => o.id === answer.optionId)) answer = null
      if (answer && answer.optionId) {
        const opt = built.options.find(o => o.id === answer.optionId)
        answer = { ...answer, label: opt.label, value: opt.value }
      }
      const next = { ...e, reflection: built.reflection, question: built.question, options: built.options, allowOwnWords: built.allowOwnWords, ownWordsHint: built.ownWordsHint || null, answer }
      if (answer) answers[e.focus] = answer
      out.push(next)
    })
    return out
  }

  function notes(ctx, stage, extra = {}) {
    const { q, f } = analysis(ctx)
    const route = routeModel({ tier: q.tier, features: f, stage })
    return { simulated: true, provider: 'simulated', stage, model: route.model, modelReason: route.reason, opportunity: route.opportunity, complexity: route.complexity, tier: q.tier, qualificationReason: q.reason, ...extra }
  }

  return {
    kind: 'simulated',

    async qualify(ctx) {
      const text = effectiveText(ctx)
      if (latency) await wait(thinkTime(text, 500))
      return analysis(ctx).q
    },

    async open(ctx) {
      const { q, u, f } = analysis(ctx)
      if (latency) await wait(thinkTime(effectiveText(ctx), 500))
      const focuses = planFocuses(u, f, q.tier)
      const skeleton = focuses.map(focus => ({ id: newId(focus), focus, reflection: '', question: '', options: [], answer: null }))
      return { exchanges: regenerate(ctx, skeleton), notes: notes(ctx, 'open', { plan: focuses }) }
    },

    async answer(ctx, exchangeId, answer) {
      if (latency) await wait(420)
      const exchanges = ctx.exchanges.map(e => (e.id === exchangeId ? { ...e, answer } : e))
      return { exchanges: regenerate(ctx, exchanges), notes: notes(ctx, 'next') }
    },

    async compose(ctx) {
      const { u, f } = analysis(ctx)
      if (latency) await wait(900)
      const parts = deriveParts(u, answersByFocus(ctx), f)
      const text = composeStatement(parts, 'charter')
      return { statement: { text, title: parts.title, source: 'generated', variant: 'charter' }, parts, notes: notes(ctx, 'compose') }
    },

    async refine(ctx, mode) {
      const { u, f } = analysis(ctx)
      if (latency) await wait(700)
      const parts = deriveParts(u, answersByFocus(ctx), f)
      const text = composeStatement(parts, mode)
      return { statement: { text, title: parts.title, source: 'generated', variant: mode }, parts, notes: notes(ctx, 'refine', { mode }) }
    },

    /** Synchronous: what the understanding ply can already show. */
    sketch(ctx) {
      if (!ctx.submission) return null
      const { u, f } = analysis(ctx)
      return sketchParts(u, answersByFocus(ctx), f)
    },

    /** Synchronous helper for diagnostics and tests. */
    inspect(ctx) {
      return analysis(ctx)
    },
  }
}
