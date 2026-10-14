import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.js'
import { handleConversation, resetConversationState } from '../worker/conversation-handler.js'
import { handleGate, resetGateState } from '../worker/gate-handler.js'
import { issueQualification, signingSecret, verifyQualification } from '../src/domain/conversation/qualification.js'
import { createConversationClient } from '../src/domain/conversation/client.js'
import { createGateClient } from '../src/domain/gate/client.js'
import { byText, hanging, noSleep, res, scripted } from './gate-support.js'
import { GOOD, header, messageBody } from './conversation-support.js'

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

/** Runs the real gate handler against a doubled Jev and returns what the browser would receive. */
async function qualify(text = WA, signals = { intent: 0.93, irrelevance: 0.03, spam: 0.02 }, e = env) {
  const jev = byText({ [text]: signals })
  const r = await handleGate(post('/api/gate', { text }), e, gateDeps(jev.fetchImpl))
  return readJson(r)
}
const open = (body, e = env, deps = {}, headers) => handleConversation(post('/api/conversation', body, { headers }), e, convDeps(deps.fetchImpl, deps))

beforeEach(() => {
  resetGateState()
  resetConversationState()
  logs.length = 0
})

// --- the qualification --------------------------------------------------------------

test('only a PROCEED receives a qualification, and only when a reply can follow', async () => {
  const proceed = await qualify()
  assert.equal(proceed.decision, 'PROCEED')
  assert.equal(typeof proceed.qualification.token, 'string')
  assert.ok(proceed.qualification.expiresAt > Date.now())

  resetGateState()
  const blocked = await qualify('What is the capital of France?', { intent: 0.03, irrelevance: 0.98, spam: 0.02 })
  assert.equal(blocked.decision, 'BLOCK')
  assert.ok(!('qualification' in blocked))

  resetGateState()
  const jev = scripted(res(529, {}))
  const down = await readJson(await handleGate(post('/api/gate', { text: WA }), env, gateDeps(jev.fetchImpl)))
  assert.equal(down.decision, 'UNAVAILABLE')
  assert.ok(!('qualification' in down))

  // No model key, or the route switched off: PROCEED is returned as it always was.
  resetGateState()
  const noKey = await qualify(WA, undefined, { TYPESAFE_API_KEY: JEV_KEY })
  assert.equal(noKey.decision, 'PROCEED')
  assert.ok(!('qualification' in noKey))
  resetGateState()
  const off = await qualify(WA, undefined, { ...env, CONVERSATION_ENABLED: 'false' })
  assert.equal(off.decision, 'PROCEED')
  assert.ok(!('qualification' in off))
})

test('a qualification is bound to the exact words, expires, and cannot be forged', async () => {
  const secret = signingSecret(env)
  const q = await issueQualification({ text: WA, secret, ttlMs: 60000, now: () => 1000 })
  const ok = await verifyQualification({ token: q.token, text: WA, secret, now: () => 2000 })
  assert.equal(ok.ok, true)
  assert.equal((await verifyQualification({ token: q.token, text: WA + ' ', secret, now: () => 2000 })).reason, 'text')
  assert.equal((await verifyQualification({ token: q.token, text: WA, secret, now: () => 61000 })).reason, 'expired')
  assert.equal((await verifyQualification({ token: q.token, text: WA, secret: 'another-secret-entirely', now: () => 2000 })).reason, 'signature')
  const [body, sig] = q.token.split('.')
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), e: 9e15 })).toString('base64url')
  assert.equal((await verifyQualification({ token: `${forged}.${sig}`, text: WA, secret, now: () => 2000 })).reason, 'signature')
  for (const bad of [undefined, '', 'abc', 'a.b.c', `${body}.`, '!!.!!']) {
    assert.equal((await verifyQualification({ token: bad, text: WA, secret, now: () => 2000 })).ok, false)
  }
  assert.equal(await issueQualification({ text: WA, secret: '', ttlMs: 1 }), null, 'nothing is signed without a secret')
})

// --- the conversation route ---------------------------------------------------------

test('a qualified submission gets one model request and its opening', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(200, messageBody()))
  const r = await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  const body = await readJson(r)
  assert.equal(body.status, 'ok')
  assert.deepEqual(body.opening, GOOD)
  assert.equal(body.model, 'claude-sonnet-5-5')
  assert.equal(claude.calls.length, 1)
  assert.equal(header(claude.calls[0].init, 'x-api-key'), CLAUDE_KEY)
  assert.match(claude.calls[0].body.messages[0].content, new RegExp(WA))
  assert.ok(logs.some(l => l.evt === 'conversation' && l.outcome === 'ok' && l.usage.inputTokens === 640))
})

test('nothing is generated without a valid qualification for these words', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(200, messageBody()))
  const refuse = async (body, label) => {
    const r = await open(body, env, { fetchImpl: claude.fetchImpl })
    assert.equal(r.status, 403, label)
    assert.equal((await readJson(r)).failure.kind, 'qualification', label)
  }
  await refuse({ text: WA }, 'no qualification')
  await refuse({ text: WA, qualification: '' }, 'empty qualification')
  await refuse({ text: WA, qualification: 'forged.token' }, 'forged')
  await refuse({ text: WA + ' and more', qualification: qualification.token }, 'a different text')
  await refuse({ text: 'A website', qualification: qualification.token }, 'another text')
  // A token that would have been valid, signed with someone else's secret.
  const other = await issueQualification({ text: WA, secret: 'not-the-servers-secret', ttlMs: 60000 })
  await refuse({ text: WA, qualification: other.token }, 'wrong secret')
  // Expired.
  let t = 1_000_000
  const stale = await issueQualification({ text: WA, secret: signingSecret(env), ttlMs: 1000, now: () => t })
  t += 5000
  const r = await handleConversation(post('/api/conversation', { text: WA, qualification: stale.token }), env, convDeps(claude.fetchImpl, { now: () => t }))
  assert.equal(r.status, 403)
  assert.equal(claude.calls.length, 0, 'no model request was made for any of them')
})

test('BLOCK and UNAVAILABLE cannot reach the model: they never get a qualification to present', async () => {
  const blocked = await qualify('What is the capital of France?', { intent: 0.03, irrelevance: 0.98, spam: 0.02 })
  assert.equal(blocked.decision, 'BLOCK')
  const claude = scripted(res(200, messageBody()))
  const r = await open({ text: 'What is the capital of France?', qualification: blocked.qualification }, env, { fetchImpl: claude.fetchImpl })
  assert.equal(r.status, 403)
  assert.equal(claude.calls.length, 0)
})

test('the same qualification answers from memory: one model request however often it is presented', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(200, messageBody()))
  const statuses = []
  for (let i = 0; i < 4; i++) statuses.push((await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl })).status)
  assert.deepEqual(statuses, [200, 200, 200, 200])
  assert.equal(claude.calls.length, 1)
  assert.ok(logs.some(l => l.outcome === 'cached'))
})

test('simultaneous requests for one qualification, or for the same words, share one model request', async () => {
  const a = await qualify()
  resetGateState()
  const b = await qualify()
  let release
  const gate = new Promise(r => { release = r })
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(1)
    await gate
    return res(200, messageBody())
  }
  const one = open({ text: WA, qualification: a.qualification.token }, env, { fetchImpl })
  const two = open({ text: WA, qualification: a.qualification.token }, env, { fetchImpl })
  const three = open({ text: WA, qualification: b.qualification.token }, env, { fetchImpl })
  await new Promise(r => setTimeout(r, 20))
  release()
  const rs = await Promise.all([one, two, three])
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200])
  assert.equal(calls.length, 1)
  assert.deepEqual(await readJson(rs[0]), await readJson(rs[1]))
})

test('failures are allowed a few more tries, then the visitor is re-checked rather than billed again', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(529, { error: { type: 'overloaded_error', message: 'busy' } }))
  const kinds = []
  for (let i = 0; i < 5; i++) {
    const r = await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl })
    kinds.push([r.status, (await readJson(r)).failure.kind])
  }
  assert.deepEqual(kinds.slice(0, 3), [[503, 'overloaded'], [503, 'overloaded'], [503, 'overloaded']])
  assert.deepEqual(kinds.slice(3), [[403, 'qualification'], [403, 'qualification']])
  assert.equal(claude.calls.length, 3)
})

test('a retry after a failure succeeds and is then remembered', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(500, {}), res(200, messageBody()))
  const first = await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl })
  assert.equal(first.status, 503)
  const second = await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl })
  assert.equal(second.status, 200)
  assert.equal(claude.calls.length, 2)
})

test('model failures reach the visitor as a kind only, never provider detail or the key', async () => {
  const cases = [
    [res(401, { error: { type: 'authentication_error', message: `invalid x-api-key ${CLAUDE_KEY}` } }), 503, 'configuration'],
    [res(429, { error: { type: 'rate_limit_error', message: 'limit' } }), 429, 'rate_limited'],
    [res(500, `stack: at fetch (${CLAUDE_KEY})`), 503, 'provider_error'],
    [res(200, messageBody('not json')), 503, 'malformed'],
    [new Error(`boom ${CLAUDE_KEY}`), 503, 'network'],
  ]
  for (const [response, status, kind] of cases) {
    resetConversationState()
    const { qualification } = await qualify()
    const claude = scripted(response)
    const r = await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl })
    const wire = JSON.stringify([...r.headers.entries()]) + (await r.clone().text())
    assert.equal(r.status, status)
    assert.equal((await readJson(r)).failure.kind, kind)
    assert.ok(!wire.includes(CLAUDE_KEY) && !wire.includes(JEV_KEY))
    assert.ok(!/stack|Traceback| at /.test(wire.replace('at least', '')))
    resetGateState()
  }
  const logged = JSON.stringify(logs)
  assert.ok(!logged.includes(CLAUDE_KEY) && !logged.includes(JEV_KEY))
  assert.ok(!logged.includes('WhatsApp'), 'the visitor text is not logged')
})

test('a stalled model is a timeout, and one request was made', async () => {
  const { qualification } = await qualify()
  const claude = hanging()
  const r = await open({ text: WA, qualification: qualification.token }, { ...env, CONVERSATION_TIMEOUT_MS: '2000' }, { fetchImpl: claude.fetchImpl })
  assert.equal(r.status, 503)
  assert.equal((await readJson(r)).failure.kind, 'timeout')
  assert.equal(claude.calls.length, 1)
})

test('a missing model key is unavailable (configuration) and nothing is requested', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(200, messageBody()))
  const r = await open({ text: WA, qualification: qualification.token }, { TYPESAFE_API_KEY: JEV_KEY }, { fetchImpl: claude.fetchImpl })
  assert.equal(r.status, 503)
  assert.equal((await readJson(r)).failure.kind, 'configuration')
  assert.equal(claude.calls.length, 0)
})

test('the route can be switched off without a deploy', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(200, messageBody()))
  const r = await open({ text: WA, qualification: qualification.token }, { ...env, CONVERSATION_ENABLED: 'false' }, { fetchImpl: claude.fetchImpl })
  assert.equal(r.status, 503)
  assert.equal(claude.calls.length, 0)
})

test('empty, oversized and malformed bodies are rejected before anything else', async () => {
  const claude = scripted(res(200, messageBody()))
  const reject = async (req, status, error) => {
    const r = await handleConversation(req, env, convDeps(claude.fetchImpl))
    assert.equal(r.status, status)
    assert.equal((await readJson(r)).error, error)
  }
  await reject(post('/api/conversation', { text: '', qualification: 'x' }), 400, 'empty')
  await reject(post('/api/conversation', { text: '  \n ', qualification: 'x' }), 400, 'empty')
  await reject(post('/api/conversation', { text: 'x'.repeat(2001), qualification: 'x' }), 400, 'too_long')
  await reject(post('/api/conversation', { text: 'x'.repeat(40000), qualification: 'x' }), 413, 'too_long')
  await reject(post('/api/conversation', { text: 42, qualification: 'x' }), 400, 'not_text')
  await reject(post('/api/conversation', null, { raw: '{nope' }), 400, 'bad_request')
  await reject(post('/api/conversation', null, { raw: '[1]' }), 400, 'bad_request')
  assert.equal(claude.calls.length, 0)
})

test('only POST from the site’s own origin is accepted', async () => {
  const { qualification } = await qualify()
  const claude = scripted(res(200, messageBody()))
  const get = await handleConversation(new Request(`${ORIGIN}/api/conversation`), env, convDeps(claude.fetchImpl))
  assert.equal(get.status, 405)
  const cross = await open({ text: WA, qualification: qualification.token }, env, { fetchImpl: claude.fetchImpl }, { origin: 'https://evil.example' })
  assert.equal(cross.status, 403)
  assert.equal(claude.calls.length, 0)
})

test('a visitor over the rate limit is refused before any model request', async () => {
  const claude = scripted(res(200, messageBody()))
  const limited = { ...env, CONVERSATION_RATE_MAX: '2' }
  const statuses = []
  for (let i = 0; i < 4; i++) {
    resetGateState()
    const { qualification } = await qualify(`idea number ${i}`)
    statuses.push((await open({ text: `idea number ${i}`, qualification: qualification.token }, limited, { fetchImpl: claude.fetchImpl })).status)
  }
  assert.deepEqual(statuses, [200, 200, 429, 429])
  assert.equal(claude.calls.length, 2)
  const binding = { limit: async () => ({ success: false }) }
  const { qualification } = await qualify()
  const r = await open({ text: WA, qualification: qualification.token }, { ...env, CONVERSATION_LIMITER: binding }, { fetchImpl: claude.fetchImpl })
  assert.equal(r.status, 429)
  assert.equal(r.headers.get('retry-after'), '60')
})

test('the router sends /api/conversation to its handler', async () => {
  const claude = scripted(res(200, messageBody()))
  const jev = byText({})
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => (String(url).includes('anthropic') ? claude.fetchImpl(url, init) : jev.fetchImpl(url, init))
  try {
    const g = await worker.fetch(post('/api/gate', { text: WA }), env)
    const { qualification } = await readJson(g)
    const r = await worker.fetch(post('/api/conversation', { text: WA, qualification: qualification.token }), env)
    assert.equal(r.status, 200)
    assert.equal((await readJson(r)).status, 'ok')
  } finally {
    globalThis.fetch = original
  }
})

// --- the browser-side client against the real handlers ---------------------------------

test('client: gate then conversation, end to end, exactly what the server returned', async () => {
  const jev = byText({ [WA]: { intent: 0.93, irrelevance: 0.03, spam: 0.02 } })
  const claude = scripted(res(200, messageBody()))
  const wire = (deps, handler) => async (url, init) => handler(new Request(`${ORIGIN}${url}`, { ...init, headers: { ...init.headers, origin: ORIGIN } }), env, deps)
  const gate = createGateClient({ fetchImpl: wire(gateDeps(jev.fetchImpl), handleGate) })
  const conversation = createConversationClient({ fetchImpl: wire(convDeps(claude.fetchImpl), handleConversation) })

  const g = await gate.classify(WA)
  assert.equal(g.result.decision, 'PROCEED')
  assert.equal(typeof g.qualification.token, 'string')
  const c = await conversation.open({ text: WA, qualification: g.qualification.token })
  assert.equal(c.ok, true)
  assert.deepEqual(c.opening, GOOD)
  assert.deepEqual(c.usage, { inputTokens: 640, outputTokens: 150 })

  // A bad token is a failure, not an opening.
  const bad = await conversation.open({ text: WA, qualification: 'nope' })
  assert.deepEqual(bad, { ok: false, failure: 'qualification' })
})

test('client: anything that is not a well-formed opening is a failure; it never throws', async () => {
  const t = async (f) => createConversationClient({ fetchImpl: f }).open({ text: WA, qualification: 'q' })
  assert.deepEqual(await t(async () => { throw new TypeError('Failed to fetch') }), { ok: false, failure: 'network' })
  assert.deepEqual(await t(async () => new Response('<html>502</html>', { status: 502 })), { ok: false, failure: 'malformed' })
  assert.deepEqual(await t(async () => new Response('{}', { status: 429 })), { ok: false, failure: 'rate_limited' })
  // A 200 whose opening breaks the structure is not shown.
  const bodyWith = opening => new Response(JSON.stringify({ schema: 'compascaribe.conversation/1', status: 'ok', opening, model: 'm', usage: null, latencyMs: 1 }), { status: 200 })
  assert.equal((await t(async () => bodyWith({ ...GOOD, question: 'One? Two?' }))).ok, false)
  assert.equal((await t(async () => bodyWith({ ...GOOD, reflection: '' }))).ok, false)
  assert.equal((await t(async () => bodyWith(GOOD))).ok, true)
  const stalled = await createConversationClient({ fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('x')))), timeoutMs: 20 }).open({ text: WA, qualification: 'q' })
  assert.deepEqual(stalled, { ok: false, failure: 'timeout' })
})
