import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASK_MORE, createJourney, STORAGE_KEY } from '../src/app/journey.js'
import { createProvider } from '../src/domain/discovery/provider.js'
import { CONTEXT_VERSION, createContext, withExchanges, withQualification, withSubmission } from '../src/domain/context.js'
import { GATE_SCHEMA } from '../src/domain/gate/pipeline.js'

function memoryStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), map: m }
}

function fakeHistory() {
  const entries = [{}]
  return { entries, pushState: s => entries.push(s), replaceState: s => { entries[entries.length - 1] = s } }
}

const provider = () => createProvider({ latency: false })

// A stand-in for the Worker, for these state-machine tests only. Real decisions
// are covered in gate-*.test.js; the production path never contains a stub.
function result(decision = 'PROCEED', extra = {}) {
  const signals = decision === 'UNAVAILABLE' ? null : { intent: 0.9, irrelevance: 0.05, spam: 0.02 }
  return {
    schema: GATE_SCHEMA, decision, rule: decision === 'PROCEED' ? 'proceed.default' : decision === 'BLOCK' ? 'block.spam' : null,
    trace: [], signals, thresholds: {}, model: 'jev-test', requestedModel: 'jev-latest', latencyMs: 12, attempts: 1,
    usage: { inputTokens: 10, outputTokens: 3 }, failure: decision === 'UNAVAILABLE' ? { kind: 'timeout' } : null, ...extra,
  }
}
function stubGate(...queue) {
  const calls = []
  return {
    calls,
    async classify(text) {
      calls.push(text)
      const next = queue.length > 1 ? queue.shift() : queue[0]
      return typeof next === 'function' ? next(text) : { result: next || result() }
    },
  }
}
const journey = (extra = {}) => createJourney({ storage: memoryStorage(), provider: provider(), gate: stubGate(), latency: false, history: null, ...extra })

const WA = 'We lose track of orders that come in over WhatsApp and someone has to retype them into a notebook'

/**
 * The downstream flow is not reachable from Begin (the gate stops there), so
 * these tests enter it the way a saved journey does: by restoring one.
 */
async function toDiscovery(j, text = WA, { stage = 'discovery' } = {}) {
  const p = provider()
  let ctx = withSubmission(createContext(), text)
  ctx = withQualification(ctx, await p.qualify(ctx))
  ctx = withExchanges(ctx, (await p.open(ctx)).exchanges)
  j.__storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), ctx, stage, stepIndex: 0, parts: null, receipt: null }))
  assert.equal(j.restore(), true)
  assert.equal(j.state.stage, stage)
  return j
}

/** A journey for the downstream tests; its storage is exposed so a saved journey can be seeded. */
const downstream = (opts = {}) => {
  const storage = opts.storage || memoryStorage()
  const j = createJourney({ storage, provider: opts.provider || provider(), gate: stubGate(), latency: false, history: opts.history ?? null })
  j.__storage = storage
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

test('only empty or whitespace-only input is rejected inline, before any request; brevity is not', async () => {
  const gate = stubGate()
  const j = journey({ gate })
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.error.message, "Tell us a little more about what you'd like to change or accomplish.")
  assert.equal(j.state.error.message, ASK_MORE)
  j.actions.setDraft('welcome', '   \n \t ')
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.error.message, ASK_MORE)
  assert.equal(gate.calls.length, 0, 'no classification is requested for empty input')
  // Typing clears the message; two words go to the gate as they are.
  j.actions.setDraft('welcome', 'Automate invoicing')
  assert.equal(j.state.error, null)
  await j.actions.submit()
  assert.equal(j.state.stage, 'gate')
  assert.deepEqual(gate.calls, ['Automate invoicing'])
  assert.equal(j.state.gate.decision, 'PROCEED')
})

test('over-long input is rejected inline and never reaches the gate', async () => {
  const gate = stubGate()
  const j = journey({ gate })
  j.actions.setDraft('welcome', 'x'.repeat(481))
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.match(j.state.error.message, /more than fits here/)
  assert.equal(gate.calls.length, 0)
  assert.equal(j.state.drafts.welcome.length, 481, 'the words are kept')
})

test('Begin runs the gate and stops: no decision is routed, whatever it is', async () => {
  for (const decision of ['PROCEED', 'BLOCK', 'UNAVAILABLE']) {
    const j = journey({ gate: stubGate(result(decision)) })
    j.actions.setDraft('welcome', 'A website')
    await j.actions.submit()
    assert.equal(j.state.stage, 'gate', decision)
    assert.equal(j.state.gate.decision, decision)
    assert.equal(j.state.busy, false)
    assert.equal(j.state.ctx.exchanges.length, 0, decision + ': nothing is generated')
    assert.equal(j.state.ctx.qualification, null, decision + ': the simulated classifier is not consulted')
    assert.equal(j.state.ctx.statement, null)
  }
})

test('the displayed result is the one the backend returned, untouched', async () => {
  const returned = result('BLOCK', { signals: { intent: 0.01, irrelevance: 0.97, spam: 0.12 }, rule: 'block.irrelevance', latencyMs: 733, model: 'jev-9.9.9' })
  const j = journey({ gate: stubGate(returned) })
  j.actions.setDraft('welcome', 'Who won the 1998 World Cup?')
  await j.actions.submit()
  assert.equal(j.state.gate, returned)
})

test('the visitor words are preserved through the gate and back', async () => {
  const j = journey({ gate: stubGate(result('BLOCK')) })
  const words = '  hello   there \n friend  '
  j.actions.setDraft('welcome', words)
  await j.actions.submit()
  assert.equal(j.state.ctx.submission.text, words.trim())
  j.actions.back()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.drafts.welcome, words.trim())
  assert.equal(j.state.gate, null)
})

test('submitting while a classification is in flight does not start a second one', async () => {
  let release
  const gate = stubGate(() => new Promise(r => { release = () => r({ result: result() }) }))
  const j = journey({ gate })
  j.actions.setDraft('welcome', 'Automate invoicing')
  const first = j.actions.submit()
  assert.equal(j.state.busy, true)
  await j.actions.submit()
  await j.actions.retryGate()
  assert.equal(gate.calls.length, 1)
  release()
  await first
  assert.equal(j.state.gate.decision, 'PROCEED')
})

test('an unavailable gate is shown as UNAVAILABLE, keeps the words, and can be retried', async () => {
  const gate = stubGate(result('UNAVAILABLE'), result('PROCEED'))
  const j = journey({ gate })
  j.actions.setDraft('welcome', 'We need a booking system')
  await j.actions.submit()
  assert.equal(j.state.gate.decision, 'UNAVAILABLE')
  assert.equal(j.state.ctx.submission.text, 'We need a booking system')
  await j.actions.retryGate()
  assert.equal(j.state.stage, 'gate')
  assert.equal(j.state.gate.decision, 'PROCEED')
  assert.equal(gate.calls.length, 2)
})

test('a server-side rejection returns to the landing page with the inline message and the words', async () => {
  const j = journey({ gate: { classify: async () => ({ rejected: 'empty' }) } })
  j.actions.setDraft('welcome', 'something')
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.error.message, ASK_MORE)
  assert.equal(j.state.drafts.welcome, 'something')
})

test('a thrown gate error returns to a stable stage with the words kept', async () => {
  const j = journey({ gate: { classify: async () => { throw new Error('boom') } } })
  j.actions.setDraft('welcome', 'We lose track of orders that come in over WhatsApp')
  await j.actions.submit()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.busy, false)
  assert.match(j.state.error.message, /try again/)
  assert.match(j.state.drafts.welcome, /WhatsApp/)
})

test('back during classification cancels it and keeps the words', async () => {
  const j = journey({ gate: { classify: () => new Promise(() => {}) } })
  j.actions.setDraft('welcome', 'We need a way to track catering orders instead of a whiteboard')
  const p = j.actions.submit()
  assert.equal(j.state.stage, 'gate')
  j.actions.back()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.busy, false)
  assert.match(j.state.drafts.welcome, /catering orders/)
  await Promise.race([p, new Promise(r => setTimeout(r, 20))])
})

test('a saved gate stage resumes on the landing page with the words, never in the diagnostic', async () => {
  const storage = memoryStorage()
  const j = journey({ storage, gate: stubGate(result('PROCEED')) })
  j.actions.setDraft('welcome', 'Automate invoicing')
  await j.actions.submit()
  const j2 = createJourney({ storage, provider: provider(), gate: stubGate(), latency: false, history: null })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'welcome')
  assert.equal(j2.state.drafts.welcome, 'Automate invoicing')
  assert.equal(j2.state.gate, null)
})

test('journeys saved before the gate existed are not resumed into the simulated flow', () => {
  const storage = memoryStorage()
  storage.setItem('compascaribe.journey.v1', JSON.stringify({ savedAt: Date.now(), stage: 'statement', ctx: { version: CONTEXT_VERSION, submission: { text: 'x' } } }))
  const j = createJourney({ storage, provider: provider(), gate: stubGate(), latency: false, history: null })
  assert.equal(j.restore(), false)
  assert.equal(j.state.stage, 'welcome')
})

// --- the simulated downstream flow, entered from a saved journey -------------------------

test('the journey reaches the statement, continue, and a simulated handoff', async () => {
  const j = await toStatement(downstream())
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
  const j = await toStatement(downstream({ storage }))
  j.actions.accept()
  await j.actions.handoff()
  const j2 = downstream({ storage })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'done')
  assert.ok(j2.state.payload, 'payload is rebuilt on restore')
  assert.equal(j2.state.receipt.receiptId, j.state.receipt.receiptId)
})

test('a reload during composing resumes at the last answer, not a blank welcome', async () => {
  const storage = memoryStorage()
  const j = await toDiscovery(downstream({ storage }))
  while (j.state.stage === 'discovery') {
    const ex = j.state.ctx.exchanges[j.state.stepIndex]
    j.actions.select(ex.options[0].id)
    await j.actions.commitAnswer()
  }
  // Simulate the browser dying mid-composition by rewriting the saved stage.
  const saved = JSON.parse(storage.map.get(STORAGE_KEY))
  saved.stage = 'composing'
  saved.ctx.statement = null
  storage.map.set(STORAGE_KEY, JSON.stringify(saved))
  const j2 = downstream({ storage })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'discovery')
  assert.equal(j2.state.stepIndex, j2.state.ctx.exchanges.length - 1)
  assert.ok(j2.state.ctx.exchanges.every(e => e.answer), 'answers kept')
})

test('a corrupt or outdated saved record is discarded instead of crashing', () => {
  const storage = memoryStorage()
  storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), stage: 'statement', ctx: { version: CONTEXT_VERSION + 1, submission: { text: 'x' } } }))
  const j = downstream({ storage })
  assert.equal(j.restore(), false)
  assert.equal(j.state.stage, 'welcome')
  assert.equal(storage.getItem(STORAGE_KEY), null)
  storage.setItem(STORAGE_KEY, '{not json')
  assert.equal(downstream({ storage }).restore(), false)
})

test('revisiting from the statement returns there with Back, and updating recomposes', async () => {
  const j = await toStatement(downstream())
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
  const j = await toStatement(downstream())
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
  const j = await toStatement(downstream())
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
  const j = await toStatement(downstream({ history: hist }))
  const after = hist.entries.length
  j.actions.back()
  j.actions.back()
  j.actions.revisit(0)
  assert.equal(hist.entries.length, after, 'back and revisit replace instead of pushing')
})

test('controls are inert while the provider is working', async () => {
  const slow = { ...provider(), answer: (...a) => new Promise(r => setTimeout(() => r(provider().answer(...a)), 15)) }
  const j = await toDiscovery(downstream({ provider: slow }))
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
