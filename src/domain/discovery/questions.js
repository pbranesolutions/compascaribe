// Question bank and discovery plan for the simulated engine.
//
// Every question is purpose-built around project definition: objective,
// people, current state, success, scope. Options carry structured values that
// feed the project statement. Copy limits (enforced by tests): reflection
// ≤ 150 chars, question ≤ 90 chars, option label ≤ 46 chars.

import { cap, embed, isUncountable, plural, toYou, trimTo } from './language.js'

/** First variant that fits the cap, else the last one trimmed. */
function firstFit(cap, ...variants) {
  for (const v of variants) if (v && v.length <= cap) return v
  return trimTo(variants[variants.length - 1], cap)
}
import { capSubject, subjectOrFallback } from './understanding.js'

import { FOCUS_TITLES } from './vocabulary.js'

export const FOCUS_ORDER = ['objective', 'people', 'current', 'scope', 'success']
export { FOCUS_TITLES }

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
  if (u.productForOthers || (tier === 3 && !u.who && !u.domainId && f.artifacts.length)) focuses.push('scope')
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
  const actorsKnown = Boolean(u.actors) && u.actors !== 'the people you serve' && u.actors !== 'whoever runs the day'
  return { one, many, each, eachCap, aOne, are, actors, actorsKnown, generic, uncountable }
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
    label: s => (s.actorsKnown ? `Serve more ${s.actors} with the same team` : 'Serve more people with the same team'),
    recap: s => (s.actorsKnown ? `the goal is serving more ${s.actors} with the same team` : 'the goal is serving more people with the same team'),
    phrase: s => (s.generic ? 'take on more work without adding overhead' : `take on more ${s.many} without adding overhead`),
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
    firstFit(46, `${s.eachCap} is accounted for, no exceptions`, `${s.eachCap} is accounted for`),
    `Nobody asks “did anyone handle this?”`,
    firstFit(46, `${cap(s.aOne)} is entered once and never re-typed`, `${cap(s.aOne)} is entered only once`),
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
    firstFit(46, `${cap(s.actors)} do it without calling`, 'They do it without calling'),
    `Staff are interrupted far less`,
    firstFit(46, `${cap(s.actors)} get an answer faster than before`, `${cap(s.actors)} get answers faster`, 'They get answers faster'),
  ],
  growth: s => [
    s.generic ? 'More work is handled by the same team' : firstFit(46, `More ${s.many} ${s.are} handled by the same team`, `More ${s.many}, same team`),
    s.generic ? 'New requests are handled the same day' : firstFit(46, `New ${s.many} ${s.are} handled the same day`, `New ${s.many} handled the same day`),
    `Growth no longer means a new hire`,
  ],
  quality: s => [
    `Corrections after the fact are rare`,
    `Everyone works from the same facts`,
    firstFit(46, `${cap(s.aOne)} is right the first time`, 'It is right the first time'),
  ],
  custom: s => [
    s.generic ? 'Measurably less time goes to this' : firstFit(46, `Measurably less time goes to ${s.many}`, `Less time goes to ${s.many}`),
    s.generic ? 'Nothing is missed' : firstFit(46, `Nothing about ${s.many} is missed`, `No ${s.one} is missed`),
    s.generic ? 'Everyone sees the same picture' : firstFit(46, `Everyone sees the same picture of ${s.many}`, `Everyone sees the same ${s.many}`),
  ],
}

export function buildSuccess(u, f, answers) {
  const s = objectiveSlots(u)
  const objectiveId = answers.objective ? answers.objective.value?.objectiveId || 'custom' : inferObjectiveId(u, f)
  const labels = (SUCCESS[objectiveId] || SUCCESS.custom)(s)
  return {
    reflection: successReflection(u, answers),
    question: 'Six months in, how would you know it worked?',
    options: labels.map((label, i) => ({ id: `s${i + 1}`, label, value: { success: label } })),
    allowOwnWords: true,
    ownWordsHint: "I'd put it differently",
  }
}

export const BUILDERS = { objective: buildObjective, people: buildPeople, current: buildCurrent, scope: buildScope, success: buildSuccess }

// ---------------------------------------------------------------------------
// Reflections: what the engine has understood so far. Specific, never praise.

export function openingReflection(u, f) {
  const S = capSubject(u, null)
  const at = u.who && u.who !== 'you' ? ` at ${u.who}` : ''
  if (u.rejectedArtifact && !u.artifact) {
    return firstFit(150,
      `Not ${u.rejectedArtifact}, then. ${u.subjectGeneric ? 'The result the project must produce is what we define first.' : `What ${u.subject} need${u.subjectPlural ? '' : 's'} to achieve is what we define first.`}`,
      `Not ${u.rejectedArtifact}, then. The result comes first.`)
  }
  if (u.productForOthers) {
    return firstFit(150,
      `You are describing something for others to use${u.subjectGeneric ? '' : `, around ${u.subject}`}. Before features, the result it must produce for them has to be clear.`,
      'You are describing something for others to use. The result it must produce for them comes first.')
  }
  if (u.solutionFirst && u.subjectGeneric) {
    return trimTo(`You've named the tool: ${u.artifact}. What it has to achieve is still open, so that is where we start.`, 150)
  }
  if (!u.subjectGeneric && u.painClause) {
    return firstFit(150,
      `${S} ${u.painClause} today${at}. That is the problem worth solving before deciding what to build.`,
      `${S} ${u.painClause} today. That is the problem worth solving before deciding what to build.`,
      `${S} ${u.painClause} today${at}. That is the problem to solve first.`,
      `${S} ${u.painClause} today. That is the problem to solve first.`)
  }
  if (u.purpose && u.purposeKind === 'result') {
    const tail = u.domainOps ? ` For ${u.who || 'a business like yours'}, that runs through ${u.domainOps}.` : ''
    return trimTo(`The result you want: ${u.purpose}.${tail}`, 150)
  }
  if (u.purpose) {
    const whoTail = u.who && u.who !== 'you' ? ` That is a capability ${u.who} does not have today; the project exists to create it.` : ' That is the capability the project exists to create.'
    return firstFit(150, `The aim you stated: ${u.purpose}.${whoTail}`, `The aim you stated: ${u.purpose}. The project exists to create that capability.`, `The aim you stated: ${u.purpose}.`)
  }
  if (u.artifact && u.domainOps && u.who) {
    return firstFit(150,
      `You've named the tool: ${u.artifact}. For ${u.who} it could serve ${u.domainOps}; what it must achieve comes first.`,
      `You've named the tool: ${u.artifact}. What it must achieve for ${u.who} comes first.`)
  }
  if (!u.subjectGeneric && u.artifact) {
    return firstFit(150,
      `You've described ${u.artifact} around ${u.subject}${u.who && u.who !== 'you' ? ` for ${u.who}` : ''}. The tool is a means; the result it must produce comes first.`,
      `You've described ${u.artifact} around ${u.subject}. The tool is a means; the result comes first.`)
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
  const subj = u.subjectGeneric ? 'the problem' : u.subject
  return firstFit(150,
    `${recap ? recap + ' ' : ''}Whoever carries ${subj} day to day decides what “better” means.`,
    `${recap ? recap + ' ' : ''}Whoever carries this day to day decides what “better” means.`,
    `Whoever carries ${subj} day to day decides what “better” means.`)
}

export function currentReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  const p = answers.people
  const who = p ? (p.text ? toYou(embed(trimTo(p.text, 50))) : embed(p.label)) : null
  const mid = who ? `It lands on ${who}. ` : ''
  const subj = u.subjectGeneric ? 'this' : u.subject
  const are = u.subjectGeneric ? 'is' : u.subjectPlural ? 'are' : 'is'
  return firstFit(150,
    `${recap ? recap + ' ' : ''}${mid}How ${subj} ${are} handled today is the baseline we improve on.`,
    `${recap ? recap + ' ' : ''}How ${subj} ${are} handled today is the baseline we improve on.`,
    `${mid}How ${subj} ${are} handled today is the baseline we improve on.`)
}

export function scopeReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  return trimTo(`${recap ? recap + ' ' : ''}One more thing shapes everything downstream: who this is ultimately for.`, 150)
}

export function successReflection(u, answers) {
  const recap = objectiveRecap(u, answers)
  const c = answers.current
  const current = c
    ? c.text ? `Today: ${toYou(embed(trimTo(c.text, 60)))}.` : `Today it runs on ${embed(c.label)}.`
    : u.painClause ? `Today ${subjectOrFallback(u)} ${u.painClause}.` : ''
  const subj = u.subjectGeneric ? 'this' : u.subject
  const has = u.subjectGeneric || !u.subjectPlural ? 'has' : 'have'
  return firstFit(150,
    `${recap ? recap + ' ' : ''}${current ? current + ' ' : ''}Last: the test that tells us ${subj} ${has} improved.`,
    `${recap ? recap + ' ' : ''}Last: the test that tells us ${subj} ${has} improved.`,
    `${current ? current + ' ' : ''}Last: the test that tells us it worked.`,
    'Last: the test that tells us it worked.')
}

export { OBJECTIVES, plural }
