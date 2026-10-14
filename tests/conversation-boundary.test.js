import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The browser bundle is what src/main.js can reach. Nothing there may import the
// model SDK, name a server credential, or hold the signing key's logic.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function reachable(entry) {
  const seen = new Map()
  const stack = [resolve(root, entry)]
  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file)) continue
    const src = readFileSync(file, 'utf8')
    seen.set(file, src)
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (m[1].endsWith('.css')) continue
      stack.push(resolve(dirname(file), m[1]))
    }
  }
  return seen
}

test('the browser bundle never reaches the model SDK, a server credential or the signing logic', () => {
  const files = reachable('src/main.js')
  assert.ok(files.size > 20, 'the walk found the application')
  const forbidden = [
    /@anthropic-ai\/sdk/,
    /ANTHROPIC_API_KEY/,
    /TYPESAFE_API_KEY/,
    /QUALIFICATION_SECRET/,
    /domain\/conversation\/opening/,
    /conversation\/qualification/,
    /['"]\.\/opening\.js['"]/,
    /['"]\.\/qualification\.js['"]/,
    /\bsigningSecret\b/,
    /worker\//,
  ]
  for (const [file, src] of files) {
    for (const re of forbidden) assert.ok(!re.test(src), `${relative(root, file)} matches ${re}`)
  }
})

test('the visitor’s reply is not sent anywhere: no module reachable from the browser posts it', () => {
  const files = reachable('src/main.js')
  const posting = [...files].filter(([, src]) => /fetch\(|XMLHttpRequest|sendBeacon/.test(src)).map(([f]) => relative(root, f).replaceAll('\\', '/')).sort()
  const allowed = ['src/domain/conversation/client.js', 'src/domain/gate/client.js']
  assert.deepEqual(posting.filter(f => !allowed.includes(f)), [], 'only the gate and conversation clients make requests')
  const conversationClient = readFileSync(join(root, 'src/domain/conversation/client.js'), 'utf8')
  assert.ok(!/reply/i.test(conversationClient.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'the conversation client only knows how to ask for an opening')
})
