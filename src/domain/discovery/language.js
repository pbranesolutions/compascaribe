// Small phrasing helpers shared by the simulated discovery engine.

const IRREGULAR_PLURAL = {
  staff: 'staff', inventory: 'inventory', stock: 'stock', payroll: 'payroll',
  maintenance: 'maintenance', billing: 'billing', invoicing: 'invoicing',
  scheduling: 'scheduling', tracking: 'tracking', attendance: 'attendance',
  enrollment: 'enrollment', compliance: 'compliance', onboarding: 'onboarding',
  training: 'training', data: 'data', hours: 'hours', sales: 'sales', equipment: 'equipment',
  production: 'production', supply: 'supplies', property: 'properties', inquiry: 'inquiries',
  enquiry: 'enquiries', delivery: 'deliveries', batch: 'batches', class: 'classes',
  'check in': 'check-ins', 'check-in': 'check-ins', 'work order': 'work orders',
  'purchase order': 'purchase orders', menu: 'menus', catalog: 'catalog', catalogue: 'catalogue',
  loyalty: 'loyalty', review: 'reviews', campaign: 'campaigns', queue: 'queues', waitlist: 'waitlist',
  harvest: 'harvests', crop: 'crops', livestock: 'livestock', fleet: 'fleet', case: 'cases',
}

const UNCOUNTABLE = new Set(['staff', 'inventory', 'stock', 'payroll', 'maintenance', 'billing', 'invoicing', 'scheduling', 'tracking', 'attendance', 'enrollment', 'compliance', 'onboarding', 'training', 'data', 'equipment', 'production', 'loyalty', 'catalog', 'catalogue', 'livestock', 'fleet', 'waitlist', 'sales', 'hours'])

export function plural(word) {
  const w = String(word).toLowerCase()
  if (IRREGULAR_PLURAL[w]) return IRREGULAR_PLURAL[w]
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es'
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies'
  return w + 's'
}

export function isUncountable(word) {
  return UNCOUNTABLE.has(String(word).toLowerCase())
}

export function cap(s) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function lower(s) {
  if (!s) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/** "my restaurant" -> "your restaurant"; "our clinic" -> "your clinic"; "a small tour company" -> "your small tour company" */
export function toSecondPerson(phrase) {
  if (!phrase) return null
  let p = phrase.trim()
  p = p.replace(/^(my|our)\s+/i, 'your ')
  p = p.replace(/^(a|an|the)\s+/i, 'your ')
  p = p.replace(/\bmy\b/gi, 'your').replace(/\bour\b/gi, 'your')
  return p
}

/** Two items -> "a and b"; three -> "a, b and c". */
export function joinNatural(items) {
  const xs = items.filter(Boolean)
  if (xs.length <= 1) return xs[0] || ''
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

export function trimTo(text, max) {
  if (!text || text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '') + '…'
}

export function sentence(text) {
  if (!text) return text
  const t = cap(text.trim())
  return /[.!?…]$/.test(t) ? t : t + '.'
}

export function stripTerminal(text) {
  return String(text || '').trim().replace(/[.!?]+$/, '')
}

/** First person → second person inside a clause the visitor wrote. */
export function toYou(text) {
  return String(text || '')
    .replace(/\bI am\b/g, 'you are').replace(/\bI'm\b/g, "you're").replace(/\bI was\b/g, 'you were')
    .replace(/\bI\b/g, 'you').replace(/\bwe are\b/gi, 'you are').replace(/\bwe\b/gi, 'you')
    .replace(/\b(my|our)\b/gi, 'your').replace(/\b(me|us)\b/gi, 'you').replace(/\b(myself|ourselves)\b/gi, 'yourself')
    .replace(/\bmine\b/gi, 'yours').replace(/\bam\b/g, 'are')
}

const VERB_START = /^(stop|make|get|see|know|let|have|track|keep|reduce|avoid|cut|save|give|send|show|find|handle|manage|book|schedule|sell|reach|grow|hire|pay|bill|collect|answer|respond|confirm|remind|notify|automate|replace|turn|bring|run|open|close|deliver|ship|print|record|capture|store|share|sync|update|remove|eliminate|prevent|win|offer|provide|improve|speed|free|simplify|organize|organise|plan|assign|dispatch|accept|approve|review|control|measure|report|publish|launch|build|create|design|help|allow|enable|ensure|guarantee|take|put|move|stay|be|become|spend|lose|never|always|serve|follow|catch|fill|generate|coordinate|centralize|centralise|digitize|digitise|connect|integrate|communicate|receive|process|register|monitor|check|verify|secure|protect|cover|charge|invoice|quote|order|count|forecast|predict|match|rank|sort|filter|search|locate|map|route|guide|train|teach|onboard|retain|convert|attract|understand|decide|prioritize|prioritise)\b/i

/** Does the visitor's text read as a verb phrase ("stop losing orders") rather than a clause ("orders get lost")? */
export function isVerbPhrase(text) {
  const t = stripTerminal(text).replace(/^(to|we need to|i need to|we want to|i want to|we should|i should|be able to)\s+/i, '')
  return VERB_START.test(t)
}

/** Lowercase a visitor's own words for embedding mid-sentence, keeping proper nouns we cannot detect. */
export function embed(text) {
  const t = stripTerminal(text)
  return t.length ? lower(t) : t
}

export function wordsOf(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean)
}
