// Small pieces shared by the Worker's two API routes: the JSON response shape
// and a per-visitor rate limiter.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  })
}

export const problem = (error, status, headers) => json({ error }, status, headers)

/**
 * Per-visitor limiter. Uses the Cloudflare rate-limit binding when it is
 * configured; otherwise, or if the binding throws, a sliding window kept in the
 * isolate (a backstop, not a guarantee across isolates).
 *
 * @param {{ binding: string, maxEnv: string, defaultMax: number, windowMs?: number }} options
 */
export function createRateLimiter({ binding, maxEnv, defaultMax, windowMs = 10 * 60 * 1000 }) {
  const hits = new Map()

  function local(key, max, now) {
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      return false
    }
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k)
    return true
  }

  return {
    async allowed(request, env, now) {
      const key = request.headers.get('cf-connecting-ip') || 'local'
      const limiter = env[binding]
      if (limiter && typeof limiter.limit === 'function') {
        try {
          const { success } = await limiter.limit({ key })
          return success
        } catch {
          /* binding trouble must not take the route down; fall back to the local window */
        }
      }
      const max = Number(env[maxEnv])
      return local(key, Number.isFinite(max) && max > 0 ? max : defaultMax, now())
    },
    reset() {
      hits.clear()
    },
  }
}
