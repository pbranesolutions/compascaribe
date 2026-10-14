// Shared test doubles for the gate. These stand in for api.typesafe.ai so the
// application logic can be tested deterministically; they are test-only and are
// not reachable from any production path.

import { QUESTION_KEYS } from '../src/domain/gate/questions.js'

export function jevBody(signals, { model = 'jev-1.13.0', input = 296, output = 20 } = {}) {
  const noul = p => ({ type: 'noul', noul: p })
  return {
    model,
    answers: {
      [QUESTION_KEYS.intent]: noul(signals.intent),
      [QUESTION_KEYS.irrelevance]: noul(signals.irrelevance),
      [QUESTION_KEYS.spam]: noul(signals.spam),
    },
    usage: { input_tokens: input, output_tokens: output },
  }
}

export function res(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

/**
 * A fetch that plays a script of responses (or functions/errors) in order and
 * records every call. The last step repeats.
 */
export function scripted(...steps) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null })
    const step = steps.length > 1 ? steps.shift() : steps[0]
    if (step instanceof Error) throw step
    return typeof step === 'function' ? step(url, init) : step.clone ? step.clone() : step
  }
  return { fetchImpl, calls }
}

/** A fetch that never answers until its abort signal fires, like a stalled connection. */
export function hanging() {
  const calls = []
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    calls.push({ url, init })
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
  return { fetchImpl, calls }
}

/** Looks the submission up in a table of signals, as a model would return them. */
export function byText(table, fallback = { intent: 0.5, irrelevance: 0.2, spam: 0.05 }) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, init, body })
    return res(200, jevBody(table[body.state] || fallback))
  }
  return { fetchImpl, calls }
}

export const noSleep = async () => {}
