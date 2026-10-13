# Compás Caribe — public website prototype

The website is the beginning of a customer's project, not a brochure. A visitor
describes what they want to build, a simulated qualification layer decides
whether it is a project Compás Caribe builds, a purpose-built discovery
exchange separates the objective from the tool they imagined, a short project
statement is written and refined in their own terms, and the result is handed
(in simulation) to **Decision Channel**, the platform where functional
requirements are developed.

Everything fits the viewport. **Nothing scrolls** — not the page, not a panel,
not a text box. Long content is paged, fitted or disclosed, never scrolled.

## Run it

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm test             # domain tests (classification, discovery engine, handoff)
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

Vanilla JavaScript modules, plain CSS, Vite 8. No framework, no backend.

```
src/
  main.js                    boot: provider, journey, renderer, viewport binding
  app/journey.js             journey state machine, transitions, persistence, history
  domain/
    context.js               ProjectContext: everything learned, pure updates, limits
    qualification/           simulated Jev: lexicon, Spanish keyword bridge, feature extraction, 4-tier classifier
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
    render.js                shell, focus, announcements, fitting, audit
    views.js                 one function per journey state + overlays
    components.js            top bar, understanding ply, strip, composer (folios), options, paged lists
    fit.js                   fitText, pagination, capacity, overflow audit, viewport binding
    dom.js                   tiny element builder
  styles/tokens.css          palette, stage identities, rhythm
  styles/app.css             layout, components, responsive modes
tests/
  classifier.test.js, discovery.test.js      node --test
  browser/cdp.mjs, browser/run.mjs           headless Chrome harness
```

### Separation of concerns

| Concern | Where | Replaceable by |
|---|---|---|
| Presentation and interaction | `src/ui/*` | — |
| Journey state | `src/app/journey.js` | — |
| Project context and data | `src/domain/context.js` | — |
| Classification (Jev) | `src/domain/qualification/*` | a Jev call behind `qualify()` |
| Generative discovery | `src/domain/discovery/provider.js` | a remote provider calling Claude |
| Conversion and onboarding | `continue` view + journey | real onboarding when accounts exist |
| Decision Channel handoff | `src/domain/handoff/*` | the Decision Channel intake API |

The UI never imports the simulated engine directly; it calls the provider.

## The journey

`welcome → qualifying → (declined | uncertain | discovery) → composing → statement ⇄ refine → continue → handoff → done`

Overlays (`review`, `words`, `drafts`, `notes`, `record`) sit on top of
any stage without changing it. Browser back and Escape step backwards. The
journey is saved to `localStorage` and resumes for a week.

Each stage owns a surface colour: a hue walk from indigo through wine, oxblood,
rust and umber while the project is being understood, an inversion to bone
paper the moment the statement exists, deep green for commitment, slate when
the work crosses into Decision Channel. The charter sentence in the
understanding ply fills blank by blank; each filled part is the control that
revisits that answer.

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
| Relevance classification (4 tiers) | Simulated: lexicon and heuristics in the browser (`qualification/`). |
| Discovery reflections, questions, options | Simulated: derived deterministically from the submission and prior answers. |
| Project statement and refinements | Simulated: composed from structured parts in four registers. |
| Model routing (Haiku / Sonnet / Opus) | Heuristic only; shown in *Prototype notes*, never used to call a model. |
| Think-time | Simulated delays, proportional to input length; `?fast` disables them. |
| Decision Channel handoff | Simulated: the record is built and a local receipt is issued; nothing is transmitted. |
| Accounts, email, persistence beyond this browser | Not present; the UI says so. |

Every simulated step is labelled in the interface (*simulated*, *prototype*).

## Production integration

1. **Jev**: implement `qualify()` against the Jev endpoint, keep the
   `{ tier, label, confidence, reason }` shape. Keep the inline validation
   for empty and very short input in front of it.
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
- Fonts load from Google Fonts, so the page makes that one outbound request;
  the handoff record itself never leaves the browser. Self-hosting the three
  families is a straightforward follow-up.
- Browser tests run only where Chrome or Edge is installed.
