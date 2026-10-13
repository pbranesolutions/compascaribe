// Visitor-facing vocabulary shared by the engine and the UI. Pure data, no
// engine imports, so the presentation layer never pulls the simulated engine
// into its module graph.

export const FOCUS_TITLES = Object.freeze({
  objective: 'Objective',
  people: 'People',
  current: 'Today',
  scope: 'Scope',
  success: 'Success',
})

export const REFINEMENTS = Object.freeze([
  { id: 'plain', label: 'Say it more plainly', variant: 'plain' },
  { id: 'narrow', label: 'Narrow it to the first step', variant: 'narrow' },
  { id: 'broad', label: 'Make it about the whole operation', variant: 'broad' },
  { id: 'charter', label: 'Back to the charter form', variant: 'charter' },
])

export const OVERLAY_TITLES = Object.freeze({
  review: 'Understanding so far',
  words: 'Your words',
  drafts: 'Statement drafts',
  notes: 'Prototype notes',
  record: 'Handoff record',
})
