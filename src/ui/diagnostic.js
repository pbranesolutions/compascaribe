// Temporary diagnostic for the Jev gate. Presentation only: it renders the
// GateResult the backend returned, character for character, and computes
// nothing. Remove this file and its one line in views.js (VIEWS.gate) and the
// service, Worker and journey are unaffected.
//
// No prose is attributed to Jev. The three probabilities are shown as numbers,
// followed by the rules and thresholds that turned them into a decision.

import { trimTo } from '../domain/discovery/language.js'
import { h } from './dom.js'
import { pagedList, processing, yourWords } from './components.js'

// The visitor's words are shown in the body on roomy screens; otherwise one tap away in the header.
const roomy = () => {
  const d = document.documentElement.dataset
  return d.short !== 'true' && d.medium !== 'true' && d.tiny !== 'true'
}

const p3 = n => n.toFixed(3)

const FAILURE_TEXT = {
  configuration: 'The classifier is not configured on the server.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  overloaded: 'The classification service is overloaded.',
  timeout: 'The classification service did not answer in time.',
  network: 'The classification service could not be reached.',
  malformed: 'The service returned a response that could not be read.',
  provider_error: 'The classification service returned an error.',
}

const RULE_TEXT = {
  'block.spam': 'Spam or meaningless input',
  'block.irrelevance': 'Clear irrelevance',
  'proceed.default': 'No block rule was met',
}

const SIGNALS = [
  ['intent', 'Project intent'],
  ['irrelevance', 'Irrelevance'],
  ['spam', 'Spam / meaningless input'],
]

/** The rows of the "Decision basis" list: the rules and thresholds that produced the decision. */
export function basisRows(result) {
  const rows = []
  if (result.decision === 'UNAVAILABLE') {
    rows.push(['Reason', FAILURE_TEXT[result.failure?.kind] || 'The classification could not be completed.'])
    rows.push(['Decision', 'UNAVAILABLE is not a judgement of the submission; no rule was evaluated.'])
  } else {
    result.trace.forEach((r, i) => {
      rows.push([`Rule ${i + 1} · ${r.label}`, `${r.parts.map(p => p.text).join(' and ')} → ${r.met ? 'met' : 'not met'}`])
    })
    rows.push(['Applied', `${result.rule} → ${result.decision}${RULE_TEXT[result.rule] ? ` · ${RULE_TEXT[result.rule]}` : ''}`])
  }
  return rows
}

/** The measured facts about the call, always shown beside the rules: model, response time, tokens. */
export function telemetryRows(result) {
  return [
    ['Model', result.model || `not reported (requested ${result.requestedModel || 'unknown'})`],
    ['Response time', result.latencyMs === null ? 'not measured' : `${Math.round(result.latencyMs)} ms${result.attempts > 1 ? ` · ${result.attempts} attempts` : ''}`],
    ['Tokens', result.usage ? `${result.usage.inputTokens} in · ${result.usage.outputTokens} out` : 'not reported'],
  ]
}

function basisList(rows, page = 0) {
  const wrap = pagedList({
    items: rows,
    page,
    label: 'Basis',
    focusKey: 'gate-pager',
    onPage: (p) => {
      const next = basisList(rows, p)
      wrap.replaceWith(next)
      next.paginate()
    },
    renderItem: ([k, v], i) => h('div', { class: 'row' },
      h('span', { class: 'num' }, String(i + 1).padStart(2, '0')),
      h('span', null, h('span', { class: 'k' }, k), h('span', { class: 'v', style: { WebkitLineClamp: 'unset', display: 'block', fontSize: '14px' } }, v))),
  })
  return wrap
}

/**
 * @param {object} state  journey state (state.gate is the GateResult, null while it runs)
 * @param {object} actions
 * @param {{ head: Function, foot: Function, primary: Function, ghost: Function, ply: Function }} kit  shared view parts
 */
export function gateView(state, actions, kit) {
  const { head, foot, primary, ghost, ply, link } = kit
  const result = state.gate
  const edit = ghost('Edit your words', () => actions.back(), 'gate:edit')

  if (!result) {
    const words = h('p', { class: 'question', 'data-fit': '14,44', style: { margin: 0, maxHeight: 'var(--q-max)' } }, trimTo(state.ctx.submission?.text || '', 90))
    return ply([
      head(h('span', { class: 'label' }, h('b', null, 'You said'), ' · sent to Jev for classification')),
      h('div', { class: 'ply-body', style: { gridTemplateRows: 'minmax(0, 1fr) auto' } }, words, processing(['Classifying with Jev'], 0)),
      foot(edit, h('span', { class: 'label' }, 'Classification only')),
    ])
  }

  const failed = result.decision === 'UNAVAILABLE'
  const signalRows = SIGNALS.map(([key, label]) => {
    const v = result.signals ? result.signals[key] : null
    return h('div', { class: 'gate-signal' },
      h('span', { class: 'k' }, label),
      h('span', { class: 'bar', 'aria-hidden': 'true' }, v === null ? null : h('i', { style: { width: `${Math.round(v * 100)}%` } })),
      h('span', { class: 'n' }, v === null ? '—' : p3(v)))
  })

  const body = h('div', { class: 'ply-body gate', style: { gridTemplateRows: `auto auto ${roomy() ? 'auto ' : ''}minmax(0, 1fr) auto` } },
    h('div', { class: 'gate-decision' },
      h('span', { class: 'label' }, 'Decision'),
      h('h1', { class: 'question gate-word', id: 'q', tabIndex: -1, 'data-autofocus': 'true', 'data-decision': result.decision, 'data-fit': roomy() ? '26,56' : '20,40', style: { margin: 0, maxHeight: 'var(--q-max)' } }, result.decision)),
    h('div', { class: 'gate-signals', role: 'group', 'aria-label': 'Jev classification' }, signalRows),
    roomy() ? yourWords(state, actions, { lines: 2 }) : null,
    basisList(basisRows(result)),
    h('dl', { class: 'gate-telemetry' }, telemetryRows(result).map(([k, v]) => h('div', null, h('dt', { class: 'label' }, k), h('dd', null, v)))))

  const retry = primary('Try again', () => actions.retryGate(), { disabled: state.busy, key: 'gate:retry' })
  const rerun = ghost('Run again', () => actions.retryGate(), 'gate:retry')
  return ply([
    head(h('span', { class: 'label' }, h('b', null, 'Jev gate'), roomy() ? ' · live classification · nothing is routed' : ' · live'),
      roomy() ? null : link('Your words', () => actions.openOverlay('words', 0, 'gate:words'), 'gate:words')),
    body,
    failed
      ? foot(edit, retry)
      : foot(rerun, primary('Edit your words', () => actions.back(), { key: 'gate:edit' })),
  ])
}
