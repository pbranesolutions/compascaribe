import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig } from '../src/domain/gate/config.js'
import { parseGateResult } from '../src/domain/gate/client.js'
import { runGate } from '../src/domain/gate/pipeline.js'
import { basisRows, telemetryRows } from '../src/ui/diagnostic.js'
import { byText, res, scripted } from './gate-support.js'

const config = resolveConfig({})
const gate = (text, fetchImpl) =>
  runGate({ text, apiKey: 'k', config, fetchImpl, sleep: async () => {} }).then(r => parseGateResult(JSON.parse(JSON.stringify(r))))
const rowMap = rows => Object.fromEntries(rows)

test('the basis rows are the rules and thresholds of the returned result; telemetry is its model, time and tokens', async () => {
  const { fetchImpl } = byText({ 'What is the capital of France?': { intent: 0.05, irrelevance: 0.96, spam: 0.04 } })
  const r = await gate('What is the capital of France?', fetchImpl)
  const m = rowMap(basisRows(r))
  assert.equal(m['Rule 1 · Spam or meaningless input'], 'spam 0.040 ≥ 0.900 and intent 0.050 ≤ 0.500 → not met')
  assert.equal(m['Rule 2 · Clear irrelevance'], 'irrelevance 0.960 ≥ 0.900 and intent 0.050 ≤ 0.400 → met')
  assert.equal(m.Applied, 'block.irrelevance → BLOCK · Clear irrelevance')
  const t = rowMap(telemetryRows(r))
  assert.equal(t.Model, 'jev-1.13.0')
  assert.match(t['Response time'], /^\d+ ms$/)
  assert.equal(t.Tokens, '296 in · 20 out')
})

test('an unavailable result shows the reason, not a judgement', async () => {
  const { fetchImpl } = scripted(res(529, {}))
  const r = await gate('Automate invoicing', fetchImpl)
  assert.equal(r.decision, 'UNAVAILABLE')
  const m = rowMap(basisRows(r))
  assert.match(m.Reason, /overloaded/)
  assert.match(m.Decision, /not a judgement/)
  assert.ok(!Object.keys(m).some(k => k.startsWith('Rule ')))
  const t = rowMap(telemetryRows(r))
  assert.equal(t.Model, 'not reported (requested jev-latest)')
  assert.equal(t.Tokens, 'not reported')
  assert.match(t['Response time'], /ms · 2 attempts$/)
})
