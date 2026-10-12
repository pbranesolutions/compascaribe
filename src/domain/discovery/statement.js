// Project statement composition and refinement (simulated).
//
// Follows project-charter discipline: one to three sentences that name who the
// project serves, the capability it must create, why that matters, the
// baseline it replaces, and the test of success. Never a paraphrase of the
// visitor's input: the artifact they named becomes a capability, and the
// answers they gave supply the why and the test.

import { LIMITS } from '../context.js'
import { cap, embed, isVerbPhrase, lower, sentence, stripTerminal, toYou, trimTo } from './language.js'
import { OBJECTIVES, inferObjectiveId, objectiveSlots } from './questions.js'
import { subjectOrFallback } from './understanding.js'

/**
 * @typedef {Object} StatementParts
 * @property {string} who
 * @property {string} capability    verb phrase: "see the state of orders at a glance"
 * @property {string} outcome       clause: "anyone can answer…"
 * @property {string|null} current  clause: "orders arrive over messages…"
 * @property {string|null} success  clause: "every order is accounted for"
 * @property {string} title
 * @property {string} objectiveId
 */

function resolveWho(u, answers) {
  const scope = answers.scope?.value
  if (scope?.who) return scope.who
  if (u.who) return u.who
  const p = answers.people
  if (p?.value?.who) return p.value.who
  if (p?.text) return 'your operation'
  return 'you'
}

function resolveActors(u, answers) {
  const p = answers.people
  // Own words about people name individuals; templates need a plural role, so
  // the words themselves live in the ledger and the record, not in the prose.
  if (p?.text) return 'the people you named'
  if (p?.value?.actors && p.value.actors !== 'you' && p.value.actors !== 'your team') return p.value.actors
  return u.actors || 'the people you serve'
}

const HAS_FINITE_VERB = /\b(is|are|was|were|use|uses|used|do|does|did|have|has|had|write|writes|call|calls|go|goes|get|gets|come|comes|live|lives|handle|handles|track|tracks|keep|keeps|run|runs|manage|manages|sit|sits|happen|happens|depend|depends|rely|relies|work|works|send|sends|text|texts|ask|asks|forget|forgets|lose|loses|copy|copies|type|types|check|checks|answer|answers|need|needs|want|wants|know|knows|see|sees|take|takes|make|makes|try|tries|end|ends|fall|falls|arrive|arrives|exist|exists|stay|stays|isn't|aren't|don't|doesn't|can't|cannot|won't)\b/i

/**
 * @param {import('./understanding.js').Understanding} u
 * @param {Record<string, import('../context.js').Answer>} answers
 * @param {import('../qualification/analyze.js').Features} f
 * @returns {StatementParts}
 */
export function deriveParts(u, answers, f) {
  const slots = { ...objectiveSlots(u), actors: resolveActors(u, answers) }
  const who = resolveWho(u, answers)
  const obj = answers.objective
  let capability
  let outcome
  let title
  let objectiveId

  if (obj?.text) {
    // The visitor's own words are the objective. A verb phrase ("stop losing
    // deposits") is the capability; a clause ("patients stop showing up late")
    // is the outcome, with an inferred capability in front of it.
    objectiveId = 'custom'
    const own = toYou(stripTerminal(obj.text))
    if (isVerbPhrase(own)) {
      capability = lower(own.replace(/^(to|you need to|you want to|you should|be able to)\s+/i, ''))
      outcome = u.purposeKind === 'result' && u.purpose ? u.purpose : 'the result you described actually happens'
      title = trimTo(cap(capability), 48)
    } else {
      const inferred = OBJECTIVES[inferObjectiveId(u, f)] || OBJECTIVES.missed
      capability = inferred.phrase(slots)
      outcome = lower(own)
      title = trimTo(cap(own), 48)
    }
  } else {
    objectiveId = obj?.value?.objectiveId || inferObjectiveId(u, f)
    const o = OBJECTIVES[objectiveId] || OBJECTIVES.missed
    capability = o.phrase(slots)
    outcome = o.outcome(slots)
    if (u.purposeKind === 'capability' && u.purpose) {
      // Their stated aim is the capability; our objective supplies the why.
      capability = obj ? `${o.phrase(slots)}, and ${u.purpose}` : u.purpose
    } else if (u.purposeKind === 'result' && u.purpose && objectiveId !== 'selfservice') {
      outcome = u.purpose
    }
    title = trimTo(o.title(slots), 48)
  }

  const c = answers.current
  let current = null
  if (c?.text) {
    const own = toYou(embed(c.text))
    current = HAS_FINITE_VERB.test(own) ? own : `${subjectOrFallback(u, 'the work')} ${u.subjectPlural ? 'run' : 'runs'} on ${own}`
  } else if (c?.value?.clause) current = c.value.clause
  else if (u.painClause) current = `${subjectOrFallback(u)} ${u.painClause}`

  const s = answers.success
  let success = null
  if (s?.text) {
    const own = toYou(embed(s.text))
    success = isVerbPhrase(own) && !HAS_FINITE_VERB.test(own) ? `you can ${own}` : own
  } else if (s?.value?.success) success = lower(stripTerminal(s.value.success))

  return { who, capability, outcome, current, success, title, objectiveId }
}

/**
 * Compose a statement in one of several registers. Refinement picks a shape.
 * @param {StatementParts} p
 * @param {'charter'|'plain'|'narrow'|'broad'} variant
 */
export function composeStatement(p, variant = 'charter') {
  const who = p.who
  const whoCap = cap(who)
  const isYou = who === 'you'
  let text
  switch (variant) {
    case 'plain': {
      const s1 = sentence(`${whoCap} need${isYou ? '' : 's'} to ${p.capability}`)
      const s2 = p.current ? sentence(`Right now ${p.current}`) : ''
      const s3 = sentence(`Success means ${p.success || p.outcome}`)
      text = [s1, s2, s3].filter(Boolean).join(' ')
      break
    }
    case 'narrow': {
      const s1 = sentence(`This project gives ${who} one dependable way to ${p.capability}, starting with the single step that causes the most friction today`)
      const s2 = sentence(`It has worked when ${p.success || p.outcome}`)
      text = [s1, s2].join(' ')
      break
    }
    case 'broad': {
      const s1 = sentence(`This project changes how ${who} ${isYou ? 'work' : 'works'}: ${p.capability}, so that ${p.outcome} across the whole operation, not just one step`)
      const s2 = p.success ? sentence(`The measure of success: ${p.success}`) : ''
      text = [s1, s2].filter(Boolean).join(' ')
      break
    }
    case 'charter':
    default: {
      const s1 = sentence(`This project gives ${who} one dependable way to ${p.capability}, so that ${p.outcome}`)
      const s2 = p.current && p.success
        ? sentence(`Today ${p.current}; it will have worked when ${p.success}`)
        : p.success
          ? sentence(`It will have worked when ${p.success}`)
          : p.current
            ? sentence(`Today ${p.current}`)
            : ''
      text = [s1, s2].filter(Boolean).join(' ')
    }
  }
  text = text.replace(/\s+/g, ' ').replace(/\.\./g, '.').replace(/,\s*,/g, ',').trim()
  if (text.length > LIMITS.statement) {
    const shorter = text.replace(/\s*Today [^;]*;\s*it will have worked when/, ' It will have worked when')
    text = shorter.length <= LIMITS.statement ? shorter : trimTo(shorter, LIMITS.statement)
  }
  return text
}

/**
 * Partial parts for the understanding ply: null wherever nothing is known yet,
 * so the skeleton sentence shows blanks rather than guesses.
 * @returns {{who:string|null, capability:string|null, outcome:string|null, current:string|null, success:string|null, focusFor:Record<string,string>}}
 */
export function sketchParts(u, answers, f) {
  const full = deriveParts(u, answers, f)
  const knowsObjective = Boolean(answers.objective) || u.purposeKind === 'capability' || u.purposeKind === 'result'
  const knowsWho = Boolean(u.who) || Boolean(answers.people?.value?.who) || Boolean(answers.people?.text) || Boolean(answers.scope?.value?.who)
  const knowsCurrent = Boolean(answers.current) || Boolean(u.painClause)
  const knowsSuccess = Boolean(answers.success)
  return {
    who: knowsWho ? full.who : null,
    capability: knowsObjective ? full.capability : null,
    outcome: Boolean(answers.objective) || u.purposeKind === 'result' ? full.outcome : null,
    current: knowsCurrent ? full.current : null,
    success: knowsSuccess ? full.success : null,
    focusFor: { who: 'people', capability: 'objective', outcome: 'objective', current: 'current', success: 'success' },
  }
}

export { REFINEMENTS } from './vocabulary.js'
