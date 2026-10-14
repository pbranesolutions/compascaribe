import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handleConversation, resetConversationState } from '../worker/conversation-handler.js'
import { handleGate, resetGateState } from '../worker/gate-handler.js'
import { issueQualification, signingSecret, verifyQualification } from '../src/domain/conversation/qualification.js'
import { createConversationClient } from '../src/domain/conversation/client.js'
import { createGateClient } from '../src/domain/gate/client.js'
import { wireTurns } from '../src/domain/conversation/history.js'
import { byText, noSleep, res, scripted } from './gate-support.js'
import { GOOD, GOOD_STATEMENT, GOOD_TURN, header, HISTORY, messageBody } from './conversation-support.js'

// The conversation after the first reply, through the real Worker handlers (the
// real SDK and the real validation in front of a doubled network).

const JEV_KEY = 'tsk-secret-do-not-leak'
const CLAUDE_KEY = 'sk-ant-secret-do-not-leak'
const ORIGIN = 'https://compascaribe.com'
const env = { TYPESAFE_API_KEY: JEV_KEY, ANTHROPIC_API_KEY: CLAUDE_KEY }
const WA = 'We lose track of orders that come in over WhatsApp and someone has to retype them into a notebook'
const logs = []
const gateDeps = fetchImpl => ({ fetchImpl, sleep: noSleep, log: e => logs.push(e) })
const convDeps = (fetchImpl, extra = {}) => ({ fetchImpl, log: e => logs.push(e), ...extra })

const post = (path, body, { headers = {}, raw } = {}) => new Request(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...headers },
  body: raw ?? JSON.stringify(body),
})
const readJson = async r => JSON.parse(await r.text())

async function qualify(text = WA, signals = { intent: 0.93, irrelevance: 0.03, spam: 0.02 }, e = env) {
  const jev = byText({ [text]: signals })
  const r = await handleGate(post('/api/gate', { text }), e, gateDeps(jev.fetchImpl))
  return readJson(r)
}
const openRequest = (body, e = env, fetchImpl) => handleConversation(post('/api/conversation', body), e, convDeps(fetchImpl))
const turnBody = (turn = GOOD_TURN, opts) => messageBody(turn, opts)
const nextTurn = (token, turns, fetchImpl, { text = WA, understanding = null, e = env } = {}) =>
  handleConversation(post('/api/conversation', { text, qualification: token, turns, understanding }), e, convDeps(fetchImpl))
const claimsOf = token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())

/** The history a browser holds after the opening and `replies.length` answers: a follow-up between each answer. */
const history = (...replies) => {
  const turns = [{ role: 'compas', kind: 'opening', reflection: GOOD.reflection, question: GOOD.question, analysis: { describes: GOOD.describes, uncertainty: GOOD.uncertainty, explores: GOOD.explores } }]
  replies.forEach((text, i) => {
    turns.push({ role: 'visitor', kind: 'reply', text })
    if (i < replies.length - 1) turns.push({ role: 'compas', kind: 'followup', reflection: `Reading number ${i} of what was said about orders.`, question: `Question number ${i} about the orders?` })
  })
  return turns
}

/** The opening, through the real handlers: returns the renewed qualification the conversation continues under. */
async function opening(e = env) {
  const { qualification } = await qualify(WA, undefined, e)
  const claude = scripted(res(200, messageBody()))
  const r = await openRequest({ text: WA, qualification: qualification.token }, e, claude.fetchImpl)
  return { body: await readJson(r), status: r.status, first: qualification }
}

beforeEach(() => {
  resetGateState()
  resetConversationState()
  logs.length = 0
})

test('every reply comes back with a renewed qualification that carries the signed count', async () => {
  const { body, first } = await opening()
  assert.equal(body.status, 'ok')
  assert.deepEqual(body.progress, { replies: 1, limit: 10 })
  const before = claimsOf(first.token)
  const after = claimsOf(body.qualification.token)
  assert.equal(before.n, 0)
  assert.equal(after.n, 1)
  assert.equal(after.j, before.j, 'the same conversation')
  assert.equal(after.h, before.h, 'the same words')
  assert.equal(after.x, before.x, 'the lifetime counts from the first qualification')
  assert.ok(body.qualification.expiresAt > Date.now() + 20 * 60 * 1000, 'a visitor may think for a while')
  assert.ok(!JSON.stringify(body).includes(CLAUDE_KEY))
})

test('a follow-up: the answer and the conversation so far, one model request, the next move and a renewed qualification', async () => {
  const { body } = await opening()
  const claude = scripted(res(200, turnBody()))
  const r = await nextTurn(body.qualification.token, history('Marta retypes them every evening, and some get lost.'), claude.fetchImpl)
  assert.equal(r.status, 200)
  const out = await readJson(r)
  assert.equal(out.status, 'ok')
  assert.deepEqual(out.turn, GOOD_TURN)
  assert.equal(out.opening, undefined)
  assert.deepEqual(out.progress, { replies: 2, limit: 10 })
  assert.equal(claimsOf(out.qualification.token).n, 2)
  assert.equal(claude.calls.length, 1)
  assert.equal(header(claude.calls[0].init, 'x-api-key'), CLAUDE_KEY)
  const sent = claude.calls[0].body.messages[0].content
  assert.match(sent, new RegExp(WA))
  assert.match(sent, /Marta retypes them every evening/)
  assert.match(sent, /exchanges so far: 1/)
  assert.match(sent, /converge: false/)
  assert.match(sent, /final: false/)
  const logged = logs.find(l => l.evt === 'conversation' && l.kind === 'turn' && l.outcome === 'ok')
  assert.equal(logged.reading, 'answers')
  assert.equal(logged.move, 'ask')
  assert.equal(logged.used, 2)
  assert.ok(!JSON.stringify(logs).includes('Marta'), 'the visitor text is not logged')
})

test('a long conversation: each renewal counts, and the agent is told to converge once it has asked enough', async () => {
  let { body } = await opening()
  const replies = ['one about orders', 'two about orders', 'three about orders', 'four about orders', 'five about orders']
  const flags = []
  for (let i = 1; i <= 5; i++) {
    const claude = scripted(res(200, turnBody({ ...GOOD_TURN, question: `A different question number ${i} about the kitchen?` })))
    const r = await nextTurn(body.qualification.token, history(...replies.slice(0, i)), claude.fetchImpl)
    assert.equal(r.status, 200, `reply ${i}`)
    body = await readJson(r)
    flags.push(claude.calls[0].body.messages[0].content.match(/converge: (\w+)/)[1])
    assert.equal(claimsOf(body.qualification.token).n, i + 1)
  }
  assert.deepEqual(flags, ['false', 'false', 'false', 'false', 'false'])
  const claude = scripted(res(200, turnBody(GOOD_STATEMENT)))
  const six = await nextTurn(body.qualification.token, history(...replies, 'six about orders'), claude.fetchImpl)
  assert.equal(six.status, 200)
  assert.match(claude.calls[0].body.messages[0].content, /converge: true/)
})

test('the last permitted reply must be the statement, and after it nothing is generated', async () => {
  const e = { ...env, CONVERSATION_MAX_REPLIES: '3' }
  let { body } = await opening(e)
  const second = scripted(res(200, turnBody()))
  const r2 = await nextTurn(body.qualification.token, history('First answer about the orders.'), second.fetchImpl, { e })
  assert.equal(r2.status, 200)
  body = await readJson(r2)
  const turns = history('First answer about the orders.', 'Second answer about the orders.')
  // Reply three of three: a question is not acceptable, so it is not shown.
  const asking = scripted(res(200, turnBody({ ...GOOD_TURN, question: 'A different question about the kitchen orders?' })))
  const refused = await nextTurn(body.qualification.token, turns, asking.fetchImpl, { e })
  assert.equal(refused.status, 503)
  assert.equal((await readJson(refused)).failure.kind, 'malformed')
  assert.match(asking.calls[0].body.messages[0].content, /final: true/)
  // A statement is.
  resetConversationState()
  const stating = scripted(res(200, turnBody(GOOD_STATEMENT)))
  const r3 = await nextTurn(body.qualification.token, turns, stating.fetchImpl, { e })
  assert.equal(r3.status, 200)
  const done = await readJson(r3)
  assert.equal(done.turn.move, 'statement')
  assert.deepEqual(done.progress, { replies: 3, limit: 3 })
  // The budget is spent: a correction cannot buy another reply.
  const claude = scripted(res(200, turnBody(GOOD_STATEMENT)))
  const corrected = [...turns, { role: 'compas', kind: 'statement', reflection: '', question: 'Right?', statement: GOOD_STATEMENT.statement }, { role: 'visitor', kind: 'reply', text: 'Not quite, change it.' }]
  const over = await nextTurn(done.qualification.token, corrected, claude.fetchImpl, { e })
  assert.equal(over.status, 409)
  assert.equal((await readJson(over)).failure.kind, 'limit')
  assert.equal(claude.calls.length, 0)
  assert.ok(logs.some(l => l.outcome === 'limit'))
})

test('the signed count cannot be lowered by sending less history', async () => {
  const e = { ...env, CONVERSATION_MAX_REPLIES: '4' }
  const secret = signingSecret(e)
  // A conversation that has had three replies, presenting a history of one.
  const spent = await issueQualification({ text: WA, secret, ttlMs: 60000, turn: 3 })
  const claude = scripted(res(200, turnBody(GOOD_STATEMENT)))
  const r = await nextTurn(spent.token, history('Only this.'), claude.fetchImpl, { e })
  assert.equal(r.status, 200)
  assert.match(claude.calls[0].body.messages[0].content, /final: true/, 'treated as the last reply, whatever the history says')
  const over = await issueQualification({ text: WA, secret, ttlMs: 60000, turn: 4 })
  const refused = await nextTurn(over.token, history('Only this.'), claude.fetchImpl, { e })
  assert.equal(refused.status, 409)
  assert.equal(claude.calls.length, 1)
})

test('a renewed qualification continues a conversation; it cannot ask for a first reply again', async () => {
  const { body } = await opening()
  const claude = scripted(res(200, messageBody()))
  const r = await openRequest({ text: WA, qualification: body.qualification.token }, env, claude.fetchImpl)
  assert.equal(r.status, 403)
  assert.equal((await readJson(r)).failure.kind, 'qualification')
  assert.equal(claude.calls.length, 0)
})

test('a reply needs its own conversation: other words, a forged, expired or missing token are refused', async () => {
  const { body } = await opening()
  const claude = scripted(res(200, turnBody()))
  const refuse = async (token, turns, text, label) => {
    const r = await nextTurn(token, turns, claude.fetchImpl, { text })
    assert.equal(r.status, 403, label)
    assert.equal((await readJson(r)).failure.kind, 'qualification', label)
  }
  const h = history('An answer about the orders.')
  await refuse(body.qualification.token, h, 'Something else entirely', 'other words')
  await refuse('forged.token', h, WA, 'forged')
  await refuse(undefined, h, WA, 'missing')
  const stale = await issueQualification({ text: WA, secret: signingSecret(env), ttlMs: 1000, now: () => 1_000_000, turn: 1 })
  const r = await handleConversation(post('/api/conversation', { text: WA, qualification: stale.token, turns: h }), env, convDeps(claude.fetchImpl, { now: () => 1_010_000 }))
  assert.equal(r.status, 403)
  assert.equal(claude.calls.length, 0)
})

test('a conversation has a total lifetime, however often it is renewed', async () => {
  const secret = signingSecret(env)
  const t0 = 5_000_000
  const first = await issueQualification({ text: WA, secret, ttlMs: 15 * 60 * 1000, now: () => t0 })
  // Renewed shortly before the lifetime ends: valid for what is left, not for a fresh half hour.
  const lifetime = 3 * 60 * 60 * 1000
  const late = t0 + lifetime - 10 * 60 * 1000
  const renewed = await issueQualification({ text: WA, secret, ttlMs: 30 * 60 * 1000, now: () => late, id: claimsOf(first.token).j, turn: 4, startedAt: t0, maxLifetimeMs: lifetime })
  assert.equal(renewed.expiresAt, t0 + lifetime)
  const verified = await verifyQualification({ token: renewed.token, text: WA, secret, now: () => late })
  assert.equal(verified.turn, 4)
  assert.equal(verified.startedAt, t0)
  assert.equal((await verifyQualification({ token: renewed.token, text: WA, secret, now: () => t0 + lifetime + 1 })).reason, 'expired')
})

test('malformed or oversized histories are refused before anything else', async () => {
  const { body } = await opening()
  const claude = scripted(res(200, turnBody()))
  const bad = async (turns, error, understanding) => {
    const r = await nextTurn(body.qualification.token, turns, claude.fetchImpl, { understanding })
    assert.equal(r.status, 400, error)
    assert.equal((await readJson(r)).error, error)
  }
  await bad('not a list', 'invalid_history')
  await bad(history('A').slice(0, 1), 'invalid_history')
  await bad([{ role: 'visitor', kind: 'reply', text: 'x' }], 'invalid_history')
  await bad(history('  '), 'empty_reply')
  await bad(history('x'.repeat(481)), 'reply_too_long')
  await bad(history('Fine'), 'invalid_history', { purpose: 42 })
  assert.equal(claude.calls.length, 0)
})

test('the same step again is answered from memory; an edited answer is a new step', async () => {
  const { body } = await opening()
  const claude = scripted(res(200, turnBody()), res(200, turnBody({ ...GOOD_TURN, question: 'Who in the kitchen reads the notebook each morning?' })))
  const turns = history('Marta retypes them every evening.')
  const a = await readJson(await nextTurn(body.qualification.token, turns, claude.fetchImpl))
  const b = await readJson(await nextTurn(body.qualification.token, turns, claude.fetchImpl))
  assert.deepEqual(a.turn, b.turn)
  assert.equal(claude.calls.length, 1)
  assert.ok(logs.some(l => l.outcome === 'cached' && l.kind === 'turn'))
  // The visitor took the answer back and wrote it differently: that is generated.
  const edited = await readJson(await nextTurn(body.qualification.token, history('Marta and her sister retype them every evening.'), claude.fetchImpl))
  assert.equal(edited.turn.question, 'Who in the kitchen reads the notebook each morning?')
  assert.equal(claude.calls.length, 2)
})

test('simultaneous requests for the same follow-up share one model request', async () => {
  const { body } = await opening()
  let release
  const gate = new Promise(r => { release = r })
  const calls = []
  const fetchImpl = async () => { calls.push(1); await gate; return res(200, turnBody()) }
  const turns = history('Marta retypes them every evening.')
  const ps = [1, 2, 3].map(() => nextTurn(body.qualification.token, turns, fetchImpl))
  await new Promise(r => setTimeout(r, 20))
  release()
  const rs = await Promise.all(ps)
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200])
  assert.equal(calls.length, 1)
})

test('failures of a follow-up are a kind only, are retried within a bound, then the visitor is re-checked', async () => {
  const { body } = await opening()
  const claude = scripted(res(500, `stack: at fetch (${CLAUDE_KEY})`))
  const turns = history('Marta retypes them every evening.')
  const kinds = []
  for (let i = 0; i < 5; i++) {
    const r = await nextTurn(body.qualification.token, turns, claude.fetchImpl)
    const wire = JSON.stringify([...r.headers.entries()]) + (await r.clone().text())
    assert.ok(!wire.includes(CLAUDE_KEY))
    kinds.push([r.status, (await readJson(r)).failure.kind])
  }
  assert.deepEqual(kinds, [[503, 'provider_error'], [503, 'provider_error'], [503, 'provider_error'], [403, 'qualification'], [403, 'qualification']])
  assert.equal(claude.calls.length, 3)
  // A fresh qualification for the same words and history picks the conversation up where it was.
  resetGateState()
  const fresh = (await qualify()).qualification
  const ok = scripted(res(200, turnBody()))
  const r = await nextTurn(fresh.token, turns, ok.fetchImpl)
  assert.equal(r.status, 200)
  assert.equal(claimsOf((await readJson(r)).qualification.token).n, 2, 'counted from what the conversation has had')
})

test('a stated purpose can be corrected, and the agent is told a statement was already proposed', async () => {
  const { body } = await opening()
  const turns = [
    ...history('Marta retypes them every evening.').slice(0, 2),
    { role: 'compas', kind: 'statement', reflection: '', question: GOOD_STATEMENT.question, statement: GOOD_STATEMENT.statement },
    { role: 'visitor', kind: 'reply', text: 'Not Marta alone: her sister does it too, and the point is the evening rush.' },
  ]
  const revised = 'Orders arriving over WhatsApp should reach the kitchen without Marta or her sister retyping them in the evening rush, so that none are lost.'
  const claude = scripted(res(200, turnBody({ ...GOOD_STATEMENT, reading: 'corrects', statement: revised })))
  const r = await nextTurn(body.qualification.token, turns, claude.fetchImpl)
  assert.equal(r.status, 200)
  const out = await readJson(r)
  assert.equal(out.turn.reading, 'corrects')
  assert.match(out.turn.statement, /sister/)
  const sent = claude.calls[0].body.messages[0].content
  assert.match(sent, /statement already proposed: yes/)
  assert.match(sent, /<visitor responding_to="statement">\nNot Marta alone/)
})

test('a visitor who repeats themselves is noted for the agent', async () => {
  const { body } = await opening()
  const turns = [
    ...history('The phone rings while I am cutting and it is annoying.'),
    { role: 'compas', kind: 'followup', reflection: 'The phone rings while you cut hair.', question: 'What did the caller want?' },
    { role: 'visitor', kind: 'reply', text: 'The phone rings while I am cutting and it is annoying.' },
  ]
  const claude = scripted(res(200, turnBody(GOOD_STATEMENT)))
  const r = await nextTurn(body.qualification.token, turns, claude.fetchImpl)
  assert.equal(r.status, 200)
  assert.match(claude.calls[0].body.messages[0].content, /repeated: true/)
})

test('the client: opening, follow-up and correction end to end against the real handlers', async () => {
  const jev = byText({ [WA]: { intent: 0.93, irrelevance: 0.03, spam: 0.02 } })
  const claude = scripted(res(200, messageBody()), res(200, turnBody()), res(200, turnBody(GOOD_STATEMENT)))
  const wire = (deps, handler) => async (url, init) => handler(new Request(`${ORIGIN}${url}`, { ...init, headers: { ...init.headers, origin: ORIGIN } }), env, deps)
  const gate = createGateClient({ fetchImpl: wire(gateDeps(jev.fetchImpl), handleGate) })
  const conversation = createConversationClient({ fetchImpl: wire(convDeps(claude.fetchImpl), handleConversation) })

  const g = await gate.classify(WA)
  const first = await conversation.open({ text: WA, qualification: g.qualification.token })
  assert.equal(first.ok, true)
  assert.equal(first.kind, 'opening')
  assert.equal(typeof first.qualification.token, 'string')
  assert.deepEqual(first.progress, { replies: 1, limit: 10 })

  const turns = wireTurns([
    { role: 'compas', kind: 'opening', reflection: first.opening.reflection, question: first.opening.question, analysis: { describes: first.opening.describes, uncertainty: first.opening.uncertainty, explores: first.opening.explores } },
    { role: 'visitor', kind: 'reply', text: 'Marta retypes them every evening, and some get lost.' },
  ])
  const second = await conversation.next({ text: WA, qualification: first.qualification.token, turns })
  assert.equal(second.ok, true)
  assert.equal(second.kind, 'turn')
  assert.equal(second.turn.question, GOOD_TURN.question)
  assert.deepEqual(second.turn.understanding.coverage, GOOD_TURN.understanding.coverage)

  const turns3 = [...turns, ...wireTurns([{ role: 'compas', kind: 'followup', reflection: second.turn.reflection, question: second.turn.question }, { role: 'visitor', kind: 'reply', text: 'We lost three orders last Friday.' }])]
  const third = await conversation.next({ text: WA, qualification: second.qualification.token, turns: turns3, understanding: second.turn.understanding })
  assert.equal(third.kind, 'turn')
  assert.equal(third.turn.move, 'statement')
  assert.equal(third.turn.statement, GOOD_STATEMENT.statement)

  // Refusals: a bad history, a bad token.
  assert.deepEqual(await conversation.next({ text: WA, qualification: third.qualification.token, turns: 'nope' }), { rejected: 'invalid_history' })
  assert.deepEqual(await conversation.next({ text: WA, qualification: 'nope', turns }), { ok: false, failure: 'qualification' })
})

test('client: a follow-up that is not a well-formed turn is a failure; it never throws', async () => {
  const t = async (f) => createConversationClient({ fetchImpl: f }).next({ text: WA, qualification: 'q', turns: HISTORY })
  assert.deepEqual(await t(async () => { throw new TypeError('Failed to fetch') }), { ok: false, failure: 'network' })
  assert.deepEqual(await t(async () => new Response('<html>502</html>', { status: 502 })), { ok: false, failure: 'malformed' })
  const envelope = turn => new Response(JSON.stringify({ schema: 'compascaribe.conversation/1', status: 'ok', turn, qualification: { token: 'x', expiresAt: 1 }, model: 'm', usage: null, latencyMs: 1 }), { status: 200 })
  assert.equal((await t(async () => envelope(GOOD_TURN))).ok, true)
  assert.equal((await t(async () => envelope({ ...GOOD_TURN, question: 'One? Two?' }))).ok, false)
  assert.equal((await t(async () => envelope({ ...GOOD_TURN, understanding: null }))).ok, false)
  const limit = new Response(JSON.stringify({ schema: 'compascaribe.conversation/1', status: 'unavailable', failure: { kind: 'limit' } }), { status: 409 })
  assert.deepEqual(await t(async () => limit), { ok: false, failure: 'limit' })
})
