# Compás Caribe

Ambitious ideas. Exceptional software. Brand direction: [BRAND.md](BRAND.md).

## Development

Use Node.js 24 (tests use built-in SQLite). Run `npm ci`, `npm run dev`, and `npm run build`. The build runs guardrail tests before bundling. Local UI development disables remote bindings and needs no Cloudflare login. Use a Cloudflare branch preview for real inference; this consumes the shared allowance. The local UI falls back to email when inference is unavailable.

With authenticated Wrangler, `npm run preview` builds and runs the Worker locally. Apply the migration locally first: `npx wrangler d1 migrations apply compascaribe-brief-usage --local`.

## Project layout

- `index.html`: semantic page content, centered idea form and project descriptions.
- `src/style.css`, `src/chat.css`: brand, responsive layout, CSS sculpture and conversation.
- `src/main.js`, `src/chat.js`: native scroll response and conversation UI.
- `worker/`: `/api/brief`, validation, signed continuation and atomic quota reservations.
- `migrations/`: D1 usage metadata schema and generated signing key.
- `tests/brief.test.js`: real SQLite guardrail tests with mocked inference.
- `public/`: self-hosted Outfit/Manrope fonts and licenses, vector identity and social artwork.

Project illustrations are labeled Interface concept. Coordinador and Gastro Studio descriptions come from the existing company site; no results or testimonials are invented. No runtime dependencies were added. The site makes no third-party font requests.

## Assistant

Visitors clarify a software project, then receive an email draft or copyable brief. The assistant is identified as AI; company positioning does not promote internal production methods.

Server-enforced limits:

- Four replies per signed, 30-minute session.
- Eight inference reservations per daily IP-derived identifier; five-second cooldown.
- 100 inference reservations across the site per UTC day, shared by previews and production.
- 800 UTF-8 bytes per visitor message, 16 KB request body, 8 KB model context, 180 output tokens.
- No tools, automatic retries, fallback models or inference on page load.

D1 reserves allowance atomically before inference; provider failures still count. Modified or replayed continuations are rejected. Storage failure closes the assistant. `BRIEF_ENABLED=false` is the source-controlled kill switch. Shared networks share an allowance; abuse can exhaust the daily pool. These caps bound inference use, not every infrastructure charge. Prompt instructions constrain scope but cannot guarantee perfect model behavior.

Model: `@cf/meta/llama-3.1-8b-instruct-fp8`, through the `AI` binding. `BRIEF_DB` stores a signing key and quota metadata, never conversation text. IP-derived identifiers are keyed and rotate daily; metadata older than seven days is cleared on subsequent traffic. History travels in a signed, unencrypted continuation in tab memory and is processed by Workers AI. Visitors are told to omit confidential information. Email opens a compact draft in their own email application; Copy brief preserves the full text. Neither sends email automatically.

## Verification

`npm run build` tests concurrent global/per-IP limits, four-turn completion, replay/tampering, malformed and oversized input, provider failure, kill switch, bounded output and static routing. Inspect desktop/mobile layouts and a real preview conversation, email destination, native disclosures and reduced motion. Core content and email links remain usable without JavaScript.

## Deployment

Source: `pbranesolutions/compascaribe`, `master`. Use PR → review → merge → Workers Builds.

- Worker `compascaribe`: API plus Workers Static Assets with SPA fallback.
- Build: `npm run build`; production deploy: `npx wrangler deploy`.
- Other branches upload versions with `npx wrangler versions upload`.
- Domains: `compascaribe.com` and `www.compascaribe.com`, maintained in `wrangler.jsonc`.
- AI/D1 bindings, observability and version previews are configured in source.
- D1 `compascaribe-brief-usage` has `0001_brief_usage.sql` applied. On a new database, apply it before enabling the assistant: `npx wrangler d1 migrations apply compascaribe-brief-usage --remote`. Initialization is idempotent.
- Vite outputs Worker code in `dist/compascaribe` and assets in `dist/client`.

Do not replace this workflow with manual production dashboard edits or local deployment. No Neon or Vercel services are used.

## Contact

`hello@compascaribe.com` forwards via Cloudflare Email Routing to `compascaribesrl@gmail.com`.
