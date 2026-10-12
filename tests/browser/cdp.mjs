// Minimal Chrome DevTools Protocol client. No dependencies: Node 22+ WebSocket.

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function launchChrome({ port = 9333 } = {}) {
  const { existsSync } = await import('node:fs')
  const bin = CHROME_CANDIDATES.find(p => existsSync(p))
  if (!bin) throw new Error('No Chrome/Edge binary found; set CHROME_PATH')
  const profile = mkdtempSync(join(tmpdir(), 'cc-chrome-'))
  const proc = spawn(bin, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,900', '--font-render-hinting=none', 'about:blank',
  ], { stdio: 'ignore' })
  let version
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      version = await res.json()
      break
    } catch {
      await sleep(150)
    }
  }
  if (!version) {
    proc.kill()
    throw new Error('Chrome did not start')
  }
  const browser = await connect(version.webSocketDebuggerUrl)
  return {
    browser,
    async newPage() {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const t = list.find(x => x.id === targetId)
      const page = await connect(t.webSocketDebuggerUrl)
      await page.send('Page.enable')
      await page.send('Runtime.enable')
      await page.send('Log.enable')
      return page
    },
    close() {
      try { proc.kill() } catch { /* ignore */ }
      setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ } }, 500)
    },
  }
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params)
    }
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const myId = ++id
        pending.set(myId, { resolve, reject })
        ws.send(JSON.stringify({ id: myId, method, params }))
      })
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set())
      listeners.get(method).add(fn)
    },
    close() { ws.close() },
  }
}

/** Evaluate an expression in the page and return its JSON value. */
export async function evaluate(page, expression) {
  const res = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
  return res.result.value
}

export async function setViewport(page, { width, height, mobile = false, scale = 1 }) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height })
  if (mobile) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  else await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
}

export async function screenshot(page, path) {
  const { writeFileSync } = await import('node:fs')
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path, Buffer.from(data, 'base64'))
}

export async function navigate(page, url) {
  const loaded = new Promise(resolve => page.on('Page.loadEventFired', resolve))
  await page.send('Page.navigate', { url })
  await loaded
  await sleep(100)
}

export async function waitFor(page, expression, { timeout = 8000, interval = 60 } = {}) {
  const start = Date.now()
  for (;;) {
    const v = await evaluate(page, expression)
    if (v) return v
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for: ${expression}`)
    await sleep(interval)
  }
}

export async function key(page, keyName, { text, modifiers = 0 } = {}) {
  const codes = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, ' ': 32, Home: 36, End: 35 }
  const code = codes[keyName] || 0
  const t = text ?? (keyName.length === 1 ? keyName : keyName === 'Enter' ? String.fromCharCode(13) : undefined)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName === ' ' ? 'Space' : keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, text: t, unmodifiedText: t, modifiers })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName === ' ' ? 'Space' : keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
}

export async function typeText(page, text) {
  await page.send('Input.insertText', { text })
}

export { sleep }
