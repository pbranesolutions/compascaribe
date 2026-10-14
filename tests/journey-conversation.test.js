import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJourney, STORAGE_KEY } from '../src/app/journey.js'
import { latestOpening, latestReply, LIMITS } from '../src/domain/context.js'
import { createProvider } from '../src/domain/discovery/provider.js'
import { GATE_SCHEMA } from '../src/domain/gate/pipeline.js'
import { GOOD } from './conversation-support.js'

function memoryStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), map: m }
}

// Stand-ins for the two Worker routes, for these state-machine tests only. The
// real decisions and replies are covered in gate-*.test.js and conversation-*.test.js.
function gateResult(decision = 'PROCEED') {
  const signals = decision === 'UNAVAILABLE' ? null : { intent: 0.9, irrelevance: 0.05, spam: 0.02 }
  return {
    schema: GATE_SCHEMA, decision, rule: decision === 'PROCEED' ? 'proceed.default' : decision === 'BLOCK' ? 'block.spam' : null,
    trace: [], signals, thresholds: {}, model: 'jev-test', requestedModel: 'jev-latest', latencyMs: 12, attempts: 1,
    usage: { inputTokens: 10, outputTokens: 3 }, failure: decision === 'UNAVAILABLE' ? { kind: 'timeout' } : null,
  }
}
const qual = (ttl = 10 * 60 * 1000) => ({ token: `tok-${Math.random().toString(36).slice(2)}`, expiresAt: Date.now() + ttl })

function stubGate(...queue) {
  const calls = []
  return {
    calls,
    async classify(text) {
      calls.push(text)
      const next = queue.length > 1 ? queue.shift() : queue[0]
      const out = typeof next === 'function' ? next(text) : next
      return out || { result: gateResult('PROCEED'), qualification: qual() }
    },
  }
}
const proceed = (q = qual()) => ({ result: gateResult('PROCEED'), qualification: q })
const opened = (extra = {}) => ({ ok: true, opening: { ...GOOD }, model: 'claude-sonnet-5-5', latencyMs: 1800, usage: { inputTokens: 640, outputTokens: 150 }, ...extra })
const failed = failure => ({ ok: false, failure })

function stubConversation(...queue) {
  const calls = []
  return {
    calls,
    async open(input) {
      calls.push(input)
      const next = queue.length > 1 ? queue.shift() : queue[0]
      return typeof next === 'function' ? next(input) : next || opened()
    },
  }
}

const make = (opts = {}) => {
  const storage = opts.storage || memoryStorage()
  const j = createJourney({
    storage, provider: createProvider({ latency: false }), gate: opts.gate || stubGate(), conversation: opts.conversation || stubConversation(),
    latency: false, history: opts.history ?? null,
  })
  j.__storage = storage
  return j
}

const WA = 'We lose track of orders that come in over WhatsApp and someone has to retype them into a notebook'
const begin = async (j, text = WA) => {
  j.actions.setDraft('welcome', text)
  await j.actions.submit()
}

test('PROCEED with the server’s qualification opens the conversation: one model request, the words exactly as written', async () => {
  const q = qual()
  const gate = stubGate(proceed(q))
  const conversation = stubConversation(opened())
  const j = make({ gate, conversation })
  const words = '  Quiero que mis clientes\n   reserven sin llamar — “ya”.  '
  await begin(j, words)
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.busy, false)
  assert.equal(gate.calls.length, 1)
  assert.deepEqual(conversation.calls, [{ text: words.trim(), qualification: q.token }])
  assert.equal(j.state.opening.status, 'ready')
  const o = latestOpening(j.state.ctx)
  assert.equal(o.reflection, GOOD.reflection)
  assert.equal(o.question, GOOD.question)
  assert.deepEqual(o.analysis, { describes: GOOD.describes, uncertainty: GOOD.uncertainty, explores: GOOD.explores })
  assert.equal(o.source.model, 'claude-sonnet-5-5')
  // The visitor's description is still the submission, never replaced by anything generated.
  assert.equal(j.state.ctx.submission.text, words.trim())
  assert.equal(j.state.qualification, null, 'the qualification is spent')
  assert.equal(j.state.gate.decision, 'PROCEED', 'the gate result is preserved')
})

test('BLOCK and UNAVAILABLE never reach the model and stay at the diagnostic', async () => {
  for (const decision of ['BLOCK', 'UNAVAILABLE']) {
    const conversation = stubConversation(opened())
    const j = make({ gate: stubGate({ result: gateResult(decision), qualification: null }), conversation })
    await begin(j, 'A website')
    assert.equal(j.state.stage, 'gate', decision)
    assert.equal(j.state.gate.decision, decision)
    assert.equal(conversation.calls.length, 0, decision)
    assert.equal(latestOpening(j.state.ctx), null)
  }
})

test('even a qualification attached to a BLOCK is not used', async () => {
  const conversation = stubConversation(opened())
  const j = make({ gate: stubGate({ result: gateResult('BLOCK'), qualification: qual() }), conversation })
  await begin(j, 'A website')
  assert.equal(j.state.stage, 'gate')
  assert.equal(conversation.calls.length, 0)
})

test('a PROCEED without the qualification is shown at the diagnostic and asks the model nothing', async () => {
  const conversation = stubConversation(opened())
  const j = make({ gate: stubGate({ result: gateResult('PROCEED'), qualification: null }), conversation })
  await begin(j, 'A website')
  assert.equal(j.state.stage, 'gate')
  assert.equal(j.state.gate.decision, 'PROCEED')
  assert.equal(conversation.calls.length, 0)
})

test('while the reply is being written the words are shown and repeated Begin or retry makes no second request', async () => {
  let release
  const conversation = stubConversation(() => new Promise(r => { release = () => r(opened()) }))
  const j = make({ conversation })
  j.actions.setDraft('welcome', WA)
  const first = j.actions.submit()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.opening.status, 'generating')
  assert.equal(j.state.busy, true)
  assert.equal(j.state.ctx.submission.text, WA)
  await j.actions.submit()
  await j.actions.retryOpening()
  await j.actions.retryGate()
  assert.equal(conversation.calls.length, 1)
  release()
  await first
  assert.equal(j.state.opening.status, 'ready')
  assert.equal(conversation.calls.length, 1)
})

test('a model failure keeps the words and the stage, shows the kind, and retry asks again with the same qualification', async () => {
  const gate = stubGate(proceed())
  const conversation = stubConversation(failed('timeout'), opened())
  const j = make({ gate, conversation })
  await begin(j)
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.opening.status, 'failed')
  assert.equal(j.state.opening.failure, 'timeout')
  assert.equal(j.state.busy, false)
  assert.equal(j.state.ctx.submission.text, WA)
  assert.equal(latestOpening(j.state.ctx), null)
  await j.actions.retryOpening()
  assert.equal(j.state.opening.status, 'ready')
  assert.equal(conversation.calls.length, 2)
  assert.equal(gate.calls.length, 1, 'the gate was not run again')
  assert.equal(conversation.calls[0].qualification, conversation.calls[1].qualification)
})

test('an expired or refused qualification sends the retry back through the gate first', async () => {
  const gate = stubGate(proceed(qual(-1000)), proceed())
  const conversation = stubConversation(failed('network'), opened())
  const j = make({ gate, conversation })
  await begin(j)
  assert.equal(j.state.opening.status, 'failed')
  await j.actions.retryOpening()
  assert.equal(gate.calls.length, 2, 'the words were checked again')
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.opening.status, 'ready')

  const gate2 = stubGate(proceed(), proceed())
  const conversation2 = stubConversation(failed('qualification'), opened())
  const j2 = make({ gate: gate2, conversation: conversation2 })
  await begin(j2)
  assert.equal(j2.state.opening.failure, 'qualification')
  await j2.actions.retryOpening()
  assert.equal(gate2.calls.length, 2)
  assert.equal(j2.state.opening.status, 'ready')
})

test('a re-check that no longer passes goes to the diagnostic and asks the model nothing', async () => {
  const gate = stubGate(proceed(qual(-1000)), { result: gateResult('BLOCK'), qualification: null })
  const conversation = stubConversation(failed('timeout'), opened())
  const j = make({ gate, conversation })
  await begin(j)
  await j.actions.retryOpening()
  assert.equal(j.state.stage, 'gate')
  assert.equal(j.state.gate.decision, 'BLOCK')
  assert.equal(conversation.calls.length, 1, 'only the first, failed request')
})

test('Back during generation cancels it: a late reply is discarded and the words are kept', async () => {
  let release
  const conversation = stubConversation(() => new Promise(r => { release = () => r(opened()) }))
  const j = make({ conversation })
  j.actions.setDraft('welcome', WA)
  const p = j.actions.submit()
  await new Promise(r => setTimeout(r, 5))
  j.actions.back()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.busy, false)
  assert.equal(j.state.drafts.welcome, WA)
  release()
  await p
  assert.equal(latestOpening(j.state.ctx), null, 'the late reply is not recorded')
  assert.equal(j.state.stage, 'welcome')
})

test('the same words again, after Back, reuse the reply: no gate, no model request', async () => {
  const gate = stubGate(proceed())
  const conversation = stubConversation(opened())
  const j = make({ gate, conversation })
  await begin(j)
  j.actions.back()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.drafts.welcome, WA)
  await j.actions.submit()
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.opening.status, 'ready')
  assert.equal(latestOpening(j.state.ctx).question, GOOD.question)
  assert.equal(gate.calls.length, 1)
  assert.equal(conversation.calls.length, 1)
  // Changed words are a new submission: checked, answered, and the old reply is gone.
  j.actions.back()
  j.actions.setDraft('welcome', WA + ' It is getting worse.')
  await j.actions.submit()
  assert.equal(gate.calls.length, 2)
  assert.equal(conversation.calls.length, 2)
})

test('a saved conversation resumes with its reply and asks nothing; a reply that never arrived resumes on the landing page', async () => {
  const storage = memoryStorage()
  const j = make({ storage })
  await begin(j)
  assert.equal(j.state.stage, 'conversation')
  const gate = stubGate()
  const conversation = stubConversation(opened())
  const j2 = createJourney({ storage, provider: createProvider({ latency: false }), gate, conversation, latency: false, history: null })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'conversation')
  assert.equal(j2.state.opening.status, 'ready')
  assert.equal(latestOpening(j2.state.ctx).reflection, GOOD.reflection)
  assert.equal(j2.state.ctx.submission.text, WA)
  assert.equal(gate.calls.length + conversation.calls.length, 0)

  // Saved while the model was still working: no opening, so the words are kept and nothing is replayed.
  const saved = JSON.parse(storage.getItem(STORAGE_KEY))
  saved.ctx.conversation = { turns: [] }
  const storage2 = memoryStorage()
  storage2.setItem(STORAGE_KEY, JSON.stringify(saved))
  const j3 = createJourney({ storage: storage2, provider: createProvider({ latency: false }), gate, conversation, latency: false, history: null })
  assert.equal(j3.restore(), true)
  assert.equal(j3.state.stage, 'welcome')
  assert.equal(j3.state.drafts.welcome, WA)
  assert.equal(gate.calls.length + conversation.calls.length, 0)
})

test('the visitor can answer: recorded with the opening, kept across a reload, editable, and nothing is generated for it', async () => {
  const gate = stubGate(proceed())
  const conversation = stubConversation(opened())
  const storage = memoryStorage()
  const j = make({ gate, conversation, storage })
  await begin(j)
  j.actions.sendReply()
  assert.match(j.state.error.message, /few words/, 'an empty answer is not recorded')
  assert.equal(latestReply(j.state.ctx), null)
  j.actions.setDraft('reply', 'x'.repeat(LIMITS.reply + 1))
  j.actions.sendReply()
  assert.match(j.state.error.message, /Keep it under/)
  j.actions.setDraft('reply', '  Mostly that nobody has to retype anything.  ')
  assert.equal(j.state.error, null)
  j.actions.sendReply()
  const reply = latestReply(j.state.ctx)
  assert.equal(reply.text, 'Mostly that nobody has to retype anything.')
  assert.equal(reply.to, latestOpening(j.state.ctx).id)
  assert.equal(j.state.drafts.reply, '')
  assert.equal(gate.calls.length, 1)
  assert.equal(conversation.calls.length, 1, 'no second model request for an answer')

  const j2 = createJourney({ storage, provider: createProvider({ latency: false }), gate: stubGate(), conversation: stubConversation(), latency: false, history: null })
  j2.restore()
  assert.equal(latestReply(j2.state.ctx).text, 'Mostly that nobody has to retype anything.')

  j.actions.editReply()
  assert.equal(latestReply(j.state.ctx), null)
  assert.equal(j.state.drafts.reply, 'Mostly that nobody has to retype anything.')
  j.actions.setDraft('reply', 'Mostly that nothing gets lost.')
  j.actions.sendReply()
  assert.equal(latestReply(j.state.ctx).text, 'Mostly that nothing gets lost.')
})

test('start over clears the conversation along with everything else', async () => {
  const j = make()
  await begin(j)
  j.actions.setDraft('reply', 'An answer')
  j.actions.sendReply()
  j.actions.reset()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(latestOpening(j.state.ctx), null)
  assert.equal(j.state.ctx.submission, null)
  assert.equal(j.__storage.getItem(STORAGE_KEY), null)
})
