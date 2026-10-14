// Inexpensive deterministic validation that runs before Jev is called, on the
// server (authoritative) and in the journey (so the visitor gets an inline
// message without a round trip). It never judges meaning: brevity is allowed.

/**
 * @param {unknown} value
 * @param {{ maxChars: number }} limits
 * @returns {{ ok: true, text: string } | { ok: false, reason: 'not_text' | 'empty' | 'too_long' }}
 */
export function validateSubmission(value, { maxChars }) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_text' }
  if (!value.trim()) return { ok: false, reason: 'empty' }
  if (value.length > maxChars) return { ok: false, reason: 'too_long' }
  // The text is passed on exactly as written; only the checks above look at it.
  return { ok: true, text: value }
}
