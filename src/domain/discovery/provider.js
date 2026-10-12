// The generative-AI boundary.
//
// Every interaction that will eventually be served by a Claude model goes
// through a DiscoveryProvider. The UI and journey state never import a model
// SDK or the simulated engine directly; they call these five methods.
//
//   qualify(ctx)           -> Qualification           (Jev, then routing)
//   open(ctx)              -> { exchanges, notes }    first reflection + question plan
//   answer(ctx, id, ans)   -> { exchanges, notes }    re-generates downstream steps
//   compose(ctx)           -> { statement, notes }
//   refine(ctx, mode)      -> { statement, notes }
//
// `notes` is diagnostic metadata (model routing, timing, simulated flag) for the
// prototype notes panel. It must never be required for the visitor's experience.
//
// A production provider would POST to a Compás Caribe worker that enforces
// rate limits, session budgets and input limits before calling a model. See
// the README section "Production integration".

import { createSimulatedProvider } from './simulated.js'

/**
 * @typedef {Object} DiscoveryProvider
 * @property {string} kind
 * @property {(ctx: import('../context.js').ProjectContext) => Promise<import('../qualification/classifier.js').Qualification>} qualify
 * @property {(ctx: import('../context.js').ProjectContext) => Promise<{exchanges: import('../context.js').Exchange[], notes: Object}>} open
 * @property {(ctx: import('../context.js').ProjectContext, exchangeId: string, answer: import('../context.js').Answer) => Promise<{exchanges: import('../context.js').Exchange[], notes: Object}>} answer
 * @property {(ctx: import('../context.js').ProjectContext) => Promise<{statement: {text:string,title:string,source:string}, notes: Object}>} compose
 * @property {(ctx: import('../context.js').ProjectContext, mode: string) => Promise<{statement: {text:string,title:string,source:string}, notes: Object}>} refine
 */

/**
 * @param {{mode?: 'simulated'|'remote', latency?: boolean}} [options]
 * @returns {DiscoveryProvider}
 */
export function createProvider(options = {}) {
  const mode = options.mode || 'simulated'
  if (mode === 'remote') {
    // Integration point. Not implemented in the prototype on purpose: there is
    // no backend, and the prototype must never pretend a network call happened.
    throw new Error('Remote discovery provider is not available in this prototype build.')
  }
  return createSimulatedProvider({ latency: options.latency !== false })
}
