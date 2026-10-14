# CLAUDE.md

Working notes for agents and people editing this repository.

## Shape

- Vanilla JS modules + plain CSS, built with Vite 8 (a dev dependency), deployed as Cloudflare Workers static assets (`wrangler.jsonc`). No framework. The one runtime dependency is the official `@anthropic-ai/sdk`, imported only by `src/domain/conversation/opening.js` (server). The only server code is the Worker routes `POST /api/gate` and `POST /api/conversation` (`worker/`).
- `src/domain/*` is pure logic with node tests; `src/ui/*` renders journey state; `src/app/journey.js` owns transitions. Keep that separation: the UI never imports `discovery/simulated.js` directly, only `provider.js`.
- The Jev gate (`src/domain/gate/*`, `worker/gate-handler.js`) and the first conversation (`src/domain/conversation/*`, `worker/conversation-handler.js`) are the live AI steps. Begin runs the gate; PROCEED that carries the server's qualification opens the conversation (one Claude request); BLOCK and UNAVAILABLE stay at `src/ui/diagnostic.js` and never reach a model. Never put a canned or simulated result in either path; tests inject fakes, production does not.
- Generation only follows a server-issued qualification for the exact words. Do not add another way to reach `generateOpening`, do not enable SDK retries or fallback models without changing the "one request" contract, and keep `opening.js` out of anything the browser imports (`tests/conversation-boundary.test.js` enforces it).
- The conversation is customer-facing: no engineering labels (model, "live", "written by an AI model") in it. Say AI-assisted once, quietly; put diagnostics behind `?diagnostics` (`.conv-diag`, top-bar labels).
- The agent's voice lives in `src/domain/conversation/prompt.js` and nowhere else; what a reply must look like lives in `schema.js` (`validateOpening`). Visitor text is untrusted: it is passed to the model inside tags and displayed only as text.
- Everything after the first exchange is simulated and labelled as such in the UI. The visitor's answer to the first question is recorded locally and nothing is generated for it; do not present later turns as operational. Do not add code that pretends a network call, account or Decision Channel project exists.
- `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` are server-side only (Worker secrets / `.dev.vars`). Never reference them from `src/` UI code, logs or responses.

## Non-negotiable: zero scrolling

- No element may scroll: no `overflow: auto|scroll`, no scrolling textareas, no transcript lists. Fit text (`fitText`), page it (`pagedText`, `pagedList`), or disclose it in an overlay.
- Every new text block needs a bounded height (a grid track or a `max-height`) so the fitter can act.
- Verify with the browser harness, not by eye: `npm run dev`, then `node tests/browser/run.mjs`. It must report 0 failures across all viewports before a change is done. `?audit` in the dev URL logs overflow after each render.

## Commands

- `npm test` — domain, gate, conversation and Worker tests (mocked; must pass). `npm run test:live` makes real Jev calls and `npm run test:live:conversation` runs Jev then real Claude replies and prints them for review; both skip without keys.
- `npm run build` — must succeed.
- `node tests/browser/run.mjs --url http://localhost:5173` — zero-scroll and journey checks in headless Chrome (needs Chrome/Edge installed).
- Never run `npm run deploy` without being asked; it ships to production.

## Copy

- English, second person, no marketing superlatives, no praise of the visitor. Reflections ≤150 chars, questions ≤90, options ≤46, statement ≤360 (enforced in tests).
- The company name is always "Compás Caribe"; "Decision Channel" is a separate, connected platform.
- The length limits above govern authored (simulated) copy. The live first reply is held to `OPENING_LIMITS` in `src/domain/conversation/schema.js` (about 30 to 70 words, hard caps 60 + 45) and answers in the visitor's language; the interface around it stays English.
