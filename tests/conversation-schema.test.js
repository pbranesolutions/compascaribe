import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeObjectives, OPENING_OBJECTIVES, OPENING_SCHEMA, validateOpening } from '../src/domain/conversation/schema.js'
import { GOOD } from './conversation-support.js'

const check = (patch) => validateOpening({ ...GOOD, ...patch })
const reason = (patch) => { const r = check(patch); return r.ok ? 'ok' : r.reason }

test('a well-formed opening passes and is returned tidied', () => {
  const r = check({ reflection: '  Orders arrive over WhatsApp   and get retyped \n into a notebook.  ' })
  assert.equal(r.ok, true)
  assert.equal(r.opening.reflection, 'Orders arrive over WhatsApp and get retyped into a notebook.')
  assert.equal(r.opening.question, GOOD.question)
  assert.deepEqual(Object.keys(r.opening), ['describes', 'objectives', 'uncertainty', 'explores', 'reflection', 'question'])
  assert.deepEqual(r.opening.objectives, GOOD.objectives)
})

test('both parts are required: a missing or empty reflection or question is refused', () => {
  assert.equal(validateOpening(null).reason, 'shape')
  assert.equal(validateOpening([]).reason, 'shape')
  assert.equal(validateOpening({ describes: 'problem', uncertainty: 'x', question: GOOD.question }).reason, 'shape')
  assert.equal(validateOpening({ describes: 'problem', uncertainty: 'x', reflection: GOOD.reflection }).reason, 'shape')
  assert.equal(reason({ reflection: '' }), 'reflection_missing')
  assert.equal(reason({ reflection: 'Orders.' }), 'reflection_missing')
  assert.equal(reason({ question: '' }), 'question_missing')
  assert.equal(reason({ question: 'Why?' }), 'question_missing')
  assert.equal(reason({ describes: 'wish' }), 'describes')
  assert.equal(reason({ explores: 'budget' }), 'explores')
  assert.equal(validateOpening({ ...GOOD, explores: undefined }).reason, 'shape')
  assert.equal(reason({ reflection: 42 }), 'shape')
})

test('exactly one question, and it is the question part', () => {
  assert.equal(reason({ question: 'Who uses it day to day, and for what?' }), 'ok')
  assert.equal(reason({ question: 'Who uses it? And how often do they need it?' }), 'two_questions')
  assert.equal(reason({ question: 'Tell me who uses it. What would change for them?' }), 'two_questions')
  assert.equal(reason({ question: 'What would change for the people who use it each day' }), 'question_form')
  assert.equal(reason({ question: 'Tell me what would change for the people who use it.' }), 'question_form')
  assert.equal(reason({ reflection: 'Orders get lost in the notebook. What would change if they did not?' }), 'reflection_is_question')
  assert.equal(reason({ question: 'What would change for the doctors and the receptionists once the agenda is shared?' }), 'ok')
  // Abbreviations and decimals are not sentence breaks.
  assert.equal(reason({ question: 'What would it mean for staff, e.g. the two receptionists, to save 2.5 hours a day?' }), 'ok')
})

test('a second question tacked on with "and" is dropped when what precedes it is a complete question, otherwise refused', () => {
  const kept = patch => { const r = check(patch); return r.ok ? [r.opening.question, r.repaired] : [r.reason, null] }
  assert.deepEqual(kept({ question: 'If you could fix only one thing next month, which would matter most, and what would be different once it was fixed?' }),
    ['If you could fix only one thing next month, which would matter most?', 'compound_question'])
  assert.deepEqual(kept({ question: 'Who decides what gets booked and how do they decide?' }), ['Who decides what gets booked?', 'compound_question'])
  assert.deepEqual(kept({ question: '¿Quién lo usa hoy y cómo cambiaría su día?' }), ['¿Quién lo usa hoy?', 'compound_question'])
  // A clause that merely continues the sentence is not a second question, and nothing is cut.
  assert.deepEqual(kept({ question: 'What is a recent moment when you wanted to see something and could not?' }), ['What is a recent moment when you wanted to see something and could not?', null])
  assert.deepEqual(kept({ question: 'When a request is sent and did not get an answer, who notices first?' }), ['When a request is sent and did not get an answer, who notices first?', null])
  assert.deepEqual(kept({ question: 'Who sends a request, and who has to approve it?' }), ['Who sends a request?', 'compound_question'])
  // The part that is kept must itself be a question, and a clean one is never touched.
  assert.deepEqual(kept({ question: 'Tell me what prompted it, and what would change for the doctors?' }), ['two_questions', null])
  assert.deepEqual(kept({ question: 'Who uses it, and and how, and what for in the end?' }).slice(1), [null])
  assert.deepEqual(kept({ question: 'What would change for the doctors and the receptionists once the agenda is shared?' }), ['What would change for the doctors and the receptionists once the agenda is shared?', null])
  // Nothing is added: the kept words are a prefix of what the model wrote.
  const wrote = 'When you picture it fixed, what would be different at the front desk, and who would notice first?'
  assert.ok(wrote.startsWith(kept({ question: wrote })[0].slice(0, -1)))
})

test('a sentence of encouragement is dropped from the reflection; a reflection that is nothing else is refused', () => {
  const r = check({ reflection: 'You want things to run better in how your team works. That is a good place to begin.' })
  assert.equal(r.ok, true)
  assert.equal(r.opening.reflection, 'You want things to run better in how your team works.')
  assert.equal(r.repaired, 'encouragement')
  assert.equal(reason({ reflection: 'That is a common challenge for small clinics.' }), 'praise')
  // Both repairs can apply; the record says so.
  const both = check({ reflection: 'Orders arrive over WhatsApp and get retyped by hand. That is a common challenge.', question: 'Who sends a request, and who has to approve it?' })
  assert.equal(both.repaired, 'encouragement+compound_question')
  // Ordinary sentences that share a word are left alone.
  assert.equal(check({ reflection: 'The good news in what you wrote is that the volume is small: about 25 children a week.' }).repaired, null)
})

test('the reply stays short enough for the screen', () => {
  const long = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ')
  assert.equal(reason({ reflection: long }), 'too_long')
  assert.equal(reason({ question: `${Array.from({ length: 50 }, () => 'really').join(' ')}?` }), 'too_long')
  const near = Array.from({ length: 50 }, () => 'word').join(' ')
  assert.equal(reason({ reflection: near, question: `${Array.from({ length: 42 }, () => 'word').join(' ')}?` }), 'too_long', 'together over the cap')
})

test('no greeting, no praise, no exclamation, no markup', () => {
  assert.equal(reason({ reflection: 'Hello! Orders arrive over WhatsApp.' }), 'greeting')
  assert.equal(reason({ reflection: 'Thanks for sharing that. Orders arrive over WhatsApp.' }), 'greeting')
  assert.equal(reason({ reflection: 'Hola, los pedidos llegan por WhatsApp y se pierden.' }), 'greeting')
  assert.equal(reason({ reflection: 'Excellent. Orders arrive over WhatsApp and get lost.' }), 'praise')
  assert.equal(reason({ reflection: "That's a great problem to solve, with orders arriving over WhatsApp." }), 'praise')
  assert.equal(reason({ reflection: 'Qué buena idea: los pedidos llegan por WhatsApp.' }), 'praise')
  assert.equal(reason({ reflection: 'Orders arrive over WhatsApp and get lost!' }), 'exclamation')
  assert.equal(reason({ reflection: '**Orders** arrive over WhatsApp and get lost.' }), 'markup')
  assert.equal(reason({ reflection: '- Orders arrive over WhatsApp and get lost.' }), 'markup')
  // Praise elsewhere in a sentence about the work itself is not an opener.
  assert.equal(reason({ reflection: 'Orders arrive over WhatsApp, and the notebook is where they get lost.' }), 'ok')
})

test('Spanish openings pass the same structure', () => {
  const r = check({
    describes: 'solution',
    reflection: 'Quieres una aplicación para que los clientes reserven sin llamar al local.',
    question: '¿Qué cambiaría en el día a día de tu equipo cuando los clientes reserven solos?',
  })
  assert.equal(r.ok, true)
})

test('the structured-output schema asks for the four fields, in the order the model should settle them', () => {
  assert.deepEqual(Object.keys(OPENING_SCHEMA.properties), ['describes', 'objectives', 'uncertainty', 'explores', 'reflection', 'question'])
  assert.deepEqual(OPENING_SCHEMA.required, ['describes', 'objectives', 'uncertainty', 'explores', 'reflection', 'question'])
  assert.equal(OPENING_SCHEMA.additionalProperties, false)
})

test('the opening records every distinct objective in the description, bounded, and an empty list is a valid reading of a vague one', () => {
  const two = check({ objectives: ['  Residents receive important building communications ', 'Residents reserve shared amenities (tennis court, common areas)', 'residents receive important building communications'] })
  assert.equal(two.ok, true)
  assert.deepEqual(two.opening.objectives, ['Residents receive important building communications', 'Residents reserve shared amenities (tennis court, common areas)'], 'tidied, duplicates dropped')
  assert.deepEqual(check({ objectives: [] }).opening.objectives, [])
  assert.equal(reason({ objectives: 'communications' }), 'objectives')
  assert.equal(reason({ objectives: [1, 2] }), 'objectives')
  assert.equal(validateOpening({ ...GOOD, objectives: undefined }).reason, 'objectives')
  const many = normalizeObjectives(Array.from({ length: 12 }, (_, i) => `objective ${i} ${'x'.repeat(300)}`))
  assert.equal(many.length, OPENING_OBJECTIVES.max)
  assert.equal(many[0].length, OPENING_OBJECTIVES.chars)
  assert.equal(normalizeObjectives(null), null)
})
