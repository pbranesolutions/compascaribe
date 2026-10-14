// Proof that a submission passed the Jev gate.
//
// The browser cannot be trusted to say "Jev returned PROCEED", so the Worker
// signs that fact when it is true and the conversation endpoint refuses to
// generate anything without it. A qualification names the exact words it was
// issued for (by hash), is good for a few minutes, and carries no secret: it is
// an HMAC-SHA256 over a small JSON payload.
//
// Runs wherever Web Crypto exists (the Worker, node). The key never leaves the
// server and is never derived from anything the browser sends.

export const QUALIFICATION_SCHEMA = 'compascaribe.qualification/1'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('not base64url')
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The signing secret: QUALIFICATION_SECRET when set, otherwise derived (with a
 * domain label, so the two uses cannot be confused) from the Jev key the Worker
 * already has. Without either there is nothing to sign with, and no
 * qualification can be issued or verified.
 */
export function signingSecret(env = {}) {
  const dedicated = typeof env.QUALIFICATION_SECRET === 'string' ? env.QUALIFICATION_SECRET.trim() : ''
  if (dedicated.length >= 16) return dedicated
  const jev = typeof env.TYPESAFE_API_KEY === 'string' ? env.TYPESAFE_API_KEY.trim() : ''
  return jev ? `${QUALIFICATION_SCHEMA}:${jev}` : ''
}

const importKey = secret => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/**
 * What a qualification says about how far its conversation has come. A fresh
 * one from the gate has `turn` 0. Each reply the model writes comes back with
 * a renewed qualification (same id, same words, `turn` one higher), so the
 * count that bounds a conversation's cost is signed, not claimed by the browser.
 * `startedAt` carries the first qualification's time across renewals, which is
 * what caps a conversation's total lifetime.
 *
 * @param {{
 *   text: string, secret: string, gateModel?: string|null, ttlMs: number, now?: () => number,
 *   id?: string|null, turn?: number, startedAt?: number|null, maxLifetimeMs?: number|null,
 * }} input
 * @returns {Promise<{ token: string, expiresAt: number } | null>}  null when there is no secret to sign with
 */
export async function issueQualification({ text, secret, gateModel = null, ttlMs, now = Date.now, id = null, turn = 0, startedAt = null, maxLifetimeMs = null }) {
  if (!secret) return null
  const issuedAt = now()
  const began = typeof startedAt === 'number' ? startedAt : issuedAt
  let expires = issuedAt + ttlMs
  if (typeof maxLifetimeMs === 'number') expires = Math.min(expires, began + maxLifetimeMs)
  const payload = {
    s: QUALIFICATION_SCHEMA,
    d: 'PROCEED',
    h: await sha256Hex(text),
    g: gateModel,
    i: issuedAt,
    e: expires,
    j: id || crypto.randomUUID(),
    n: turn,
    x: began,
  }
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(body)))
  return { token: `${body}.${toBase64Url(sig)}`, expiresAt: payload.e }
}

/**
 * @param {{ token: unknown, text: string, secret: string, now?: () => number }} input
 * @returns {Promise<{ ok: true, id: string, expiresAt: number, turn: number, startedAt: number, gateModel: string|null } | { ok: false, reason: 'missing'|'malformed'|'signature'|'expired'|'text' }>}
 */
export async function verifyQualification({ token, text, secret, now = Date.now }) {
  if (typeof token !== 'string' || !token || !secret) return { ok: false, reason: 'missing' }
  const parts = token.split('.')
  if (parts.length !== 2 || token.length > 2048) return { ok: false, reason: 'malformed' }
  let claims
  let sig
  try {
    sig = fromBase64Url(parts[1])
    claims = JSON.parse(decoder.decode(fromBase64Url(parts[0])))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  // Web Crypto's verify is constant-time.
  let valid = false
  try {
    valid = await crypto.subtle.verify('HMAC', await importKey(secret), sig, encoder.encode(parts[0]))
  } catch {
    valid = false
  }
  if (!valid) return { ok: false, reason: 'signature' }
  if (!claims || claims.s !== QUALIFICATION_SCHEMA || claims.d !== 'PROCEED' || typeof claims.j !== 'string' || typeof claims.e !== 'number') return { ok: false, reason: 'malformed' }
  if (now() >= claims.e) return { ok: false, reason: 'expired' }
  if (claims.h !== (await sha256Hex(text))) return { ok: false, reason: 'text' }
  const turn = Number.isInteger(claims.n) && claims.n >= 0 ? claims.n : 0
  const startedAt = typeof claims.x === 'number' ? claims.x : typeof claims.i === 'number' ? claims.i : claims.e
  return { ok: true, id: claims.j, expiresAt: claims.e, turn, startedAt, gateModel: typeof claims.g === 'string' ? claims.g : null }
}
