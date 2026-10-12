// Derives a structured "understanding" of the visitor's submission from the
// extracted features. The simulated engine builds every reflection, question
// and statement from this object plus the visitor's answers.

import { cap, isUncountable, joinNatural, lower, plural, stripTerminal, toSecondPerson, trimTo } from './language.js'

const OPS_PRIORITY = [
  'order', 'booking', 'reservation', 'appointment', 'work order', 'purchase order',
  'invoice', 'payment', 'payroll', 'inventory', 'stock', 'delivery', 'dispatch',
  'ticket', 'request', 'maintenance', 'enrollment', 'attendance', 'schedule',
  'scheduling', 'shift', 'quote', 'estimate', 'lead', 'donation', 'subscription',
  'rental', 'shipment', 'parcel', 'listing', 'contract', 'document', 'approval',
  'timesheet', 'expense', 'receipt', 'registration', 'referral', 'waitlist', 'queue',
  'inquiry', 'enquiry', 'claim', 'case', 'job', 'task', 'project', 'event', 'class',
  'session', 'visit', 'batch', 'production', 'harvest', 'crop', 'menu', 'table',
  'guest', 'customer', 'client', 'patient', 'student', 'tenant', 'member',
  'volunteer', 'vendor', 'supplier', 'staff', 'employee', 'technician', 'driver',
  'product', 'catalog', 'catalogue', 'sale', 'sales', 'report', 'data', 'message',
  'chat', 'hours', 'review', 'loyalty', 'campaign', 'training', 'onboarding',
  'compliance', 'billing', 'invoicing', 'tracking', 'check in', 'check-in',
  'route', 'fleet', 'vehicle', 'equipment', 'asset', 'unit', 'property', 'supply',
  'warehouse', 'application', 'grade', 'recipe', 'livestock',
]

// Work nouns that describe people rather than things being processed.
const PEOPLE_OPS = new Set(['guest', 'customer', 'client', 'patient', 'student', 'tenant', 'member', 'volunteer', 'vendor', 'supplier', 'staff', 'employee', 'technician', 'driver'])

// Vague work nouns that should yield to a domain default when one exists.
const WEAK_OPS = new Set(['report', 'data', 'message', 'chat', 'hours', 'application', 'job', 'task', 'project', 'case', 'request', 'document'])

const ACTOR_LABEL = {
  customers: 'customers', clients: 'clients', staff: 'your staff', technicians: 'your technicians',
  drivers: 'your drivers', students: 'students and parents', patients: 'patients', tenants: 'tenants',
  members: 'members', guests: 'guests', vendors: 'vendors', volunteers: 'volunteers',
  managers: 'whoever runs the day', public: 'the people you serve',
}

// Pain descriptions: [plural-subject clause, singular/uncountable-subject clause]
const PAIN_DESCRIPTIONS = [
  { test: /double[- ]?book|overbooked/, current: 'nothing', clauses: ['collide because nothing checks them against each other', 'collides because nothing checks it against the rest'] },
  { test: /whatsapp|text message|texts|phone call|phone calls|calling|back and forth|message/, current: 'messages', clauses: ['arrive through messages and calls and get copied by hand', 'arrives through messages and calls and gets copied by hand'] },
  { test: /spreadsheet|excel|google sheet|paper|notebook/, current: 'spreadsheet', clauses: ['live in spreadsheets or on paper', 'lives in spreadsheets or on paper'] },
  { test: /lose track|losing track|fall through|falls through|missed|missing|forget|forgotten|no show|no-show/, current: 'nothing', clauses: ['slip through the cracks', 'slips through the cracks'] },
  { test: /double entry|retype|re-type|copy|copying|manual|manually|by hand|repetitive|tedious/, current: 'spreadsheet', clauses: ['are re-entered by hand', 'is re-entered by hand'] },
  { test: /slow|takes hours|takes forever|waste|wasting|late|delay|bottleneck/, current: 'nothing', clauses: ['eat hours they should not', 'eats hours it should not'] },
  { test: /no visibility|dont know|don't know|no idea|cant see|can't see|cannot see|scattered|all over the place/, current: 'nothing', clauses: ['cannot be seen in one place', 'cannot be seen in one place'] },
  { test: /legacy|outdated|clunky|broken|unreliable|inconsistent/, current: 'tool', clauses: ['depend on a tool that no longer fits', 'depends on a tool that no longer fits'] },
  { test: /chaos|chaotic|messy|mess|disorganized|disorganised|overwhelmed|overwhelming|too many|confusion|confusing/, current: 'nothing', clauses: ['are held together by memory and effort', 'is held together by memory and effort'] },
  { test: /error|mistake/, current: 'spreadsheet', clauses: ['produce errors someone has to catch later', 'produces errors someone has to catch later'] },
  { test: /out of stock/, current: 'nothing', clauses: ['run out before anyone notices', 'runs out before anyone notices'] },
]

const DOMAIN_OPS = {
  hospitality: 'orders, reservations and the kitchen', lodging: 'bookings, check-ins and housekeeping',
  retail: 'stock, sales and suppliers', logistics: 'deliveries, routes and drivers',
  'field-service': 'service calls, technicians and scheduling', health: 'appointments, patients and follow-ups',
  education: 'enrollment, attendance and communication with families', 'real-estate': 'tenants, maintenance and payments',
  nonprofit: 'donors, volunteers and programs', professional: 'clients, proposals and billable work',
  construction: 'estimates, crews and materials', manufacturing: 'production, materials and quality',
  agriculture: 'crops, harvests and buyers', events: 'bookings, attendees and vendors',
  tourism: 'bookings, guides and daily schedules', finance: 'clients, payments and collections',
  transport: 'rides, drivers and payments', public: 'requests, permits and citizens',
}

// When the visitor names only people (or nothing), the thing being processed
// defaults to the domain's central unit of work.
const DOMAIN_SUBJECT = {
  hospitality: 'order', lodging: 'booking', retail: 'stock', logistics: 'delivery',
  'field-service': 'service call', health: 'appointment', education: 'enrollment',
  'real-estate': 'request', nonprofit: 'donation', professional: 'client work',
  construction: 'job', manufacturing: 'production', agriculture: 'harvest',
  events: 'booking', tourism: 'booking', finance: 'payment', transport: 'ride', public: 'request',
}

/**
 * @typedef {Object} Understanding
 * @property {string|null} subject        plural work noun(s): "orders", "bookings and guests"
 * @property {string|null} subjectOne     singular: "order"
 * @property {boolean} subjectPlural      whether `subject` takes a plural verb
 * @property {boolean} subjectGeneric     true when we fell back to "the work"
 * @property {string|null} who            second person: "your restaurant", "your team", "you"
 * @property {string|null} whoNoun        bare noun: "restaurant"
 * @property {string|null} artifact       "an app"
 * @property {string|null} actors         "customers", "your technicians"
 * @property {string|null} actorsId
 * @property {string|null} painClause     agreement-correct: "arrive through messages…"
 * @property {string|null} currentId      messages | spreadsheet | tool | nothing
 * @property {string|null} purpose        the visitor's own purpose clause (second person, no leading "so that"/"to")
 * @property {'result'|'capability'|null} purposeKind
 * @property {string|null} domainId
 * @property {string|null} domainOps      "orders, reservations and the kitchen"
 * @property {boolean} solutionFirst
 */

function normalizePurpose(raw, organization) {
  if (!raw) return { purpose: null, purposeKind: null }
  let p = stripTerminal(raw).trim()
  let kind = 'capability'
  const result = /^(so that|so we|so i|so they|so our|so customers|so clients|so staff|where|allowing|that lets|that let|that allows|that allow)\b\s*/i
  const capability = /^(to help|to let|to allow|to give|to make sure|to stop|to avoid|to reduce|to keep|to see|to know|to track|in order to|to)\b\s*/i
  const m = result.exec(p)
  if (m) {
    kind = 'result'
    const lead = m[1].toLowerCase()
    if (/^so (we|i|they|our|customers|clients|staff)$/.test(lead)) p = p.slice(3) // keep the subject
    else if (lead === 'that lets' || lead === 'that let' || lead === 'that allows' || lead === 'that allow' || lead === 'allowing') p = p.slice(m[0].length)
    else p = p.slice(m[0].length)
  } else {
    const c = capability.exec(p)
    if (c) {
      const lead = c[1].toLowerCase()
      if (/^to (help|let|allow|give)$/.test(lead)) {
        p = p.slice(c[0].length)
        // drop the organization object: "help my dad's store know…" -> "know…"
        if (organization) {
          const org = organization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          p = p.replace(new RegExp(`^${org}\\s+`, 'i'), '')
        }
        p = p.replace(/^(us|me|them|our team|the team|customers|clients|staff)\s+/i, '')
      } else if (lead === 'in order to' || lead === 'to') {
        p = p.slice(c[0].length)
      } else {
        p = p.slice(3) // keep the verb: "to see…" -> "see…"
      }
    }
  }
  p = toSecondPerson(p)
  p = p.replace(/\b(we|us)\b/gi, 'you').replace(/\bi\b/g, 'you').replace(/\byour team\b/gi, 'your team')
  p = p.replace(/^your\s+/i, m => m) // no-op, keeps intent explicit
  p = p.trim()
  if (!p || p.split(' ').length < 2) return { purpose: null, purposeKind: null }
  return { purpose: trimTo(lower(p), 100), purposeKind: kind }
}

/**
 * @param {import('../qualification/analyze.js').Features} f
 * @returns {Understanding}
 */
export function deriveUnderstanding(f) {
  const ops = [...new Set(f.operations)]
  const ranked = ops
    .map(o => ({ o, i: OPS_PRIORITY.indexOf(o) }))
    .map(x => ({ ...x, i: x.i === -1 ? 999 : x.i }))
    .sort((a, b) => a.i - b.i)
  const strongThings = ranked.filter(x => !PEOPLE_OPS.has(x.o) && !WEAK_OPS.has(x.o)).map(x => x.o)
  const weakThings = ranked.filter(x => !PEOPLE_OPS.has(x.o) && WEAK_OPS.has(x.o)).map(x => x.o)
  const people = ranked.filter(x => PEOPLE_OPS.has(x.o)).map(x => x.o)

  let things = strongThings
  let subjectInferred = false
  if (!things.length && f.domain && DOMAIN_SUBJECT[f.domain.id]) {
    things = [DOMAIN_SUBJECT[f.domain.id]]
    subjectInferred = true
  }
  if (!things.length) things = weakThings

  let subjectGeneric = false
  let subjectOne
  let subjectWords
  if (things.length) {
    subjectOne = things[0]
    subjectWords = things.slice(0, 2).map(t => (isUncountable(t) || t === 'client work' ? t : plural(t)))
  } else if (people.length) {
    subjectOne = people[0]
    subjectWords = [plural(people[0])]
  } else {
    subjectGeneric = true
    subjectOne = 'the work'
    subjectWords = ['the work']
  }
  const subject = joinNatural(subjectWords)
  const subjectPlural = !subjectGeneric && (subjectWords.length > 1 || (!isUncountable(subjectOne) && subjectOne !== 'client work'))

  let who = null
  let whoNoun = null
  if (f.organization) {
    who = toSecondPerson(f.organization)
    whoNoun = who.replace(/^your\s+/, '')
  } else if (f.domain) {
    who = `your ${f.domain.noun}`
    whoNoun = f.domain.noun
  }

  const artifactWord = f.artifacts.find(a => !['spreadsheet', 'form', 'reports', 'reporting', 'notification', 'alerts', 'reminders', 'calendar', 'system'].includes(a)) || f.artifacts[0] || null
  const artifact = artifactWord ? (/^[aeiou]/.test(artifactWord) ? `an ${artifactWord}` : `a ${artifactWord}`) : null

  const actorIds = f.actors.filter(a => a !== 'managers')
  let actorsId = actorIds[0] || null
  let actors = actorsId ? ACTOR_LABEL[actorsId] : null
  if (!actors && f.domain) {
    actors = f.domain.actors
    actorsId = `domain:${f.domain.id}`
  }
  if (!actors && people.length) {
    actors = plural(people[0])
    actorsId = `ops:${people[0]}`
  }

  let painClause = null
  let currentId = null
  const painText = f.pains.join(' | ')
  for (const p of PAIN_DESCRIPTIONS) {
    if (p.test.test(painText)) {
      painClause = p.clauses[subjectPlural ? 0 : 1]
      currentId = p.current
      break
    }
  }

  const { purpose, purposeKind } = normalizePurpose(f.purpose, f.organization)

  return {
    subject,
    subjectOne,
    subjectPlural,
    subjectGeneric,
    subjectInferred,
    who,
    whoNoun,
    artifact,
    actors,
    actorsId,
    painClause,
    currentId,
    purpose,
    purposeKind,
    domainId: f.domain?.id || null,
    domainOps: f.domain ? DOMAIN_OPS[f.domain.id] || null : null,
    solutionFirst: f.solutionFirst,
  }
}

export function subjectOrFallback(u, fallback = 'the work you described') {
  return u.subjectGeneric ? fallback : u.subject
}

export function capSubject(u, fallback = 'The work you described') {
  return u.subjectGeneric ? fallback : cap(u.subject)
}
