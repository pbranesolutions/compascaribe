// Decision Channel handoff payload.
//
// A versioned, self-describing record of what public discovery produced. This
// is the contract between the public site and Decision Channel. It carries the
// original input, every refinement, the resulting statement, and the structured
// understanding behind it, so Decision Channel starts from the same facts the
// visitor already confirmed.

export const HANDOFF_SCHEMA = 'compascaribe.handoff/1'

/**
 * @param {import('../context.js').ProjectContext} ctx
 * @param {{parts?: Object}} [extras]
 */
export function buildHandoffPayload(ctx, extras = {}) {
  const answers = ctx.exchanges
    .filter(e => e.answer)
    .map(e => ({
      focus: e.focus,
      question: e.question,
      answer: e.answer.text || e.answer.label,
      chosenOption: e.answer.optionId,
      ownWords: Boolean(e.answer.text),
    }))

  return {
    schema: HANDOFF_SCHEMA,
    source: 'compascaribe.com/public-discovery',
    prototype: true,
    createdAt: new Date().toISOString(),
    session: { id: ctx.id, startedAt: ctx.createdAt },
    project: {
      title: ctx.statement?.title || null,
      statement: ctx.statement?.text || null,
      statementVersion: ctx.statement?.version || 0,
      parts: extras.parts
        ? {
            who: extras.parts.who,
            capability: extras.parts.capability,
            outcome: extras.parts.outcome,
            baseline: extras.parts.current,
            success: extras.parts.success,
          }
        : null,
    },
    discovery: {
      originalInput: ctx.submission?.text || null,
      clarifications: ctx.clarifications.map(c => c.text),
      answers,
      statementHistory: ctx.statementHistory.map(s => ({ version: s.version, source: s.source, reason: s.reason, text: s.text })),
    },
    qualification: ctx.qualification ? { tier: ctx.qualification.tier, label: ctx.qualification.label } : null,
  }
}

/** Compact human-readable rendering, one line per field, for the review screen. */
export function summarizePayload(payload) {
  const lines = []
  lines.push(['Project', payload.project.title || '—'])
  lines.push(['Statement', payload.project.statement || '—'])
  lines.push(['Original input', payload.discovery.originalInput || '—'])
  for (const a of payload.discovery.answers) lines.push([a.focus, a.answer])
  lines.push(['Statement versions', String(payload.discovery.statementHistory.length)])
  return lines
}
