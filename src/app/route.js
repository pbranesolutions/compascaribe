// Positions on the route band in the top bar. Pure data; shared by the
// journey and the presentation layer.

export const ROUTE = Object.freeze([
  { id: 'welcome', label: 'Idea', stages: ['welcome', 'declined', 'uncertain'] },
  { id: 'qualifying', label: 'Reading', stages: ['qualifying'] },
  { id: 'discovery', label: 'Discovery', stages: ['discovery', 'composing'] },
  { id: 'statement', label: 'Statement', stages: ['statement', 'refine'] },
  { id: 'continue', label: 'Continue', stages: ['continue'] },
  { id: 'handoff', label: 'Decision Channel', stages: ['handoff', 'done'] },
])
