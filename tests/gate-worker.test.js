import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.js'
import { handleGate, resetGateState } from '../worker/gate-handler.js'
import { createGateClient, parseGateResult } from '../src/domain/gate/client.js'
import { byText, jevBody, noSleep, res, scripted } from './gate-support.js'

const KEY = 'tsk-secret-do-not-leak'
const ORIGIN = 'https://compascaribe.com'
const env = { TYPESAFE_API_KEY: KEY }
const logs = []
const deps = (fetchImpl, extra = {}) => ({ fetchImpl, sleep: noSleep, log: e => logs.push(e), ...extra })

function post(body, { headers = {}, url = `${ORIGIN}/api/gate`, raw } = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: raw ?? JSON.stringify(body),
  })
}
const readJson = async r => JSON.parse(await r.text())

beforeEach(() => {
  resetGateState()
  logs.length = 0
})

test('a valid submission returns the decision and the full basis, using the real endpoint shape', async () => {
  const { fetchImpl, calls } = byText({ 'Automate invoicing': { intent: 0.93, irrelevance: 0.03, spam: 0.02 } })
  const r = await handleGate(post({ text: 'Automate invoicing' }), env, deps(fetchImpl))
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  const body = await readJson(r)
  assert.equal(body.decision, 'PROCEED')
  assert.deepEqual(body.signals, { intent: 0.93, irrelevance: 0.03, spam: 0.02 })
  assert.equal(body.model, 'jev-1.13.0')
  assert.deepEqual(body.usage, { inputTokens: 296, outputTokens: 20 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`)
  // The decision survives the wire and the browser-side parser unchanged.
  assert.deepEqual(parseGateResult(body), body)
})

test('BLOCK is a 200 result; UNAVAILABLE is a 503 with the same envelope', async () => {
  const blocked = byText({ 'hi': { intent: 0.02, irrelevance: 0.97, spam: 0.1 } })
  const r1 = await handleGate(post({ text: 'hi' }), env, deps(blocked.fetchImpl))
  assert.equal(r1.status, 200)
  assert.equal((await readJson(r1)).decision, 'BLOCK')
  const down = scripted(res(529, {}))
  const r2 = await handleGate(post({ text: 'build me an app' }), env, deps(down.fetchImpl))
  assert.equal(r2.status, 503)
  const body = await readJson(r2)
  assert.equal(body.decision, 'UNAVAILABLE')
  assert.equal(body.failure.kind, 'overloaded')
})

test('the API key stays server-side: never in any response body or header, or in the log', async () => {
  const cases = [
    scripted(res(401, { error: `bad key ${KEY}` })),
    scripted(res(500, `stack: at fetch (${KEY})`)),
    scripted(new Error(`boom ${KEY}`)),
    scripted(res(200, jevBody({ intent: 0.9, irrelevance: 0, spam: 0 }))),
  ]
  for (const c of cases) {
    const r = await handleGate(post({ text: 'Automate invoicing' }), env, deps(c.fetchImpl))
    const wire = JSON.stringify([...r.headers.entries()]) + (await r.text())
    assert.ok(!wire.includes(KEY))
    assert.ok(!/stack|Traceback| at /.test(wire.replace('at least', '')))
    resetGateState()
  }
  assert.ok(!JSON.stringify(logs).includes(KEY))
  assert.ok(!JSON.stringify(logs).includes('Automate invoicing'), 'the visitor text is not logged')
})

test('a missing key is UNAVAILABLE (configuration) and no upstream call is made', async () => {
  const { fetchImpl, calls } = scripted(res(200, {}))
  const r = await handleGate(post({ text: 'Automate invoicing' }), {}, deps(fetchImpl))
  assert.equal(r.status, 503)
  assert.equal((await readJson(r)).failure.kind, 'configuration')
  assert.equal(calls.length, 0)
})

test('empty, whitespace-only, oversized and malformed bodies are rejected before Jev', async () => {
  const { fetchImpl, calls } = scripted(res(200, {}))
  const reject = async (req, status, error) => {
    const r = await handleGate(req, env, deps(fetchImpl))
    assert.equal(r.status, status)
    assert.equal((await readJson(r)).error, error)
  }
  await reject(post({ text: '' }), 400, 'empty')
  await reject(post({ text: '   \n ' }), 400, 'empty')
  await reject(post({ text: 'x'.repeat(2001) }), 400, 'too_long')
  await reject(post({ text: 'x'.repeat(40000) }), 413, 'too_long')
  await reject(post({ text: 42 }), 400, 'not_text')
  await reject(post({}), 400, 'not_text')
  await reject(post(null, { raw: '{not json' }), 400, 'bad_request')
  await reject(post(null, { raw: '[1,2]' }), 400, 'bad_request')
  assert.equal(calls.length, 0)
})

test('only POST from the site’s own origin is accepted', async () => {
  const { fetchImpl, calls } = scripted(res(200, jevBody({ intent: 0.9, irrelevance: 0, spam: 0 })))
  const get = await handleGate(new Request(`${ORIGIN}/api/gate`, { method: 'GET' }), env, deps(fetchImpl))
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('allow'), 'POST')
  const cross = await handleGate(post({ text: 'Automate invoicing' }, { headers: { origin: 'https://evil.example' } }), env, deps(fetchImpl))
  assert.equal(cross.status, 403)
  assert.equal(calls.length, 0)
})

test('identical submissions arriving together share one Jev request', async () => {
  let release
  const gate = new Promise(r => { release = r })
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(1)
    await gate
    return res(200, jevBody({ intent: 0.9, irrelevance: 0.05, spam: 0.01 }))
  }
  const a = handleGate(post({ text: 'Automate invoicing' }), env, deps(fetchImpl))
  const b = handleGate(post({ text: 'Automate invoicing' }), env, deps(fetchImpl))
  const c = handleGate(post({ text: 'Something else entirely' }), env, deps(fetchImpl))
  await new Promise(r => setTimeout(r, 10))
  release()
  const [ra, rb, rc] = await Promise.all([a, b, c])
  assert.deepEqual([ra.status, rb.status, rc.status], [200, 200, 200])
  assert.equal(calls.length, 2, 'two distinct texts, two requests')
  assert.deepEqual(await readJson(ra), await readJson(rb))
})

test('a visitor over the rate limit gets a 429 UNAVAILABLE (rate_limited) and no upstream call', async () => {
  const { fetchImpl, calls } = byText({})
  const limited = { ...env, GATE_RATE_MAX: '2' }
  const statuses = []
  for (let i = 0; i < 4; i++) statuses.push((await handleGate(post({ text: `idea number ${i}` }), limited, deps(fetchImpl))).status)
  assert.deepEqual(statuses, [200, 200, 429, 429])
  assert.equal(calls.length, 2)
  const r = await handleGate(post({ text: 'one more' }), limited, deps(fetchImpl))
  assert.equal(r.headers.get('retry-after'), '60')
  assert.equal((await readJson(r)).failure.kind, 'rate_limited')
  // A different visitor is unaffected.
  const other = await handleGate(post({ text: 'fresh' }, { headers: { 'cf-connecting-ip': '198.51.100.9' } }), limited, deps(fetchImpl))
  assert.equal(other.status, 200)
})

test('the Cloudflare rate-limit binding is honoured when present', async () => {
  const { fetchImpl, calls } = byText({})
  const seen = []
  const binding = { limit: async ({ key }) => { seen.push(key); return { success: false } } }
  const r = await handleGate(post({ text: 'Automate invoicing' }), { ...env, GATE_LIMITER: binding }, deps(fetchImpl))
  assert.equal(r.status, 429)
  assert.deepEqual(seen, ['203.0.113.7'])
  assert.equal(calls.length, 0)
})

test('the model and thresholds are configurable through the environment', async () => {
  const { fetchImpl, calls } = byText({ x1: { intent: 0.5, irrelevance: 0, spam: 0.8 } })
  const r = await handleGate(post({ text: 'x1' }), { ...env, JEV_MODEL: 'jev-1.13.0', GATE_SPAM_BLOCK: '0.75' }, deps(fetchImpl))
  assert.equal(calls[0].body.model, 'jev-1.13.0')
  const body = await readJson(r)
  assert.equal(body.decision, 'BLOCK')
  assert.equal(body.requestedModel, 'jev-1.13.0')
  assert.equal(body.thresholds.spamBlock, 0.75)
})

test('the router sends only /api/gate to the gate and everything else is not the Worker’s business', async () => {
  const { fetchImpl } = byText({})
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    const r = await worker.fetch(post({ text: 'Automate invoicing' }), { ...env, GATE_RATE_MAX: '50' })
    assert.equal(r.status, 200)
  } finally {
    globalThis.fetch = original
  }
  const nf = await worker.fetch(new Request(`${ORIGIN}/api/other`), env)
  assert.equal(nf.status, 404)
  const asset = await worker.fetch(new Request(`${ORIGIN}/`), { ASSETS: { fetch: async () => new Response('<html>') } })
  assert.equal(await asset.text(), '<html>')
})

// --- the browser-side client, against the real handler --------------------------------

function clientFor(fetchImpl, extra = {}) {
  const wire = async (url, init) => handleGate(new Request(`${ORIGIN}${url}`, { ...init, headers: { ...init.headers, origin: ORIGIN } }), env, deps(fetchImpl, extra))
  return createGateClient({ fetchImpl: wire })
}

test('client: shows exactly what the Worker decided', async () => {
  const { fetchImpl } = byText({ 'Who won the 1998 World Cup?': { intent: 0.03, irrelevance: 0.98, spam: 0.02 } })
  const out = await clientFor(fetchImpl).classify('Who won the 1998 World Cup?')
  assert.equal(out.result.decision, 'BLOCK')
  assert.equal(out.result.rule, 'block.irrelevance')
  assert.deepEqual(out.result.signals, { intent: 0.03, irrelevance: 0.98, spam: 0.02 })
})

test('client: rejected input is reported as rejected, not as a decision', async () => {
  const { fetchImpl } = byText({})
  assert.deepEqual(await clientFor(fetchImpl).classify('   '), { rejected: 'empty' })
  assert.deepEqual(await clientFor(fetchImpl).classify('x'.repeat(2001)), { rejected: 'too_long' })
})

test('client: failures become UNAVAILABLE and never throw', async () => {
  const bad = [
    async () => { throw new TypeError('Failed to fetch') },
    async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    async () => new Response(JSON.stringify({ decision: 'PROCEED' }), { status: 200 }), // not a valid envelope
    async () => new Response(JSON.stringify({ schema: 'compascaribe.gate/1', decision: 'PROCEED', signals: null, failure: null, trace: [], thresholds: {} }), { status: 200 }),
  ]
  for (const f of bad) {
    const out = await createGateClient({ fetchImpl: f }).classify('Automate invoicing')
    assert.equal(out.result.decision, 'UNAVAILABLE')
    assert.equal(out.result.signals, null)
  }
  const t = await createGateClient({ fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('x')))), timeoutMs: 20 }).classify('Automate invoicing')
  assert.equal(t.result.failure.kind, 'timeout')
})

test('client: a result that claims PROCEED without signals is not trusted', () => {
  assert.equal(parseGateResult({ schema: 'compascaribe.gate/1', decision: 'PROCEED', signals: null, failure: null, trace: [], thresholds: {} }), null)
  assert.equal(parseGateResult({ schema: 'compascaribe.gate/1', decision: 'UNAVAILABLE', signals: { intent: 1, irrelevance: 0, spam: 0 }, failure: { kind: 'timeout' }, trace: [], thresholds: {} }), null)
  assert.equal(parseGateResult({ schema: 'other', decision: 'PROCEED' }), null)
})
