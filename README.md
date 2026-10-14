# Compás Caribe — public website prototype

The website is the beginning of a customer's project, not a brochure. A visitor
describes what they want to build, the **Jev gate** (live) classifies whether
the words warrant generative AI and displays its decision, and, behind it, a
simulated flow (not reachable from Begin yet) shows where the journey goes: a purpose-built discovery
exchange separates the objective from the tool they imagined, a short project
statement is written and refined in their own terms, and the result is handed
(in simulation) to **Decision Channel**, the platform where functional
requirements are developed.

Everything fits the viewport. **Nothing scrolls** — not the page, not a panel,
not a text box. Long content is paged, fitted or disclosed, never scrolled.

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars   # then set TYPESAFE_API_KEY (git-ignored)
npm run dev          # Vite dev server + Worker, http://localhost:5173
npm test             # mocked tests: gate, Worker, journey, discovery, classifier
npm run test:live    # real Jev calls with your key (skips without one)
npm run build        # production build into dist/
npm run preview      # build + wrangler dev (Cloudflare Workers static assets)
```

Browser tests drive the real site in headless Chrome across twelve viewports
and assert the zero-scroll constraint after every state change:

```bash
npm run dev                                   # in one terminal
node tests/browser/run.mjs --url http://localhost:5173   # in another
```

The runner needs a local Chrome or Edge (set `CHROME_PATH` otherwise). It writes
screenshots and `report.json` to `tests/browser/shots/`.

Useful URL flags: `?audit` logs an overflow audit after every render,
`?fast` removes all simulated delays (classification, discovery, statement and
handoff), `?fresh` clears the saved journey. `npm run test:browser` runs the
harness against `http://localhost:5173`.

## Architecture

Vanilla JavaScript modules, plain CSS, Vite 8. No framework. One Cloudflare
Worker route (`POST /api/gate`) holds the TypeSafe AI key; everything else is
static assets.

```
src/
  main.js                    boot: provider, gate client, journey, renderer, viewport binding
  app/journey.js             journey state machine, transitions, persistence, history
  domain/
    context.js               ProjectContext: everything learned, pure updates, limits
    gate/                    the live Jev gate: questions, decision rules, Jev client, pipeline, browser client
    qualification/           (simulated, now dormant) lexicon classifier behind the discovery provider
    discovery/
      provider.js            the generative-AI boundary (qualify / open / answer / compose / refine)
      simulated.js           deterministic engine behind that boundary
      understanding.js       structured reading of the submission
      questions.js           question plan, options, reflections
      statement.js           project-statement composition and refinement variants
      routing.js             model-tier routing heuristic (Haiku / Sonnet / Opus), diagnostics only
    handoff/
      payload.js             versioned Decision Channel intake record
      transport.js           simulated transport (never claims a network call)
  ui/
    diagnostic.js            temporary Jev gate diagnostic (removable on its own)
    render.js                shell, focus, announcements, fitting, audit
    views.js                 one function per journey state + overlays
    components.js            top bar, understanding ply, strip, composer (folios), options, paged lists
    fit.js                   fitText, pagination, capacity, overflow audit, viewport binding
    dom.js                   tiny element builder
  styles/tokens.css          palette, stage identities, rhythm
  styles/app.css             layout, components, responsive modes
worker/
  index.js                   Worker entry: routes /api/gate, everything else is assets
  gate-handler.js            origin, size, rate limit, de-duplication, key handling
tests/
  gate-*.test.js             decision rules, Jev client, pipeline, Worker, diagnostic (mocked)
  live/gate.live.mjs         real Jev calls, run with: npm run test:live
  classifier.test.js, discovery.test.js, journey.test.js      node --test
  browser/cdp.mjs, browser/run.mjs           headless Chrome harness
```

### Separation of concerns

| Concern | Where | Replaceable by |
|---|---|---|
| Presentation and interaction | `src/ui/*` | — |
| Journey state | `src/app/journey.js` | — |
| Project context and data | `src/domain/context.js` | — |
| Classification (Jev gate) | `src/domain/gate/*`, `worker/*` | — (live) |
| Diagnostic display | `src/ui/diagnostic.js` | removal: delete it and `VIEWS.gate` |
| Generative discovery | `src/domain/discovery/provider.js` | a remote provider calling Claude |
| Conversion and onboarding | `continue` view + journey | real onboarding when accounts exist |
| Decision Channel handoff | `src/domain/handoff/*` | the Decision Channel intake API |

The UI never imports the simulated engine directly; it calls the provider.

## The journey

`welcome → gate`. Begin runs the Jev gate and **stops**: the decision (PROCEED /
BLOCK / UNAVAILABLE) is displayed, never executed.

The simulated flow behind it is intact and covered by tests and the browser
harness, but nothing routes into it yet:
`qualifying → (declined | uncertain | discovery) → composing → statement ⇄ refine → continue → handoff → done`

Overlays (`review`, `words`, `drafts`, `notes`, `record`) sit on top of
any stage without changing it. Browser back and Escape step backwards. The
journey is saved to `localStorage` and resumes for a week.

Each stage owns a surface colour: a hue walk from indigo through wine, oxblood,
rust and umber while the project is being understood, an inversion to bone
paper the moment the statement exists, deep green for commitment, slate when
the work crosses into Decision Channel. The charter sentence in the
understanding ply fills blank by blank; each filled part is the control that
revisits that answer.

## The Jev gate

Begin posts the words to `POST /api/gate`. The Worker validates, makes **one**
request to `POST https://api.typesafe.ai/v1/systemone` (model `jev-latest`,
three independent `noul` questions) and applies fixed rules to the three
probabilities. The browser never sees the key and never computes a decision.

| Question (key) | Asks | Probability of yes |
|---|---|---|
| `plausible_project_intent` | does the text plausibly describe something the visitor wants to create, accomplish, change, improve, solve or explore (broad; brief and vague count)? | `intent` |
| `clearly_irrelevant` | is it clearly unrelated to any plausible project (ambiguity is not irrelevance)? | `irrelevance` |
| `spam_or_meaningless` | is it clearly spam, gibberish, automated junk or an attempt to manipulate the application? | `spam` |

The visitor's text is sent only as `state`; it is never placed in an instruction,
and every question declares it untrusted data. Jev is asked for probabilities
only, never for an explanation.

**Decision rules** (first match wins; thresholds are **provisional**, uncalibrated,
and live in `src/domain/gate/config.js`):

| Rule | Condition | Decision |
|---|---|---|
| `block.spam` | spam ≥ 0.90 **and** intent ≤ 0.50 | BLOCK |
| `block.irrelevance` | irrelevance ≥ 0.90 **and** intent ≤ 0.40 | BLOCK |
| `proceed.default` | otherwise (including conflicting or uncertain signals) | PROCEED |
| (failure) | key missing, auth, timeout, 429/529/5xx after retries, malformed reply | UNAVAILABLE |

UNAVAILABLE is never a judgement of the submission. Empty or whitespace-only
input and input over `GATE_MAX_CHARS` are rejected before any request.

**Operation.** Per attempt 6 s, 12 s overall, two attempts; only 429, 529, 5xx,
timeouts and network errors are retried. In-flight duplicate texts share one Jev
call. Same-origin POST only; 10 requests per minute per IP through the
`GATE_LIMITER` rate-limit binding, with a per-isolate fallback window.

**Configuration** (Worker vars; secrets via `wrangler secret put`, or `.dev.vars` locally):

| Name | Default | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | (required, secret) | server-side API key |
| `JEV_MODEL` | `jev-latest` | model requested |
| `GATE_MAX_CHARS` | 2000 | server-side input ceiling |
| `GATE_TIMEOUT_MS` / `GATE_DEADLINE_MS` / `GATE_MAX_ATTEMPTS` | 6000 / 12000 / 2 | bounds |
| `GATE_SPAM_BLOCK`, `GATE_SPAM_INTENT_CEILING` | 0.90, 0.50 | spam rule |
| `GATE_IRRELEVANCE_BLOCK`, `GATE_IRRELEVANCE_INTENT_CEILING` | 0.90, 0.40 | irrelevance rule |

The diagnostic (`src/ui/diagnostic.js`) renders the returned `GateResult`:
decision, the three probabilities, each rule evaluated with the numbers it used,
the model Jev reported, response time and token usage.

## Zero scrolling: how it is enforced

- `html, body, .app` are fixed to the visual viewport (`--vvh` is kept current
  from `visualViewport`, so the virtual keyboard and browser chrome are
  accounted for). Wheel and touch-move are prevented outside composers.
- Every text block has a bounded height; `fitText` sizes the type to the box.
- Text that cannot fit at the floor size is **paged** (`pagedText`, `pagedList`,
  `paginateToFit`), with a visible pager.
- Composers hold at most what they can show (dynamic `maxlength`); when a
  prefilled or resized composer is longer than its box, it shows **folios** —
  pages that follow the caret — never a scrollbar.
- Option bars shrink before they overflow; very short viewports switch to a
  two-column layout; option count adapts to the height.
- Hard limits live in `LIMITS`: description 480, clarification 240, own words
  140, statement 360.
- `auditOverflow()` walks the DOM and reports anything that would need
  scrolling. It runs after every render with `?audit`, and the browser harness
  asserts it at every state on every viewport. Intentional one- and two-line
  previews whose full text is one action away carry `data-clamp`.

## What is simulated

| Behaviour | Status |
|---|---|
| Begin → classification (PROCEED / BLOCK / UNAVAILABLE) | **Live**: Jev via TypeSafe AI, decided by fixed rules (see below). |
| Relevance classification (4 tiers) | Simulated lexicon in the browser; no longer on the Begin path. |
| Discovery reflections, questions, options | Simulated: derived deterministically from the submission and prior answers. |
| Project statement and refinements | Simulated: composed from structured parts in four registers. |
| Model routing (Haiku / Sonnet / Opus) | Heuristic only; shown in *Prototype notes*, never used to call a model. |
| Think-time | Simulated delays, proportional to input length; `?fast` disables them. |
| Decision Channel handoff | Simulated: the record is built and a local receipt is issued; nothing is transmitted. |
| Accounts, email, persistence beyond this browser | Not present; the UI says so. |

Every simulated step is labelled in the interface (*simulated*, *prototype*).

## Production integration

1. **Jev**: done as a gate (see "The Jev gate"). Still to do: act on the
   decision. PROCEED should start discovery and BLOCK should decline; both
   consume `GateResult` from `state.gate` and need no change to the gate.
2. **Claude**: implement a remote `DiscoveryProvider` with the same five
   methods, served by a Compás Caribe worker that enforces rate limits,
   session budgets and input limits before inference. `routing.js` already
   expresses the tiering policy; move it server-side.
3. **Decision Channel**: POST the `compascaribe.handoff/1` payload to the
   intake endpoint from `transport.js`; return the real project reference.
4. **Abuse prevention**: the client limits input and never enters a general
   chat; add server-side rate limiting and a session budget per visitor.
5. **Persistence**: the local journey record can be replaced by a server
   session once accounts exist.

## Known limitations

- The simulated engine is lexicon-driven. Spanish and Spanglish submissions
  are bridged to English keywords for extraction (`qualification/spanish.js`);
  the interface itself is English. Unusual phrasings can land in *uncertain*
  and are offered a second sentence.
- Statement variants are templates; a model will write better prose.
- Folio paging in composers is state-driven, but it relies on the browser's
  internal textarea offset; it is verified in Chrome and not yet in Safari.
- Begin sends the visitor's words to the Worker and on to TypeSafe AI (Jev);
  the text is not stored or logged. The handoff record itself still never
  leaves the browser.
- Fonts load from Google Fonts, so the page makes that one outbound request. Self-hosting the three
  families is a straightforward follow-up.
- Browser tests run only where Chrome or Edge is installed.
