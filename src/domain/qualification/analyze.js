// Feature extraction over a visitor's submission.
//
// Shared by the simulated qualifier and the simulated discovery provider so
// both reason about the same facts. Pure and synchronous.

import {
  ACTORS, ARTIFACTS, BUILD_VERBS, DOMAINS, GREETING_WORDS, INJECTION_PATTERNS,
  JOB_SEEKING_PATTERNS, OFF_TOPIC_PATTERNS, OPERATIONS, OPERATION_PHRASE, ORG_CUT_WORDS,
  ORG_NOUNS, OUTCOMES, PAINS, PURPOSE_CLAUSE, SCALE, SOLUTION_LEADS, STOPWORDS,
  SUPPORT_PATTERNS, VENDOR_PITCH_PATTERNS, VENDOR_PITCH_WEAK_PATTERNS,
} from './lexicon.js'

/**
 * @typedef {Object} Features
 * @property {string} raw
 * @property {string} normalized
 * @property {string[]} tokens
 * @property {number} wordCount
 * @property {boolean} gibberish
 * @property {boolean} tooShort
 * @property {string[]} build
 * @property {string[]} artifacts
 * @property {string[]} operations
 * @property {string[]} pains
 * @property {string[]} outcomes
 * @property {string[]} scale
 * @property {{id:string,noun:string,plural:string,actors:string}|null} domain
 * @property {string[]} actors
 * @property {string|null} organization   e.g. "my small catering business"
 * @property {string|null} purpose        e.g. "customers can order ahead"
 * @property {string[]} keywords          content words, most frequent first
 * @property {boolean} solutionFirst      names an artifact but no problem/outcome
 * @property {boolean} substance        any concrete subject matter detected
 * @property {{offTopic:boolean,jobSeeking:boolean,vendorPitch:boolean,vendorPitchWeak:boolean,support:boolean,injection:boolean,greeting:boolean}} negatives
 */

const SUFFIX = '(?:s|es|ed|ing|ies)?'

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseRegex(phrase) {
  const parts = phrase.trim().split(/\s+/).map(escapeRe)
  const last = parts.pop()
  const body = parts.length ? parts.join('\\s+') + '\\s+' : ''
  return new RegExp(`(?<![a-z])${body}${last}${SUFFIX}(?![a-z])`, 'i')
}

const compiled = new Map()
function matchList(text, list) {
  const found = []
  for (const phrase of list) {
    let re = compiled.get(phrase)
    if (!re) {
      re = phraseRegex(phrase)
      compiled.set(phrase, re)
    }
    if (re.test(text)) found.push(phrase)
  }
  return found
}

/** Collapse pasted duplicates: repeated sentences count once. */
export function dedupeSentences(text) {
  const parts = String(text || '').split(/(?<=[.!?])\s+/)
  const seen = new Set()
  const out = []
  for (const p of parts) {
    const key = p.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out.join(' ')
}

export function normalize(text) {
  return dedupeSentences(String(text || ''))
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-\sÀ-ɏ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectGibberish(normalized, tokens) {
  if (!normalized) return true
  const letters = normalized.replace(/[^a-zÀ-ɏ]/g, '')
  const alphaRatio = letters.length / Math.max(1, normalized.replace(/\s/g, '').length)
  if (alphaRatio < 0.5) return true
  const vowels = (letters.match(/[aeiouà-ü]/g) || []).length
  if (letters.length >= 6 && vowels / letters.length < 0.2) return true
  if (/(.)\1{4,}/.test(normalized)) return true
  if (tokens.length >= 6) {
    const unique = new Set(tokens).size / tokens.length
    if (unique < 0.3) return true
  }
  const wordLike = tokens.filter(t => /^[a-zÀ-ɏ'-]{1,20}$/.test(t) && (/[aeiouyà-ü]/.test(t) || t.length <= 2)).length
  if (tokens.length >= 2 && wordLike / tokens.length < 0.5) return true
  // Keyboard mashing: tokens with long consonant runs or no vowels at all.
  const mashed = tokens.filter(t =>
    /[bcdfghjklmnpqrstvwxz]{5,}/.test(t) || (t.length >= 5 && !/[aeiouyà-ü]/.test(t)),
  ).length
  if (mashed >= 2 || (tokens.length <= 3 && mashed >= 1 && mashed >= tokens.length / 2)) return true
  return false
}

function detectDomain(normalized) {
  let best = null
  let bestScore = 0
  for (const d of DOMAINS) {
    const hits = matchList(normalized, d.words).length
    if (hits > bestScore) {
      bestScore = hits
      best = d
    }
  }
  return best ? { id: best.id, noun: best.noun, plural: best.plural, actors: best.actors } : null
}

function detectActors(normalized) {
  const found = []
  for (const a of ACTORS) {
    if (matchList(normalized, a.words).length) found.push(a.id)
  }
  return found
}

function keywords(tokens) {
  const counts = new Map()
  for (const t of tokens) {
    const w = t.replace(/^'+|'+$/g, '')
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue
    counts.set(w, (counts.get(w) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 12)
}

function captureOperation(raw) {
  const re = new RegExp(OPERATION_PHRASE.source, 'gi')
  let m
  while ((m = re.exec(raw))) {
    const determiner = m[2]
    const adjective = m[3] || ''
    const words = m[4].split(/\s+/)
    const kept = []
    for (const w of words) {
      if (ORG_CUT_WORDS.has(w.toLowerCase())) break
      kept.push(w)
    }
    if (!kept.length) continue
    const hasOrgNoun = kept.some(w => ORG_NOUNS.includes(w.toLowerCase().replace(/'s$/, '')))
    if (!hasOrgNoun) continue
    return `${determiner} ${adjective}${kept.join(' ')}`.replace(/\s+/g, ' ').trim()
  }
  return null
}

function capturePurpose(raw) {
  const m = PURPOSE_CLAUSE.exec(raw)
  if (!m) return null
  let clause = (m[1] + m[2]).trim()
  clause = clause.replace(/\s+(and|but|because|which|so)\s*$/i, '').trim()
  if (clause.length > 110) clause = clause.slice(0, 107).replace(/\s+\S*$/, '') + '…'
  return clause.length >= 10 ? clause : null
}

/**
 * @param {string} raw
 * @returns {Features}
 */
export function analyze(raw) {
  const normalized = normalize(raw)
  const tokens = normalized ? normalized.split(' ') : []
  const wordCount = tokens.length
  const gibberish = detectGibberish(normalized, tokens)

  const build = matchList(normalized, BUILD_VERBS)
  const artifacts = matchList(normalized, ARTIFACTS)
  const operations = matchList(normalized, OPERATIONS)
  const pains = matchList(normalized, PAINS)
  const outcomes = matchList(normalized, OUTCOMES)
  const scale = matchList(normalized, SCALE)
  const domain = detectDomain(normalized)
  const actors = detectActors(normalized)

  const negatives = {
    offTopic: OFF_TOPIC_PATTERNS.some(re => re.test(raw)),
    jobSeeking: JOB_SEEKING_PATTERNS.some(re => re.test(raw)),
    vendorPitch: VENDOR_PITCH_PATTERNS.some(re => re.test(raw)),
    vendorPitchWeak: VENDOR_PITCH_WEAK_PATTERNS.some(re => re.test(raw)),
    support: SUPPORT_PATTERNS.some(re => re.test(raw)),
    injection: INJECTION_PATTERNS.some(re => re.test(raw)),
    greeting: wordCount <= 3 && tokens.every(t => GREETING_WORDS.includes(t)),
  }

  const solutionFirst = artifacts.length > 0 && SOLUTION_LEADS.some(re => re.test(raw)) && pains.length === 0 && outcomes.length === 0
  const tooShort = wordCount < 3 || normalized.length < 12
  const organization = captureOperation(String(raw || ''))
  const purpose = capturePurpose(String(raw || ''))
  const substance = Boolean(artifacts.length || operations.length || pains.length || outcomes.length || domain || organization || purpose)

  return {
    raw: String(raw || ''),
    normalized,
    tokens,
    wordCount,
    gibberish,
    tooShort,
    build,
    artifacts,
    operations,
    pains,
    outcomes,
    scale,
    domain,
    actors,
    organization,
    purpose,
    keywords: keywords(tokens),
    solutionFirst,
    substance,
    negatives,
  }
}
