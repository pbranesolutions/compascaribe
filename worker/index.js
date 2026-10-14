// Worker entry. Static assets are served by Cloudflare before this runs
// (`run_worker_first` in wrangler.jsonc sends only /api/* here), so this is a
// router for the two API routes the site has.

import { handleConversation } from './conversation-handler.js'
import { handleGate } from './gate-handler.js'

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/gate') return handleGate(request, env)
    if (pathname === '/api/conversation') return handleConversation(request, env)
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 })
  },
}
