import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, resolveConfig } from '../src/domain/gate/config.js'
import { decide } from '../src/domain/gate/decide.js'

const T = DEFAULTS.thresholds
const d = (intent, irrelevance, spam, t = T) => decide({ intent, irrelevance, spam }, t)

test('clear project intent proceeds', () => {
  const v = d(0.96, 0.02, 0.01)
  assert.equal(v.decision, 'PROCEED')
  assert.equal(v.rule, 'proceed.default')
  assert.ok(v.trace.every(r => !r.met))
})

test('vague, brief or unconventional submissions proceed on ambiguity alone', () => {
  // Middling everything: nothing is evidence of irrelevance.
  assert.equal(d(0.5, 0.4, 0.2).decision, 'PROCEED')
  // Low intent without strong irrelevance or spam is not grounds to block.
  assert.equal(d(0.1, 0.5, 0.3).decision, 'PROCEED')
  assert.equal(d(0.0, 0.0, 0.0).decision, 'PROCEED')
  // Irrelevance that is probable but not strong.
  assert.equal(d(0.2, 0.85, 0.1).decision, 'PROCEED')
})

test('clear irrelevance blocks', () => {
  const v = d(0.04, 0.97, 0.05)
  assert.equal(v.decision, 'BLOCK')
  assert.equal(v.rule, 'block.irrelevance')
})

test('clear spam or meaningless input blocks', () => {
  const v = d(0.01, 0.6, 0.99)
  assert.equal(v.decision, 'BLOCK')
  assert.equal(v.rule, 'block.spam')
})

test('manipulation with no project in it blocks; the same words wrapped around a project do not', () => {
  assert.equal(d(0.02, 0.5, 0.96).decision, 'BLOCK')
  assert.equal(d(0.72, 0.1, 0.93).decision, 'PROCEED')
})

test('conflicting signals resolve in the visitor’s favour', () => {
  // Strong irrelevance and strong intent at once.
  assert.equal(d(0.8, 0.95, 0.1).decision, 'PROCEED')
  // Strong spam and strong intent at once.
  assert.equal(d(0.9, 0.1, 0.97).decision, 'PROCEED')
  // Everything high.
  assert.equal(d(0.95, 0.95, 0.95).decision, 'PROCEED')
})

test('thresholds are inclusive at the block edge and exclusive just inside it', () => {
  assert.equal(d(0.5, 0.0, 0.9).decision, 'BLOCK')
  assert.equal(d(0.5, 0.0, 0.899).decision, 'PROCEED')
  assert.equal(d(0.5001, 0.0, 0.9).decision, 'PROCEED')
  assert.equal(d(0.4, 0.9, 0.0).decision, 'BLOCK')
  assert.equal(d(0.4001, 0.9, 0.0).decision, 'PROCEED')
})

test('the trace shows every rule evaluated with the numbers it used', () => {
  const v = d(0.3, 0.92, 0.1)
  assert.equal(v.trace.length, 2)
  assert.deepEqual(v.trace.map(r => r.id), ['block.spam', 'block.irrelevance'])
  assert.deepEqual(v.trace.map(r => r.met), [false, true])
  assert.equal(v.trace[1].parts[0].text, 'irrelevance 0.920 ≥ 0.900')
  assert.equal(v.trace[1].parts[1].text, 'intent 0.300 ≤ 0.400')
})

test('thresholds come from configuration and bad overrides fall back to the defaults', () => {
  assert.equal(d(0.5, 0.0, 0.8, { ...T, spamBlock: 0.75 }).decision, 'BLOCK')
  const cfg = resolveConfig({ GATE_SPAM_BLOCK: '0.95', GATE_IRRELEVANCE_BLOCK: 'banana', GATE_MAX_CHARS: '-4', JEV_MODEL: 'jev-1.13.0', GATE_MAX_ATTEMPTS: '9' })
  assert.equal(cfg.thresholds.spamBlock, 0.95)
  assert.equal(cfg.thresholds.irrelevanceBlock, DEFAULTS.thresholds.irrelevanceBlock)
  assert.equal(cfg.maxChars, DEFAULTS.maxChars)
  assert.equal(cfg.model, 'jev-1.13.0')
  assert.equal(cfg.maxAttempts, DEFAULTS.maxAttempts)
  assert.equal(resolveConfig({}).model, 'jev-latest')
  assert.equal(resolveConfig({ JEV_MODEL: 'bad model; drop' }).model, 'jev-latest')
})
