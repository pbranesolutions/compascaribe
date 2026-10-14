import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJourney, STORAGE_KEY } from '../src/app/journey.js'
import { confirmedStatement, isConfirmed, latestCompas, latestOpening, latestReply, latestUnderstanding, LIMITS, openStatement, turnsOf } from '../src/domain/context.js'
import { createProvider } from '../src/domain/discovery/provider.js'
import { GATE_SCHEMA } from '../src/domain/gate/pipeline.js'
import { GOOD, GOOD_STATEMENT, GOOD_TURN } from './conversation-support.js'

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
const opened = (extra = {}) => ({ ok: true, kind: 'opening', opening: { ...GOOD }, qualification: qual(), progress: { replies: 1, limit: 10 }, model: 'claude-sonnet-5-5', latencyMs: 1800, usage: { inputTokens: 640, outputTokens: 150 }, ...extra })
const turned = (turn = GOOD_TURN, extra = {}) => ({ ok: true, kind: 'turn', turn: { ...turn }, qualification: qual(), progress: { replies: 2, limit: 10 }, model: 'claude-sonnet-5-5', latencyMs: 2200, usage: { inputTokens: 900, outputTokens: 400 }, ...extra })
const failed = failure => ({ ok: false, failure })

function stubConversation(...queue) {
  const calls = []
  const nextCalls = []
  const replies = []
  return {
    calls,
    nextCalls,
    /** What the later replies answer with, in order (the last repeats). */
    replies,
    async open(input) {
      calls.push(input)
      const next = queue.length > 1 ? queue.shift() : queue[0]
      return typeof next === 'function' ? next(input) : next || opened()
    },
    async next(input) {
      nextCalls.push(input)
      const next = replies.length > 1 ? replies.shift() : replies[0]
      return typeof next === 'function' ? next(input) : next || turned()
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
  assert.equal(typeof j.state.qualification.token, 'string', 'the conversation continues under the renewed qualification')
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

// --- the conversation continues ---------------------------------------------------------------

const ANSWER = 'Marta retypes them every evening, and some get lost.'
const answer = async (j, text = ANSWER) => {
  j.actions.setDraft('reply', text)
  await j.actions.sendReply()
}

test('an answer is recorded, one request is made for the reply, and the reply becomes the active question', async () => {
  const gate = stubGate(proceed())
  const conversation = stubConversation(opened())
  const storage = memoryStorage()
  const j = make({ gate, conversation, storage })
  await begin(j)
  const token = j.state.qualification.token

  j.actions.setDraft('reply', '   ')
  await j.actions.sendReply()
  assert.match(j.state.error.message, /few words/, 'an empty answer is not sent')
  j.actions.setDraft('reply', 'x'.repeat(LIMITS.reply + 1))
  await j.actions.sendReply()
  assert.match(j.state.error.message, /Keep it under/)
  assert.equal(conversation.nextCalls.length, 0)

  await answer(j, `  ${ANSWER}  `)
  assert.equal(conversation.nextCalls.length, 1)
  const sent = conversation.nextCalls[0]
  assert.equal(sent.text, WA)
  assert.equal(sent.qualification, token, 'the qualification that came back with the opening')
  assert.deepEqual(sent.turns.map(t => [t.role, t.kind]), [['compas', 'opening'], ['visitor', 'reply']])
  assert.equal(sent.turns[1].text, ANSWER)
  assert.equal(sent.understanding, null, 'nothing is understood before the first reply of the model to an answer')

  const turn = latestCompas(j.state.ctx)
  assert.equal(turn.kind, 'followup')
  assert.equal(turn.reflection, GOOD_TURN.reflection)
  assert.equal(turn.question, GOOD_TURN.question)
  assert.deepEqual(turn.understanding.coverage, GOOD_TURN.understanding.coverage)
  assert.equal(latestReply(j.state.ctx), null, 'the answer has its reply: the question is the new active one')
  assert.equal(turnsOf(j.state.ctx).length, 3)
  assert.equal(j.state.drafts.reply, '')
  assert.equal(j.state.turn.status, 'idle')
  assert.equal(j.state.busy, false)
  assert.notEqual(j.state.qualification.token, token, 'renewed with every reply')
  assert.equal(gate.calls.length, 1, 'the gate is not asked again')
  assert.equal(j.state.ctx.submission.text, WA, 'the visitor’s words are never replaced')
  assert.equal(turnsOf(j.state.ctx)[1].text, ANSWER, 'and neither are their answers')
  assert.equal(latestUnderstanding(j.state.ctx).purpose, GOOD_TURN.understanding.purpose)

  // The next answer carries everything so far, and the understanding built so far.
  conversation.replies.push(turned({ ...GOOD_TURN, question: 'Who in the kitchen uses the notebook the next morning?' }))
  await answer(j, 'Three last Friday.')
  const second = conversation.nextCalls[1]
  assert.deepEqual(second.turns.map(t => [t.role, t.kind]), [['compas', 'opening'], ['visitor', 'reply'], ['compas', 'followup'], ['visitor', 'reply']])
  assert.deepEqual(second.understanding.coverage, GOOD_TURN.understanding.coverage)
  assert.equal(second.qualification, j.state.notes.length ? second.qualification : null)
  assert.equal(latestCompas(j.state.ctx).question, 'Who in the kitchen uses the notebook the next morning?')

  // The whole exchange is kept across a reload, where it was.
  const j2 = createJourney({ storage, provider: createProvider({ latency: false }), gate: stubGate(), conversation: stubConversation(), latency: false, history: null })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'conversation')
  assert.equal(latestCompas(j2.state.ctx).question, 'Who in the kitchen uses the notebook the next morning?')
  assert.equal(turnsOf(j2.state.ctx).length, 5)
  assert.equal(j2.state.turn.status, 'idle')
})

test('sending twice makes one request, and the answer cannot be edited while the reply is being written', async () => {
  let release
  const conversation = stubConversation(opened())
  conversation.replies.push(() => new Promise(r => { release = () => r(turned()) }))
  const j = make({ conversation })
  await begin(j)
  j.actions.setDraft('reply', ANSWER)
  const first = j.actions.sendReply()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(j.state.turn.status, 'generating')
  assert.equal(j.state.busy, true)
  assert.equal(latestReply(j.state.ctx).text, ANSWER)
  await j.actions.sendReply()
  await j.actions.retryTurn()
  j.actions.editReply()
  assert.equal(latestReply(j.state.ctx).text, ANSWER, 'not taken back mid-request')
  assert.equal(conversation.nextCalls.length, 1)
  release()
  await first
  assert.equal(latestCompas(j.state.ctx).kind, 'followup')
  assert.equal(conversation.nextCalls.length, 1)
})

test('a failed reply keeps the answer; trying again asks once more with the same conversation; editing takes the answer back', async () => {
  const conversation = stubConversation(opened())
  conversation.replies.push(failed('timeout'), turned())
  const j = make({ conversation })
  await begin(j)
  await answer(j)
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.turn.status, 'failed')
  assert.equal(j.state.turn.failure, 'timeout')
  assert.equal(j.state.busy, false)
  assert.equal(latestReply(j.state.ctx).text, ANSWER, 'the answer is in the record')
  assert.equal(j.state.drafts.reply, '')
  await j.actions.retryTurn()
  assert.equal(conversation.nextCalls.length, 2)
  assert.deepEqual(conversation.nextCalls[1].turns, conversation.nextCalls[0].turns)
  assert.equal(latestCompas(j.state.ctx).kind, 'followup')
  assert.equal(j.state.turn.status, 'idle')

  // Failed again, and this time the visitor takes the answer back to change it.
  conversation.replies.splice(0, conversation.replies.length, failed('network'), turned({ ...GOOD_TURN, question: 'Which evening is the busiest for the kitchen?' }))
  await answer(j, 'Friday evening is the worst.')
  assert.equal(j.state.turn.failure, 'network')
  j.actions.editReply()
  assert.equal(latestReply(j.state.ctx), null)
  assert.equal(j.state.drafts.reply, 'Friday evening is the worst.')
  assert.equal(j.state.turn.status, 'idle')
  j.actions.setDraft('reply', 'Friday evening is the worst, by far.')
  await j.actions.sendReply()
  assert.equal(conversation.nextCalls.at(-1).turns.at(-1).text, 'Friday evening is the worst, by far.')
  assert.equal(latestCompas(j.state.ctx).question, 'Which evening is the busiest for the kitchen?')
})

test('a qualification that ran out is renewed by checking the words again, then the reply is requested', async () => {
  const gate = stubGate(proceed(), proceed())
  const conversation = stubConversation(opened({ qualification: qual(-1000) }))
  const j = make({ gate, conversation })
  await begin(j)
  assert.equal(gate.calls.length, 1)
  await answer(j)
  assert.equal(gate.calls.length, 2, 'the same words were checked again')
  assert.equal(conversation.nextCalls.length, 1)
  assert.equal(latestCompas(j.state.ctx).kind, 'followup')
  assert.equal(j.state.stage, 'conversation')

  // The server no longer accepts it (attempts exhausted): the next retry checks again too.
  const gate2 = stubGate(proceed(), proceed())
  const conversation2 = stubConversation(opened())
  conversation2.replies.push(failed('qualification'), turned())
  const j2 = make({ gate: gate2, conversation: conversation2 })
  await begin(j2)
  await answer(j2)
  assert.equal(j2.state.turn.failure, 'qualification')
  await j2.actions.retryConversation()
  assert.equal(gate2.calls.length, 2)
  assert.equal(latestCompas(j2.state.ctx).kind, 'followup')
})

test('a re-check mid-conversation that cannot answer keeps the conversation; one that says no goes to the diagnostic', async () => {
  const unavailable = { result: gateResult('UNAVAILABLE'), qualification: null }
  const j = make({ gate: stubGate(proceed(qual(-1000)), unavailable), conversation: stubConversation(opened({ qualification: qual(-1000) })) })
  await begin(j)
  await answer(j)
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.turn.status, 'failed')
  assert.equal(latestReply(j.state.ctx).text, ANSWER)

  const blocked = { result: gateResult('BLOCK'), qualification: null }
  const conversation = stubConversation(opened({ qualification: qual(-1000) }))
  const j2 = make({ gate: stubGate(proceed(), blocked), conversation })
  await begin(j2)
  await answer(j2)
  assert.equal(j2.state.stage, 'gate')
  assert.equal(conversation.nextCalls.length, 0)
})

test('Back while the reply is being written cancels it: a late reply is discarded and the answer is kept', async () => {
  let release
  const conversation = stubConversation(opened())
  conversation.replies.push(() => new Promise(r => { release = () => r(turned()) }), turned())
  const j = make({ conversation })
  await begin(j)
  j.actions.setDraft('reply', ANSWER)
  const p = j.actions.sendReply()
  await new Promise(r => setTimeout(r, 5))
  j.actions.back()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(j.state.busy, false)
  release()
  await p
  assert.equal(latestCompas(j.state.ctx).kind, 'opening', 'the late reply is not recorded')
  assert.equal(latestReply(j.state.ctx).text, ANSWER)
  // The same words again bring the conversation back, the answer still waiting to be sent.
  await j.actions.submit()
  assert.equal(j.state.stage, 'conversation')
  assert.equal(j.state.turn.status, 'failed')
  assert.equal(j.state.turn.failure, 'interrupted')
  assert.equal(conversation.calls.length, 1, 'the opening is not asked again')
  await j.actions.retryConversation()
  assert.equal(latestCompas(j.state.ctx).kind, 'followup')
})

test('an answer whose reply never arrived resumes after a reload, ready to send again', async () => {
  const storage = memoryStorage()
  const conversation = stubConversation(opened())
  conversation.replies.push(failed('network'))
  const j = make({ storage, conversation })
  await begin(j)
  await answer(j)
  assert.equal(j.state.turn.status, 'failed')

  const gate = stubGate(proceed())
  const conversation2 = stubConversation()
  const j2 = createJourney({ storage, provider: createProvider({ latency: false }), gate, conversation: conversation2, latency: false, history: null })
  assert.equal(j2.restore(), true)
  assert.equal(j2.state.stage, 'conversation')
  assert.equal(j2.state.turn.failure, 'interrupted')
  assert.equal(latestReply(j2.state.ctx).text, ANSWER)
  assert.equal(gate.calls.length + conversation2.nextCalls.length, 0, 'nothing is replayed on its own')
  assert.equal(j2.state.qualification, null, 'the qualification is held in memory only')
  await j2.actions.retryConversation()
  assert.equal(gate.calls.length, 1, 'the words are checked again first')
  assert.equal(conversation2.nextCalls.length, 1)
  assert.equal(conversation2.nextCalls[0].turns.at(-1).text, ANSWER)
  assert.equal(latestCompas(j2.state.ctx).kind, 'followup')
})

test('when the purpose is stated it can be confirmed: it becomes the project statement and the way on is Continue', async () => {
  const storage = memoryStorage()
  const conversation = stubConversation(opened())
  conversation.replies.push(turned(GOOD_STATEMENT))
  const j = make({ storage, conversation })
  await begin(j)
  await answer(j)
  const stated = openStatement(j.state.ctx)
  assert.equal(stated.kind, 'statement')
  assert.equal(stated.statement, GOOD_STATEMENT.statement)
  assert.equal(stated.question, GOOD_STATEMENT.question)
  assert.equal(isConfirmed(j.state.ctx), false)
  assert.equal(j.state.ctx.statement, null, 'nothing is the project statement until the visitor says so')

  j.actions.confirmStatement()
  assert.equal(isConfirmed(j.state.ctx), true)
  assert.equal(confirmedStatement(j.state.ctx).statement, GOOD_STATEMENT.statement)
  assert.equal(j.state.ctx.statement.text, GOOD_STATEMENT.statement)
  assert.equal(j.state.ctx.statement.source, 'conversation')
  assert.equal(conversation.nextCalls.length, 1, 'confirming asks the model nothing')
  assert.equal(j.state.stage, 'conversation')

  // A conversation that is complete takes no more answers.
  j.actions.setDraft('reply', 'One more thing')
  await j.actions.sendReply()
  assert.equal(conversation.nextCalls.length, 1)

  // Continue goes on into the (simulated) handoff; Back returns to where it was confirmed.
  j.actions.accept()
  assert.equal(j.state.stage, 'continue')
  j.actions.back()
  assert.equal(j.state.stage, 'conversation')
  assert.equal(isConfirmed(j.state.ctx), true)
  j.actions.accept()
  await j.actions.handoff()
  assert.equal(j.state.stage, 'done')
  assert.equal(j.state.payload.project.statement, GOOD_STATEMENT.statement)
  assert.ok(j.state.payload.discovery.conversation.turns.some(t => t.kind === 'statement' && t.statement === GOOD_STATEMENT.statement))
  assert.equal(j.state.payload.discovery.conversation.turns[0].role, 'compas')
  assert.equal(j.state.payload.discovery.originalInput, WA)
  assert.deepEqual(j.state.payload.discovery.conversation.understanding.coverage, GOOD_TURN.understanding.coverage)

  // A reload at each of those places keeps the confirmed purpose.
  const reopened = (stage) => {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY))
    saved.stage = stage
    const st = memoryStorage()
    st.setItem(STORAGE_KEY, JSON.stringify(saved))
    const r = createJourney({ storage: st, provider: createProvider({ latency: false }), gate: stubGate(), conversation: stubConversation(), latency: false, history: null })
    assert.equal(r.restore(), true)
    return r
  }
  assert.equal(reopened('conversation').state.stage, 'conversation')
  assert.equal(isConfirmed(reopened('conversation').state.ctx), true)
  assert.equal(reopened('continue').state.stage, 'continue')
  assert.equal(reopened('statement').state.stage, 'conversation', 'the simulated statement stage is not where a conversation’s purpose lives')
  assert.equal(reopened('done').state.stage, 'done')
})

test('the stated purpose can be corrected: the correction is an answer, and a revised statement comes back', async () => {
  const revised = { ...GOOD_STATEMENT, reading: 'corrects', statement: 'Orders arriving over WhatsApp should reach the kitchen without Marta or her sister retyping them in the evening rush, so that none are lost.' }
  const conversation = stubConversation(opened())
  conversation.replies.push(turned(GOOD_STATEMENT), turned(revised))
  const j = make({ conversation })
  await begin(j)
  await answer(j)
  assert.equal(j.state.correcting, false)

  j.actions.openCorrection()
  assert.equal(j.state.correcting, true)
  j.actions.closeCorrection()
  assert.equal(j.state.correcting, false)
  j.actions.openCorrection()
  await answer(j, 'Not Marta alone: her sister does it too, and the point is the evening rush.')
  const sent = conversation.nextCalls[1]
  assert.deepEqual(sent.turns.map(t => [t.role, t.kind]), [['compas', 'opening'], ['visitor', 'reply'], ['compas', 'statement'], ['visitor', 'reply']])
  assert.equal(sent.turns[2].statement, GOOD_STATEMENT.statement)
  assert.equal(j.state.correcting, false)
  const now = openStatement(j.state.ctx)
  assert.match(now.statement, /sister/)
  assert.equal(now.reading, 'corrects')
  assert.equal(j.state.ctx.statement, null, 'still not the project statement until confirmed')
  j.actions.confirmStatement()
  assert.match(j.state.ctx.statement.text, /sister/)
  assert.equal(j.state.ctx.statementHistory.length, 1)
})

test('when the conversation has reached its length, the statement as it stands can be kept', async () => {
  const conversation = stubConversation(opened())
  conversation.replies.push(turned(GOOD_STATEMENT), failed('limit'))
  const j = make({ conversation })
  await begin(j)
  await answer(j)
  j.actions.openCorrection()
  await answer(j, 'One more change please.')
  assert.equal(j.state.turn.failure, 'limit')
  assert.equal(latestReply(j.state.ctx).text, 'One more change please.')
  j.actions.confirmStatement()
  assert.equal(isConfirmed(j.state.ctx), true)
  assert.equal(j.state.ctx.statement.text, GOOD_STATEMENT.statement)
  assert.equal(turnsOf(j.state.ctx).filter(t => t.role === 'visitor').length, 3, 'what they wrote stays in the record')
})

test('a long conversation keeps every answer and the original words, in order', async () => {
  const conversation = stubConversation(opened())
  const questions = ['Who retypes them?', 'What did the last lost order cost?', 'Which evening is the worst?', 'Who reads the notebook the next morning?']
  for (const q of questions) conversation.replies.push(turned({ ...GOOD_TURN, question: q }))
  const j = make({ conversation })
  await begin(j)
  const said = ['First answer.', 'Second answer.', 'Third answer.', 'Fourth answer.']
  for (const a of said) await answer(j, a)
  const turns = turnsOf(j.state.ctx)
  assert.deepEqual(turns.filter(t => t.role === 'visitor').map(t => t.text), said)
  assert.deepEqual(turns.filter(t => t.role === 'compas').slice(1).map(t => t.question), questions)
  assert.equal(j.state.ctx.submission.text, WA)
  assert.equal(conversation.nextCalls.at(-1).turns.length, 8, 'the whole conversation travels with the last answer')
  assert.equal(j.state.stage, 'conversation')
})

test('start over clears the conversation along with everything else', async () => {
  const j = make()
  await begin(j)
  await answer(j, 'An answer')
  j.actions.reset()
  assert.equal(j.state.stage, 'welcome')
  assert.equal(latestOpening(j.state.ctx), null)
  assert.equal(j.state.ctx.submission, null)
  assert.equal(j.state.qualification, null)
  assert.equal(j.state.correcting, false)
  assert.equal(j.state.turn.status, 'idle')
  assert.equal(j.__storage.getItem(STORAGE_KEY), null)
})

test('changed words start a new conversation: the old answers and statement are gone', async () => {
  const conversation = stubConversation(opened())
  conversation.replies.push(turned(GOOD_STATEMENT))
  const j = make({ conversation })
  await begin(j)
  await answer(j)
  j.actions.confirmStatement()
  j.actions.back()
  j.actions.setDraft('welcome', 'A different project entirely: a way for volunteers to sign up for shifts')
  conversation.replies.splice(0, conversation.replies.length, turned())
  await j.actions.submit()
  assert.equal(j.state.ctx.statement, null)
  assert.equal(turnsOf(j.state.ctx).length, 1)
  assert.equal(isConfirmed(j.state.ctx), false)
  assert.equal(j.state.stage, 'conversation')
})
