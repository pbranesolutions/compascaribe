# CLAUDE.md

Working notes for agents and people editing this repository.

## Shape

- Vanilla JS modules + plain CSS, built with Vite 8 (a dev dependency), deployed as Cloudflare Workers static assets (`wrangler.jsonc`). No framework, no runtime dependencies. The only server code is the Worker route `POST /api/gate` (`worker/`).
- `src/domain/*` is pure logic with node tests; `src/ui/*` renders journey state; `src/app/journey.js` owns transitions. Keep that separation: the UI never imports `discovery/simulated.js` directly, only `provider.js`.
- The Jev gate (`src/domain/gate/*`, `worker/*`) is the one live AI step. Begin runs it and stops at `src/ui/diagnostic.js`; nothing routes on PROCEED or BLOCK yet. Never put a canned or simulated result in that path; tests inject fakes, production does not.
- Everything after the gate is simulated and labelled as such in the UI. Do not add code that pretends a network call, account or Decision Channel project exists.
- `TYPESAFE_API_KEY` is server-side only (Worker secret / `.dev.vars`). Never reference it from `src/` UI code, logs or responses.

## Non-negotiable: zero scrolling

- No element may scroll: no `overflow: auto|scroll`, no scrolling textareas, no transcript lists. Fit text (`fitText`), page it (`pagedText`, `pagedList`), or disclose it in an overlay.
- Every new text block needs a bounded height (a grid track or a `max-height`) so the fitter can act.
- Verify with the browser harness, not by eye: `npm run dev`, then `node tests/browser/run.mjs`. It must report 0 failures across all viewports before a change is done. `?audit` in the dev URL logs overflow after each render.

## Commands

- `npm test` — domain, gate and Worker tests (mocked; must pass). `npm run test:live` makes real Jev calls and skips without a key.
- `npm run build` — must succeed.
- `node tests/browser/run.mjs --url http://localhost:5173` — zero-scroll and journey checks in headless Chrome (needs Chrome/Edge installed).
- Never run `npm run deploy` without being asked; it ships to production.

## Copy

- English, second person, no marketing superlatives, no praise of the visitor. Reflections ≤150 chars, questions ≤90, options ≤46, statement ≤360 (enforced in tests).
- The company name is always "Compás Caribe"; "Decision Channel" is a separate, connected platform.
