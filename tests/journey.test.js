import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASK_MORE, createJourney } from '../src/app/journey.js'
import { createProvider } from '../src/domain/discovery/provider.js'
import { CONTEXT_VERSION } from '../src/domain/context.js'

function memoryStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), map: m }
}

function fakeHistory() {
  const entries = [{}]
  return { entries, pushState: s => entries.push(s), replaceState: s => { entries[entries.length - 1] = s } }
}

const provider = () => createProvider({ latency: false })

async function toDiscovery(j, text = 'We lose track of orders that come in over WhatsApp and someone has to retype them into a notebook') {
  j.actions.setDraft('welcome', text)
  await j.actions.submit()
  assert.equal(j.state.stage, 'discovery')
  return j
}

async function toStatement(j) {
  await toDiscovery(j)
  while (j.state.stage === 'discovery') {
    const ex = j.state.ctx.exchanges[j.state.stepIndex]
    j.actions.select(ex.options[0].id)
    await j.actions.commitAnswer()
  }
  assert.equal(j.state.stage, 'statement')
  return j
}

test('only empty or whitespace-only input is rejected inline; brevity is not', async () => {
  const j = createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null })
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.error.message, "Tell us a little more about what you'd like to change or accomplish.")
  assert.equal(j.state.error.message, ASK_MORE)
  j.actions.setDraft('welcome', '   \n \t ')
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.error.message, ASK_MORE)
  // Typing clears the message; two words that name real work go straight to discovery.
  j.actions.setDraft('welcome', 'Automate invoicing')
  assert.equal(j.state.error, null)
  await j.actions.submit()
  assert.equal(j.state.stage, 'discovery')
  assert.match(j.state.ctx.exchanges[0].reflection, /Automate invoicing/)
  assert.match(j.state.ctx.exchanges[0].question, /invoices/)
})

test('a short or vague idea with plausible intent gets one clarifying question, then discovery', async () => {
  const j = createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null })
  j.actions.setDraft('welcome', 'A website')
  await j.actions.submit()
  assert.equal(j.state.stage, 'uncertain')
  assert.equal(j.state.ctx.exchanges.length, 0, 'no discovery content is generated before the idea is clear')
  j.actions.setDraft('clarify', 'for my bakery so customers can order cakes ahead instead of calling')
  await j.actions.clarify()
  assert.equal(j.state.stage, 'discovery')
  // An empty clarification uses the same plain message.
  const k = createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null })
  k.actions.setDraft('welcome', 'I have an idea')
  await k.actions.submit()
  assert.equal(k.state.stage, 'uncertain')
  await k.actions.clarify()
  assert.equal(k.state.error.message, ASK_MORE)
})

test('irrelevant input is declined, however short, and never reaches generative content', async () => {
  for (const [text, reason] of [['hi', 'greeting-only'], ['write me a poem', 'off-topic'], ['reset my password', 'support-request'], ['asdfgh', 'unintelligible']]) {
    const j = createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null })
    j.actions.setDraft('welcome', text)
    await j.actions.submit()
    assert.equal(j.state.stage, 'declined', text)
    assert.equal(j.state.ctx.qualification.reason, reason, text)
    assert.equal(j.state.ctx.exchanges.length, 0, `${text}: no questions generated`)
    assert.equal(j.state.ctx.qualification.tier <= 1, true)
  }
})

test('the journey reaches the statement, continue, and a simulated handoff', async () => {
  const j = await toStatement(createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null }))
  assert.ok(j.state.ctx.statement.text.length > 80)
  j.actions.accept()
  assert.equal(j.state.stage, 'continue')
  await j.actions.handoff()
  assert.equal(j.state.stage, 'done')
  assert.equal(j.state.receipt.status, 'simulated')
  assert.equal(j.state.payload.schema, 'compascaribe.handoff/1')
  assert.equal(j.state.ctx.handoff.status, 'simulated')
})

test('a saved journey restores to the same stage with answers, and a reload after the handoff keeps the record', async () => {
  const storage = memoryStorage()
  const j = await toStatement(createJourney({ storage, provider: provider(), latency: false, history: null }))
  j.actions.accept()
  await j.actions.handoff()
  const j2 = createJourney({ storage, provider: provider(), latency: false, history: null })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'done')
  assert.ok(j2.state.payload, 'payload is rebuilt on restore')
  assert.equal(j2.state.receipt.receiptId, j.state.receipt.receiptId)
})

test('a reload during composing resumes at the last answer, not a blank welcome', async () => {
  const storage = memoryStorage()
  const j = await toDiscovery(createJourney({ storage, provider: provider(), latency: false, history: null }))
  while (j.state.stage === 'discovery') {
    const ex = j.state.ctx.exchanges[j.state.stepIndex]
    j.actions.select(ex.options[0].id)
    await j.actions.commitAnswer()
  }
  // Simulate the browser dying mid-composition by rewriting the saved stage.
  const saved = JSON.parse(storage.map.get('compascaribe.journey.v1'))
  saved.stage = 'composing'
  saved.ctx.statement = null
  storage.map.set('compascaribe.journey.v1', JSON.stringify(saved))
  const j2 = createJourney({ storage, provider: provider(), latency: false, history: null })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'discovery')
  assert.equal(j2.state.stepIndex, j2.state.ctx.exchanges.length - 1)
  assert.ok(j2.state.ctx.exchanges.every(e => e.answer), 'answers kept')
})

test('a corrupt or outdated saved record is discarded instead of crashing', () => {
  const storage = memoryStorage()
  storage.setItem('compascaribe.journey.v1', JSON.stringify({ savedAt: Date.now(), stage: 'statement', ctx: { version: CONTEXT_VERSION + 1, submission: { text: 'x' } } }))
  const j = createJourney({ storage, provider: provider(), latency: false, history: null })
  assert.equal(j.restore(), false)
  assert.equal(j.state.stage, 'welcome')
  assert.equal(storage.getItem('compascaribe.journey.v1'), null)
  storage.setItem('compascaribe.journey.v1', '{not json')
  assert.equal(createJourney({ storage, provider: provider(), latency: false, history: null }).restore(), false)
})

test('back during reading cancels classification and keeps the words', async () => {
  const j = createJourney({ storage: memoryStorage(), provider: { ...provider(), qualify: () => new Promise(() => {}) }, latency: false, history: null })
  j.actions.setDraft('welcome', 'We need a way to track catering orders instead of a whiteboard')
  const p = j.actions.submit()
  assert.equal(j.state.stage, 'qualifying')
  j.actions.back()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.busy, false)
  assert.match(j.state.drafts.welcome, /catering orders/)
  await Promise.race([p, new Promise(r => setTimeout(r, 20))])
})

test('a provider failure returns to a stable stage with the error shown', async () => {
  const bad = { ...provider(), open: async () => { throw new Error('boom') } }
  const j = createJourney({ storage: memoryStorage(), provider: bad, latency: false, history: null })
  j.actions.setDraft('welcome', 'We lose track of orders that come in over WhatsApp')
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.busy, false)
  assert.match(j.state.error.message, /try again/)
  assert.match(j.state.drafts.welcome, /WhatsApp/)
})

test('revisiting from the statement returns there with Back, and updating recomposes', async () => {
  const j = await toStatement(createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null }))
  const v1 = j.state.ctx.statement.version
  j.actions.revisit(0)
  assert.equal(j.state.stage, 'discovery')
  assert.equal(j.state.returnTo, 'statement')
  j.actions.back()
  assert.equal(j.state.stage, 'statement')
  j.actions.revisit(0)
  const ex = j.state.ctx.exchanges[0]
  const other = ex.options.find(o => o.id !== ex.answer.optionId)
  j.actions.select(other.id)
  await j.actions.commitAnswer()
  assert.equal(j.state.stage, 'statement')
  assert.equal(j.state.ctx.statement.version, v1 + 1)
})

test('a new statement after a handoff clears the stale receipt', async () => {
  const j = await toStatement(createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null }))
  j.actions.accept()
  await j.actions.handoff()
  assert.equal(j.state.stage, 'done')
  j.actions.back()
  j.actions.back()
  assert.equal(j.state.stage, 'statement')
  await j.actions.refine('plain')
  assert.equal(j.state.receipt, null)
  assert.equal(j.state.ctx.handoff.status, 'none')
})

test('restoring a visitor-edited draft keeps its source', async () => {
  const j = await toStatement(createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: null }))
  j.actions.openRefine()
  j.actions.toggleEditor()
  j.actions.setDraft('edit', 'Our own words for the project statement, kept exactly.')
  j.actions.editStatement()
  assert.equal(j.state.ctx.statement.source, 'edited')
  await j.actions.refine('plain')
  j.actions.useDraft(2)
  assert.equal(j.state.ctx.statement.source, 'edited')
  assert.match(j.state.ctx.statement.text, /Our own words/)
})

test('history grows only on forward moves', async () => {
  const hist = fakeHistory()
  const j = await toStatement(createJourney({ storage: memoryStorage(), provider: provider(), latency: false, history: hist }))
  const after = hist.entries.length
  j.actions.back()
  j.actions.back()
  j.actions.revisit(0)
  assert.equal(hist.entries.length, after, 'back and revisit replace instead of pushing')
})

test('controls are inert while the provider is working', async () => {
  const slow = { ...provider(), answer: (...a) => new Promise(r => setTimeout(() => r(provider().answer(...a)), 15)) }
  const j = await toDiscovery(createJourney({ storage: memoryStorage(), provider: slow, latency: false, history: null }))
  const ex = j.state.ctx.exchanges[0]
  j.actions.select(ex.options[0].id)
  const p = j.actions.commitAnswer()
  assert.equal(j.state.busy, true)
  j.actions.select(ex.options[1].id)
  assert.equal(j.state.selection, ex.options[0].id, 'selection cannot change in flight')
  j.actions.revisit(0)
  assert.equal(j.state.busy, true)
  await p
  assert.equal(j.state.ctx.exchanges[0].answer.optionId, ex.options[0].id)
})
