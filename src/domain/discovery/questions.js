// Question bank and discovery plan for the simulated engine.
//
// Every question is purpose-built around project definition: objective,
// people, current state, success, scope. Options carry structured values that
// feed the project statement. Copy limits (enforced by tests): reflection
// ≤ 150 chars, question ≤ 90 chars, option label ≤ 46 chars.

import { cap, embed, isUncountable, plural, trimTo } from './language.js'
import { capSubject, subjectOrFallback } from './understanding.js'

export const FOCUS_ORDER = ['objective', 'people', 'current', 'scope', 'success']

export const FOCUS_TITLES = Object.freeze({
  objective: 'Objective',
  people: 'People',
  current: 'Today',
  scope: 'Scope',
  success: 'Success',
})

/**
 * Decide which questions to ask, in order. 2–4 questions.
 * @param {import('./understanding.js').Understanding} u
 * @param {import('../qualification/analyze.js').Features} f
 * @param {number} tier
 */
export function planFocuses(u, f, tier) {
  const focuses = []
  const hasStatedResult = u.purposeKind === 'result' || f.outcomes.length > 0
  if (u.solutionFirst || !hasStatedResult || u.subjectGeneric) focuses.push('objective')
  if (!u.actors && !u.who) focuses.push('people')
  if (!u.painClause) focuses.push('current')
  if (tier === 3 && !u.who && !u.domainId && f.artifacts.length) focuses.push('scope')
  focuses.push('success')

  const priority = ['objective', 'success', 'current', 'people', 'scope']
  while (focuses.length > 4) {
    const drop = [...priority].reverse().find(p => focuses.includes(p))
    focuses.splice(focuses.indexOf(drop), 1)
  }
  if (focuses.length < 2) focuses.unshift('objective')
  return FOCUS_ORDER.filter(x => focuses.includes(x))
}

// ---------------------------------------------------------------------------
// Slots shared by objective phrases, success clauses and the statement.

export function objectiveSlots(u) {
  const generic = u.subjectGeneric
  const one = generic ? 'request' : u.subjectOne
  const many = generic ? 'the work' : u.subject
  const uncountable = !generic && (isUncountable(one) || one === 'client work' || one === 'production')
  const each = uncountable ? `all ${one}` : `every ${one}`
  const eachCap = cap(each)
  const aOne = uncountable ? one : /^[aeiou]/.test(one) ? `an ${one}` : `a ${one}`
  const are = u.subjectPlural ? 'are' : 'is'
  const actors = u.actors || 'the people you serve'
  return { one, many, each, eachCap, aOne, are, actors, generic, uncountable }
}

const OBJECTIVES = {
  missed: {
    label: s => `Nothing falls through the cracks`,
    recap: s => `the goal is that nothing falls through the cracks`,
    phrase: s => `make sure ${s.each} is captured and followed through`,
    outcome: s => `nothing is lost between first contact and completion`,
    title: s => (s.generic ? 'Reliable follow-through' : `Reliable ${s.many} tracking`),
  },
  time: {
    label: s => `Less time on manual work`,
    recap: s => `the goal is less time on manual work`,
    phrase: s => `handle ${s.many} without re-typing or chasing`,
    outcome: s => `the team stops re-entering and chasing information`,
    title: s => (s.generic ? 'Less manual work' : `${cap(s.many)} without manual re-entry`),
  },
  visibility: {
    label: s => `See what's happening at a glance`,
    recap: s => `the goal is seeing what's happening at a glance`,
    phrase: s => `see the state of ${s.many} at a glance`,
    outcome: s => `anyone can answer “where does this stand?” without asking around`,
    title: s => (s.generic ? 'A live view of the work' : `A live view of ${s.many}`),
  },
  selfservice: {
    label: s => `${cap(s.actors)} can do it themselves`,
    recap: s => `the goal is letting ${s.actors} do it themselves`,
    phrase: s => `let ${s.actors} handle ${s.many} themselves`,
    outcome: s => `${s.actors} get what they need without waiting on someone`,
    title: s => (s.generic ? `Self-service for ${s.actors}` : `Self-service ${s.many}`),
  },
  growth: {
    label: s => `Serve more ${s.actors} with the same team`,
    recap: s => `the goal is serving more ${s.actors} with the same team`,
    phrase: s => `take on more ${s.many} without adding overhead`,
    outcome: s => `growth does not mean more people doing the same manual work`,
    title: s => (s.generic ? 'Scaling the operation' : `Scaling ${s.many}`),
  },
  quality: {
    label: s => `Fewer mistakes`,
    recap: s => `the goal is fewer mistakes`,
    phrase: s => `get ${s.many} right the first time`,
    outcome: s => `the errors that come from working by hand stop happening`,
    title: s => (s.generic ? 'Fewer mistakes' : `Error-free ${s.many}`),
  },
}

/** When the objective question is skipped, infer the most likely objective. */
export function inferObjectiveId(u, f) {
  const pains = f.pains.join(' ')
  const outs = f.outcomes.join(' ')
  const purpose = u.purpose || ''
  if (/know|see|visib|glance|one place|status|where/.test(purpose + ' ' + outs) || /no visibility|dont know|don't know|cant see|can't see|scattered/.test(pains)) return 'visibility'
  if (u.purposeKind === 'result' && /^(customers|clients|guests|patients|tenants|students|members|people|travelers|the public)\b/.test(purpose)) return 'selfservice'
  if (/double[- ]?book|lose track|fall|missed|missing|forget|no show/.test(pains)) return 'missed'
  if (/whatsapp|phone|calling|retype|re-type|copy|manual|by hand|double entry|spreadsheet|excel|paper|notebook/.test(pains)) return 'time'
  if (/grow|scale|more sales|more customers|more clients|revenue/.test(outs)) return 'growth'
  if (/error|mistake/.test(pains) || /fewer errors|accurate/.test(outs)) return 'quality'
  return 'missed'
}

function pickObjectiveIds(u, f) {
  const ids = []
  const pains = f.pains.join(' ')
  const outs = f.outcomes.join(' ')
  if (/lose track|fall|missed|missing|forget|no show|double/.test(pains)) ids.push('missed')
  if (/whatsapp|phone|calling|retype|re-type|copy|manual|by hand|double entry|spreadsheet|excel|paper|notebook|tedious|repetitive/.test(pains)) ids.push('time')
  if (/no visibility|know|see|scattered|all over|chaos|messy|disorgan/.test(pains) || /visibility|glance|one place|real time|source of truth|know/.test(outs)) ids.push('visibility')
  if (u.actorsId && /customers|clients|guests|patients|tenants|students|members|public|domain:/.test(u.actorsId)) ids.push('selfservice')
  if (/grow|scale|more sales|more customers|more clients|revenue/.test(outs) || /grow|scale/.test(f.build.join(' '))) ids.push('growth')
  if (/error|mistake/.test(pains) || /fewer errors|accurate|consistent|reliable/.test(outs)) ids.push('quality')
  for (const d of ['missed', 'time', 'visibility', 'selfservice', 'growth', 'quality']) if (!ids.includes(d)) ids.push(d)
  return [...new Set(ids)].slice(0, 4)
}

// ---------------------------------------------------------------------------
// Builders. Each returns { reflection, question, options, allowOwnWords }.

export function buildObjective(u, f, answers) {
  const s = objectiveSlots(u)
  const options = pickObjectiveIds(u, f).map(id => ({
    id,
    label: trimTo(OBJECTIVES[id].label(s), 46),
    value: { objectiveId: id },
  }))
  let question = 'What should be different when this works?'
  if (u.solutionFirst) question = 'What should be different once it exists?'
  else if (u.purposeKind === 'result' && u.whoNoun) question = `What should that change for your ${u.whoNoun}?`
  return {
    reflection: openingReflection(u, f),
    question: trimTo(question, 90),
    options,
    allowOwnWords: true,
    ownWordsHint: 'In your words',
  }
}

export function buildPeople(u, f, answers) {
  const options = [
    { id: 'owner', label: 'Me, running the operation', value: { who: 'you', actors: 'you' } },
    { id: 'staff', label: 'The team doing the work', value: { who: 'your team', actors: 'your team' } },
  ]
  if (u.actors && !/^your (team|staff)/.test(u.actors)) {
    options.push({ id: 'served', label: trimTo(`The ${u.actors.replace(/^your /, '')} we serve`, 46), value: { who: 'your operation', actors: u.actors } })
  } else {
    options.push({ id: 'served', label: 'The people we serve', value: { who: 'your operation', actors: 'the people you serve' } })
  }
  options.push({ id: 'everyone', label: 'All of us, in different ways', value: { who: 'your operation', actors: 'everyone involved' } })
  return {
    reflection: peopleReflection(u, answers),
    question: 'Who feels this most today?',
    options,
    allowOwnWords: true,
    ownWordsHint: 'Someone else',
  }
}

export function buildCurrent(u, f, answers) {
  const many = subjectOrFallback(u, 'things')
  const are = u.subjectGeneric ? 'are' : u.subjectPlural ? 'are' : 'is'
  const move = are === 'are' ? 'move' : 'moves'
  return {
    reflection: currentReflection(u, answers),
    question: 'How is this handled right now?',
    options: [
      { id: 'messages', label: 'Messages and phone calls', value: { currentId: 'messages', clause: `${many} ${move} through messages and calls and ${are === 'are' ? 'live' : 'lives'} in people's heads` } },
      { id: 'spreadsheet', label: 'Spreadsheets or paper', value: { currentId: 'spreadsheet', clause: `${many} ${are} tracked in spreadsheets or on paper` } },
      { id: 'tool', label: "A tool that doesn't quite fit", value: { currentId: 'tool', clause: `a tool that does not fit the way you work carries ${many}` } },
      { id: 'nothing', label: "It isn't — things get missed", value: { currentId: 'nothing', clause: `nothing holds ${many} together, so things get missed` } },
    ],
    allowOwnWords: true,
    ownWordsHint: 'Something else',
  }
}

export function buildScope(u, f, answers) {
  return {
    reflection: scopeReflection(u, answers),
    question: 'Who is this for?',
    options: [
      { id: 'own', label: 'My own operation', value: { scopeId: 'own', who: 'your operation' } },
      { id: 'product', label: 'A product for other businesses', value: { scopeId: 'product', who: 'the businesses you want to serve' } },
      { id: 'public', label: 'A service for the public', value: { scopeId: 'public', who: 'the people you want to reach' } },
      { id: 'unsure', label: 'Not sure yet', value: { scopeId: 'unsure', who: null } },
    ],
    allowOwnWords: false,
  }
}

// Success options are clauses that read after "it will have worked when …".
const SUCCESS = {
  missed: s => [
    `${s.eachCap} is accounted for, no exceptions`,
    `Nobody asks “did anyone handle this?”`,
    `${cap(s.aOne)} is entered once and never re-typed`,
  ],
  time: s => [
    `Hours a week come back to the team`,
    `Nothing is entered twice`,
    `The same work needs fewer people chasing it`,
  ],
  visibility: s => [
    `One place answers “where does this stand?”`,
    `Decisions come from live numbers, not memory`,
    `Surprise calls and check-ins are rare`,
  ],
  selfservice: s => [
    `${cap(s.actors)} do it without calling`,
    `Staff are interrupted far less`,
    `${cap(s.actors)} get an answer faster than before`,
  ],
  growth: s => [
    `More ${s.many} ${s.are} handled by the same team`,
    `New ${s.many} ${s.are} handled the same day`,
    `Growth no longer means a new hire`,
  ],
  quality: s => [
    `Corrections after the fact are rare`,
    `Everyone works from the same facts`,
    `${cap(s.aOne)} is right the first time`,
  ],
  custom: s => [
    `Measurably less time goes to ${s.many}`,
    `Nothing about ${s.many} is missed`,
    `Everyone sees the same picture of ${s.many}`,
  ],
}

export function buildSuccess(u, f, answers) {
  const s = objectiveSlots(u)
  const objectiveId = answers.objective ? answers.objective.value?.objectiveId || 'custom' : inferObjectiveId(u, f)
  const labels = (SUCCESS[objectiveId] || SUCCESS.custom)(s)
  return {
    reflection: successReflection(u, answers),
    question: 'Six months in, how would you know it worked?',
    options: labels.map((label, i) => ({ id: `s${i + 1}`, label: trimTo(label, 46), value: { success: label } })),
    allowOwnWords: true,
    ownWordsHint: "I'd put it differently",
  }
}

export const BUILDERS = { objective: buildObjective, people: buildPeople, current: buildCurrent, scope: buildScope, success: buildSuccess }

// ---------------------------------------------------------------------------
// Reflections: what the engine has understood so far. Specific, never praise.

export function openingReflection(u, f) {
  const S = capSubject(u, null)
  const at = u.who ? ` at ${u.who}` : ''
  if (u.solutionFirst && u.subjectGeneric) {
    return trimTo(`You've named the tool: ${u.artifact}. What it has to achieve is still open, so that is where we start.`, 150)
  }
  if (!u.subjectGeneric && u.painClause) {
    return trimTo(`${S} ${u.painClause} today${at}. That is the problem worth solving before deciding what to build.`, 150)
  }
  if (u.purpose && u.purposeKind === 'result') {
    const tail = u.domainOps ? ` For ${u.who || 'a business like yours'}, that runs through ${u.domainOps}.` : ''
    return trimTo(`The result you want: ${u.purpose}.${tail}`, 150)
  }
  if (u.purpose) {
    const tail = u.who ? ` That is a capability ${u.who} does not have today; the project exists to create it.` : ' That is the capability the project exists to create.'
    return trimTo(`The aim you stated: ${u.purpose}.${tail}`, 150)
  }
  if (u.artifact && u.domainOps) {
    return trimTo(`You've named the tool: ${u.artifact}. For ${u.who || 'your operation'} it could serve ${u.domainOps}; what it must achieve comes first.`, 150)
  }
  if (!u.subjectGeneric && u.artifact) {
    return trimTo(`You've described ${u.artifact} around ${u.subject}${u.who ? ` for ${u.who}` : ''}. The tool is a means; the result it must produce comes first.`, 150)
  }
  if (!u.subjectGeneric && u.subjectInferred) {
    return trimTo(`For ${u.who || 'an operation like this'}, this usually comes down to ${u.subject}. Before anything is built, the result ${u.subjectPlural ? 'they' : 'it'} must produce has to be clear.`, 150)
  }
  if (!u.subjectGeneric) {
    return trimTo(`This is about ${u.subject}${at}. Before anything is built, the result ${u.subjectPlural ? 'they' : 'it'} must produce has to be clear.`, 150)
  }
  if (u.domainOps) {
    return trimTo(`${cap(u.who || 'a business like yours')} runs on ${u.domainOps}. The first job is naming the result this must produce.`, 150)
  }
  return 'There is a real idea here, still wide. We narrow it by naming the result it must produce.'
}

function objectiveRecap(u, answers) {
  const a = answers.objective
  if (!a) return null
  if (a.text) return `In your words, the result is: ${embed(trimTo(a.text, 90))}.`
  const o = OBJECTIVES[a.value?.objectiveId]
  return o ? `Understood: ${o.recap(objectiveSlots(u))}.` : `Understood: ${embed(a.label)}.`
}

export function peopleReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  return trimTo(`${recap ? recap + ' ' : ''}A project this size is shaped by whoever carries the problem day to day.`, 150)
}

export function currentReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  const p = answers.people
  const who = p ? (p.text ? embed(trimTo(p.text, 50)) : embed(p.label)) : null
  const mid = who ? `It lands on ${who}. ` : ''
  return trimTo(`${recap ? recap + ' ' : ''}${mid}The way it works today is the baseline we improve on.`, 150)
}

export function scopeReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  return trimTo(`${recap ? recap + ' ' : ''}One more thing shapes everything downstream: who this is ultimately for.`, 150)
}

export function successReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  const c = answers.current
  const current = c
    ? c.text ? `Today, ${embed(trimTo(c.text, 60))}.` : `Today it runs on ${embed(c.label)}.`
    : u.painClause ? `Today ${subjectOrFallback(u)} ${u.painClause}.` : ''
  return trimTo(`${recap ? recap + ' ' : ''}${current ? current + ' ' : ''}Last: the test that tells us it worked.`, 150)
}

export { OBJECTIVES, plural }
