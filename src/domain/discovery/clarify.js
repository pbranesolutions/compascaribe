// The clarifying question for a plausible but incomplete idea.
//
// Used when qualification says "probably relevant, not yet clear" (tier 2).
// It echoes what the visitor actually wrote and asks the one question that
// moves it forward, instead of showing a generic prompt. Pure and synchronous.

import { analyze } from '../qualification/analyze.js'
import { stripTerminal, trimTo } from './language.js'

const DEFAULT_QUESTION = 'What would it help you do, and for whom?'

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The visitor's own words, quoted, when they are short enough to echo back. */
export function quoteBrief(raw, max = 48) {
  const t = stripTerminal(String(raw || '').replace(/\s+/g, ' ').trim())
  return t && t.length <= max ? `“${t}”` : null
}

/** A term as the visitor typed it ("CRM", not "crm"), or null when it was bridged from another language. */
function typedTerm(raw, term) {
  if (!term) return null
  const m = new RegExp(`(?<![A-Za-z])${escapeRe(term)}(?![A-Za-z])`, 'i').exec(String(raw || ''))
  return m ? m[0] : null
}

/**
 * @param {string} reason  the qualification reason ('unclear', 'no-subject', 'mixed-signals')
 * @param {string} raw     what the visitor wrote
 * @returns {{reflection: string, question: string}}  reflection ≤ 150 chars, question ≤ 90
 */
export function clarifyPrompt(reason, raw) {
  const f = analyze(raw)
  if (reason === 'mixed-signals') {
    return { reflection: 'There may be a project in this, but it reads two ways. One more sentence will settle it.', question: DEFAULT_QUESTION }
  }
  const quote = quoteBrief(raw)
  const hasSignal = Boolean(f.artifacts.length || f.operations.length || f.build.length)
  if (quote && hasSignal) {
    const tool = typedTerm(raw, f.artifacts[0])
    const work = typedTerm(raw, f.operations[0])
    let question = DEFAULT_QUESTION
    if (tool) question = `What should your ${tool} help you do?`
    else if (work) question = `What would you like to change about ${work}?`
    return {
      reflection: `You said ${quote}. One more sentence is enough to begin.`,
      question: trimTo(question, 90),
    }
  }
  return { reflection: 'There may be a project in this, but we cannot yet tell what it would be.', question: DEFAULT_QUESTION }
}
