import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIMITS, allAnswered, answersByFocus, createContext, withAnswer, withExchanges,
  withQualification, withStatement, withSubmission,
} from '../src/domain/context.js'
import { createProvider } from '../src/domain/discovery/provider.js'
import { REFINEMENTS } from '../src/domain/discovery/statement.js'
import { buildHandoffPayload, HANDOFF_SCHEMA } from '../src/domain/handoff/payload.js'
import { sendToDecisionChannel } from '../src/domain/handoff/transport.js'

const provider = createProvider({ latency: false })

const INPUTS = [
  'I want to build a mobile app for my restaurant so customers can order ahead and skip the line',
  'We lose track of orders that come in over WhatsApp and someone has to retype them into a notebook',
  'I want an app',
  "Something to help my dad's hardware store know what's in stock without walking the aisles",
  'Our clinic double books patients because the front desk uses a paper agenda and two phones',
  "I run a small tour company in Punta Cana and guides keep calling me to ask who is on tomorrow's excursion",
  "We need a way for tenants to report maintenance issues and for us to see what's open",
  'Help our nonprofit track donations and volunteers in one place instead of three spreadsheets',
  'I want to build something like Uber but for boats',
  'automate payroll for 40 employees across two locations, currently done in excel every two weeks',
  'Website for my bakery',
  'A dashboard for our construction crews to log hours and materials from the job site',
  'Our school sends grades home on paper and parents call the office all day asking about attendance',
  'inventory system for a small pharmacy with two branches, we run out of stock without noticing',
  ('Our small clinic has three doctors and the front desk books appointments by phone and writes them in a paper agenda. ').repeat(4),
]

async function runToStatement(text, pickIndex = i => i) {
  let ctx = withSubmission(createContext(), text)
  const q = await provider.qualify(ctx)
  ctx = withQualification(ctx, q)
  const opened = await provider.open(ctx)
  ctx = withExchanges(ctx, opened.exchanges)
  for (let i = 0; i < ctx.exchanges.length; i++) {
    const e = ctx.exchanges[i]
    const pick = e.options[pickIndex(i) % e.options.length]
    const res = await provider.answer(ctx, e.id, { optionId: pick.id, label: pick.label, text: null, value: pick.value })
    ctx = withExchanges(ctx, res.exchanges)
  }
  const composed = await provider.compose(ctx)
  ctx = withStatement(ctx, composed.statement)
  return { ctx, composed, opened }
}

const BAD_GRAMMAR = [
  /\ba (order|appointment|app|idea|issue|employee|estimate|event|inquiry|enrollment)\b/i,
  /\bthe work you described arrive\b/,
  /\bstock (live|move|arrive|are)\b/,
  /\bpayroll (live|move|arrive|are)\b/,
  /\bso that to\b/,
  /\bevery stock\b/,
  /\bReliable the work\b/,
  /\bSelf-service the work\b/,
  /\s,|,,|\.\./,
]

for (const text of INPUTS) {
  test(`discovery fits its limits and reads well: "${text.slice(0, 50)}…"`, async () => {
    const { ctx, composed, opened } = await runToStatement(text)
    assert.ok(opened.exchanges.length >= 2 && opened.exchanges.length <= 4, `plan size ${opened.exchanges.length}`)
    assert.equal(opened.exchanges[opened.exchanges.length - 1].focus, 'success', 'success is always last')
    for (const e of ctx.exchanges) {
      assert.ok(e.reflection.length > 0 && e.reflection.length <= 150, `reflection ${e.reflection.length}: ${e.reflection}`)
      assert.ok(e.question.length > 0 && e.question.length <= 90, `question ${e.question.length}`)
      assert.ok(e.options.length >= 2 && e.options.length <= 4, `options ${e.options.length}`)
      for (const o of e.options) {
        assert.ok(o.label.length <= 46, `option ${o.label.length}: ${o.label}`)
        for (const re of BAD_GRAMMAR) assert.doesNotMatch(o.label, re, `option grammar: ${o.label}`)
      }
      for (const re of BAD_GRAMMAR) assert.doesNotMatch(e.reflection, re, `reflection grammar: ${e.reflection}`)
      assert.doesNotMatch(e.reflection, /great|awesome|love|exciting|amazing/i, 'no generic praise')
    }
    assert.ok(allAnswered(ctx))
    const s = composed.statement
    assert.ok(s.text.length <= LIMITS.statement, `statement ${s.text.length}`)
    assert.ok(s.text.length >= 80, `statement too short: ${s.text}`)
    assert.ok(s.title.length > 0 && s.title.length <= 48)
    for (const re of BAD_GRAMMAR) assert.doesNotMatch(s.text, re, `statement grammar: ${s.text}`)
    for (const re of BAD_GRAMMAR) assert.doesNotMatch(s.title, re, `title grammar: ${s.title}`)
    // Not a paraphrase: the statement must not contain the first 40 chars of the input verbatim.
    assert.ok(!s.text.toLowerCase().includes(text.slice(0, 40).toLowerCase()), 'statement paraphrases the input')
    // Charter discipline: names a test of success.
    assert.match(s.text, /worked when|Success means|measure of success/)
    for (const r of REFINEMENTS) {
      const refined = await provider.refine(ctx, r.variant)
      assert.ok(refined.statement.text.length <= LIMITS.statement, `${r.id} ${refined.statement.text.length}`)
      for (const re of BAD_GRAMMAR) assert.doesNotMatch(refined.statement.text, re, `${r.id} grammar: ${refined.statement.text}`)
    }
  })
}

test('objective options adapt to the submission', async () => {
  let ctx = withSubmission(createContext(), 'We lose track of orders that come in over WhatsApp and someone has to retype them into a notebook')
  ctx = withQualification(ctx, await provider.qualify(ctx))
  const { exchanges } = await provider.open(ctx)
  const objective = exchanges.find(e => e.focus === 'objective')
  assert.equal(objective.options[0].id, 'missed')
  assert.equal(objective.options[1].id, 'time')
  assert.match(objective.reflection, /^Orders arrive through messages/)
})

test('own words are honored in reflections and the statement', async () => {
  let ctx = withSubmission(createContext(), 'I want an app')
  ctx = withQualification(ctx, await provider.qualify(ctx))
  let { exchanges } = await provider.open(ctx)
  ctx = withExchanges(ctx, exchanges)
  const objective = ctx.exchanges[0]
  const res = await provider.answer(ctx, objective.id, { optionId: null, label: 'Stop losing deposits from wedding clients', text: 'Stop losing deposits from wedding clients', value: null })
  ctx = withExchanges(ctx, res.exchanges)
  assert.match(ctx.exchanges[1].reflection, /In your words, the result is: stop losing deposits from wedding clients/)
  for (const e of ctx.exchanges.slice(1)) {
    const pick = e.options[0]
    const r = await provider.answer(ctx, e.id, { optionId: pick.id, label: pick.label, text: null, value: pick.value })
    ctx = withExchanges(ctx, r.exchanges)
  }
  const { statement } = await provider.compose(ctx)
  assert.match(statement.text, /stop losing deposits from wedding clients/)
})

test('revising an earlier answer regenerates downstream options and keeps valid later answers', async () => {
  const { ctx } = await runToStatement('I want an app')
  const objective = ctx.exchanges.find(e => e.focus === 'objective')
  const success = ctx.exchanges.find(e => e.focus === 'success')
  const before = success.options.map(o => o.label).join('|')
  const alt = objective.options.find(o => o.id !== objective.answer.optionId)
  const res = await provider.answer(ctx, objective.id, { optionId: alt.id, label: alt.label, text: null, value: alt.value })
  const after = res.exchanges.find(e => e.focus === 'success')
  assert.notEqual(after.options.map(o => o.label).join('|'), before, 'success options should follow the objective')
  // The old success answer (s1) still exists as an id, so it is kept but relabeled.
  assert.ok(after.answer)
  assert.equal(after.answer.label, after.options.find(o => o.id === after.answer.optionId).label)
  const people = res.exchanges.find(e => e.focus === 'people')
  assert.ok(people.answer, 'unrelated answers survive')
})

test('handoff payload is versioned, complete and clearly a prototype', async () => {
  const { ctx, composed } = await runToStatement("We need a way for tenants to report maintenance issues and for us to see what's open")
  const payload = buildHandoffPayload(ctx, { parts: composed.parts })
  assert.equal(payload.schema, HANDOFF_SCHEMA)
  assert.equal(payload.prototype, true)
  assert.equal(payload.project.statement, ctx.statement.text)
  assert.equal(payload.discovery.originalInput, ctx.submission.text)
  assert.equal(payload.discovery.answers.length, ctx.exchanges.length)
  assert.equal(payload.project.parts.capability, composed.parts.capability)
  assert.equal(payload.qualification.tier, 4)
  const receipt = await sendToDecisionChannel(payload, { latency: false })
  assert.equal(receipt.status, 'simulated')
  assert.match(receipt.receiptId, /^DC-SIM-/)
  assert.match(receipt.note, /not transmitted/)
})

test('context helpers', () => {
  let ctx = withSubmission(createContext(), '  hello  ')
  assert.equal(ctx.submission.text, 'hello')
  ctx = withExchanges(ctx, [{ id: 'a', focus: 'objective', reflection: '', question: '', options: [], answer: null }])
  ctx = withAnswer(ctx, 'a', { optionId: 'x', label: 'X', text: null })
  assert.deepEqual(Object.keys(answersByFocus(ctx)), ['objective'])
  ctx = withStatement(ctx, { text: 'one', title: 't' })
  ctx = withStatement(ctx, { text: 'two', title: 't', source: 'edited' }, 'visitor edit')
  assert.equal(ctx.statement.version, 2)
  assert.equal(ctx.statementHistory.length, 2)
  assert.equal(ctx.statementHistory[1].source, 'edited')
})

test('the remote provider is explicitly unavailable in the prototype', () => {
  assert.throws(() => createProvider({ mode: 'remote' }), /not available/)
})
