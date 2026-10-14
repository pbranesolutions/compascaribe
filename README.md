# Compás Caribe — public website prototype

The website is the beginning of a customer's project, not a brochure. A visitor
describes what they want to build; the **Jev gate** (live) classifies whether
the words warrant generative AI; and when they do, a Claude model (live) answers
with a short reflection of what it understood and one question: the first
exchange of a consultation. Behind that, a
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
cp .dev.vars.example .dev.vars   # then set TYPESAFE_API_KEY and ANTHROPIC_API_KEY (git-ignored)
npm run dev          # Vite dev server + Worker, http://localhost:5173
npm test             # mocked tests: gate, conversation, Worker, journey, discovery, classifier
npm run test:live    # real Jev calls with your key (skips without one)
npm run test:live:conversation   # Jev then real Claude replies, printed for review (skips without keys)
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
`--only <name>` limits it to viewports whose name contains the text, and `--conv`
runs only the conversation scenarios (first reply, follow-ups, failure and
recovery, the stated purpose, correction, confirmation, the length limit). Those
answer `/api/gate` and `/api/conversation` from envelopes injected into the page,
so layouts, states and request counts are deterministic; the real-endpoint
scenario follows the real conversation route too when the server is configured
to qualify words. Do not edit files under the dev server while it runs: Vite
reloads the page mid-scenario.

Useful URL flags: `?audit` logs an overflow audit after every render,
`?diagnostics` shows the engineering detail the customer-facing conversation
leaves out,
`?fast` removes all simulated delays (classification, discovery, statement and
handoff), `?fresh` clears the saved journey. `npm run test:browser` runs the
harness against `http://localhost:5173`.

## Architecture

Vanilla JavaScript modules, plain CSS, Vite 8. No framework. One Cloudflare
Worker route (`POST /api/gate`) holds the TypeSafe AI key; everything else is
static assets. A second route (`POST /api/conversation`) holds the Anthropic
key and makes one model request per reply of the conversation.

```
src/
  main.js                    boot: provider, gate client, journey, renderer, viewport binding
  app/journey.js             journey state machine, transitions, persistence, history
  domain/
    context.js               ProjectContext: everything learned, pure updates, limits
    gate/                    the live Jev gate: questions, decision rules, Jev client, pipeline, browser client
    conversation/            the conversation:
      prompt.js              conversational instructions (the agent's voice), wording only
      schema.js              first-reply schema + validation; tone and one-question rules every reply shares
      turn.js                later replies: schema, the agent's understanding, the statement, validation
      history.js             the conversation as it travels: shape, bounds, repeat detection (browser + Worker)
      qualification.js       signed proof that exact words passed the gate; renewed with every reply
      opening.js             SERVER ONLY: the Claude requests (official SDK): first reply and later turns
      config.js              model, effort, token ceilings, timeouts, reply budget (server vars)
      client.js              browser client for /api/conversation (open, next)
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
    conversation.js          the conversation: words, reflection, question, answer field, the stated purpose
    render.js                shell, focus, announcements, fitting, audit
    views.js                 one function per journey state + overlays
    components.js            top bar, understanding ply, strip, composer (folios), options, paged lists
    fit.js                   fitText, pagination, capacity, overflow audit, viewport binding
    dom.js                   tiny element builder
  styles/tokens.css          palette, stage identities, rhythm
  styles/app.css             layout, components, responsive modes
worker/
  index.js                   Worker entry: routes /api/gate and /api/conversation, everything else is assets
  gate-handler.js            origin, size, rate limit, de-duplication, key handling, issues the qualification
  conversation-handler.js    qualification check, signed reply budget, rate limit, one model request per reply, ledger
  http.js                    JSON responses and the per-visitor rate limiter both routes share
tests/
  gate-*.test.js             decision rules, Jev client, pipeline, Worker, diagnostic (mocked)
  conversation-*.test.js     prompt, structure validation, model invocation (real SDK, doubled network),
                             qualification, Worker route, client, bundle boundary (mocked)
  conversation-turn*.test.js later replies: validation, history, budget, retry, renewal (mocked)
  journey-conversation.test.js   the conversation in the journey (mocked routes)
  live/gate.live.mjs         real Jev calls, run with: npm run test:live
  live/conversation.live.mjs Jev then real Claude first replies, run with: npm run test:live:conversation
  live/conversation-flow.live.mjs   whole conversations against simulated visitors and a judge, run with:
                             npm run test:live:flow
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
| Qualification for generation | `src/domain/conversation/qualification.js`, `worker/gate-handler.js` | — |
| Conversational instructions | `src/domain/conversation/prompt.js` | — (edit the wording here only) |
| Model invocation | `src/domain/conversation/opening.js`, `worker/conversation-handler.js` | another model through `CONVERSATION_MODEL` |
| Conversation state | `ProjectContext.conversation` (`src/domain/context.js`) | — |
| Conversation display | `src/ui/conversation.js` | — |
| Generative discovery | `src/domain/discovery/provider.js` | a remote provider calling Claude |
| Conversion and onboarding | `continue` view + journey | real onboarding when accounts exist |
| Decision Channel handoff | `src/domain/handoff/*` | the Decision Channel intake API |

The UI never imports the simulated engine directly; it calls the provider.

## The journey

`welcome → gate → conversation → continue → handoff → done`. Begin runs the Jev
gate. **PROCEED** (with the server's qualification) opens the conversation;
**BLOCK** and **UNAVAILABLE** stay at the diagnostic and never reach a model. In
the conversation every answer the visitor sends gets a reply written by Claude
from the whole conversation so far, until the project's purpose is understood and
stated; the visitor confirms or corrects that statement, and a confirmed
statement is the project's statement (`ctx.statement`, source `conversation`).
*Continue* then goes into the simulated handoff.

The earlier simulated discovery flow is intact and covered by tests and the
browser harness, but nothing routes into it from Begin:
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

## The conversation

After a PROCEED the browser shows the conversation stage immediately (the
visitor's words, exactly as written, and a quiet "Preparing a reply") and posts
`{ text, qualification }` to `POST /api/conversation`. Each later answer posts
`{ text, qualification, turns, understanding }`: the visitor's words, the
qualification that came back with the last reply, the conversation so far and
what the agent understood at the end of its last reply.

**Only qualified words are generated on.** `/api/gate` signs a qualification
(HMAC-SHA256 over the hash of the exact words, an expiry, a random id, a reply
count and a start time) when, and only when, Jev returned PROCEED.
`/api/conversation` verifies signature, expiry and that the words are the same
ones, or refuses with no model request. BLOCK and UNAVAILABLE never receive one.
The signing key is `QUALIFICATION_SECRET` if set, otherwise derived (with a domain
label) from `TYPESAFE_API_KEY`. If `ANTHROPIC_API_KEY` is not configured, or the
route is switched off, no qualification is issued and PROCEED stays at the
diagnostic.

**The budget is signed, not claimed.** Every reply comes back with a renewed
qualification: the same words and id, the count of replies the conversation has
had, valid for `CONVERSATION_SESSION_TTL_MS` (30 min) and never beyond
`CONVERSATION_SESSION_MAX_MS` (3 h) from the first. The server uses the larger
of that count and the history it was sent, so sending less history cannot buy
more replies. The agent is told to draw the conversation to a close after
`CONVERSATION_CONVERGE_AFTER` (6) replies, the last permitted reply
(`CONVERSATION_MAX_REPLIES` − 1, default 10 in all) must be the statement of the
purpose, and beyond that nothing is generated (`limit`; the visitor can keep the
statement as it stands). A visitor who waited out a qualification, reloads, or is
refused is checked again on the same words and the conversation continues from
its history.

**One request per reply.** The route calls Claude through the official
`@anthropic-ai/sdk` (`src/domain/conversation/opening.js`, the only module that
imports it; a test fails if the browser bundle can reach it) with `maxRetries: 0`
and no fallback model. The one extra request is bounded and specific: a
follow-up whose reply fails validation is asked for once more with the reason
(`CONVERSATION_TURN_REPAIRS`, only while there is time; never for a refusal, a
timeout or a transport failure, and never for the first reply). A visitor's
explicit *Try again* is a new request, counted: a step allows a few
(`CONVERSATION_MAX_ATTEMPTS`), after which the words are checked again. A success
is answered from memory, and simultaneous requests for the same step share one
request. Cost guards, in order: same-origin POST, body limit, per-visitor rate
limit (`CONVERSATION_LIMITER`: 8/min, with a per-isolate fallback), history shape
and bounds, qualification check, the signed reply budget, input ceiling
(`GATE_MAX_CHARS`; `CONVERSATION_REPLY_MAX_CHARS` for answers), `max_tokens`
(`CONVERSATION_MAX_TOKENS` 1500 for the first reply, `CONVERSATION_TURN_MAX_TOKENS`
3000 for the rest, thinking included), timeouts, and `CONVERSATION_ENABLED=false`
as a switch.

**What is asked.** `prompt.js` holds the agent's instructions. The first reply
has three beats (recognise their situation, show what it is really about, ask one
concrete question), steered by a private checklist of what a project's purpose
needs. Later replies carry the whole conversation and the agent's own working
understanding, and do four things in order: *read* the latest message (answers,
adds, changes, contradicts, unsure, asks, diversion, corrects: each has its own
handling, e.g. a contradiction is put side by side and asked as the one question,
a question about price is answered honestly and the thread returns, an
instruction aimed at the agent is declined calmly); *update the understanding*
(what is confirmed in their words, what is only inferred, what is still open, and
a coverage map of problem, beneficiaries, outcome, value and success that is a
map and not a sequence); *decide the move* (the one question that most clarifies
the purpose, or the purpose itself once it can be stated from what they said, with
no fixed number of questions and none asked for completeness); and *write* the
reflection and question, or the statement. The statement is one to three
sentences in their language and terms, every claim traceable to their words, with
no means, predictions or flourish. Visitor text and the history it travels in
are wrapped in tags the visitor cannot close, and the instructions say they are
data, not instructions. The prompts name no framework and make no scientific
claim; the craft (specificity, their words, one idea per sentence, small easy
questions, letting them do the talking) is in the instructions as behaviour.

**What is accepted.** `validateOpening` (`schema.js`) and `validateTurn`
(`turn.js`) hold the answer to what a schema cannot say: both parts present, the
reflection contains no question, the question is one sentence with one question
mark at its end, within the word limits, no greeting, no praise, no exclamation
marks, no markup; for a turn also the understanding's shape and bounds, a
question never repeated after an answer, a statement of at most 75 words and four
sentences, and that the last permitted reply is a statement. Repairs only remove
words (the log records `repaired`): a second question tacked on with ", and
what ...?" is dropped when what precedes it is a complete question, and a
sentence of encouragement is dropped from the reflection when others remain. A
response that still fails, is cut off at the token ceiling, or is refused is never
shown; the visitor sees a plain message, keeps their words and answer and can try
again. The browser re-validates before it renders.

**Display.** One thread, one exchange at a time, never a transcript: the
visitor's project (a preview, with *Read in full*, *Full exchange* and *Edit*
beside it), what Compás Caribe took from the last answer and the one question,
and the answer field, joined by a thin rail and sitting where the landing page's
field sat. Earlier exchanges are one tap away in *Full exchange*, which pages.
There is no header or footer chrome and no engineering label: that the reply is
AI-written is said once, quietly ("Compás Caribe · AI-assisted"). While a reply
is written the answer stays on the page with a quiet "Preparing a reply"; if it
fails the answer is kept with *Try again* and *Edit*. When the purpose is stated
it is the page: one tap for *That's right*, one for *Change something* (a field
opens for the correction, and a revised statement comes back); once confirmed the
way on is *Continue*. `?diagnostics` (or `?audit`) shows the engineering detail:
model, latency, tokens, what the agent read, how much it considers established
and its working purpose.

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (secret) | Claude key; `wrangler secret put ANTHROPIC_API_KEY` |
| `CONVERSATION_MODEL` | `claude-sonnet-5-5` | model requested; must support adaptive thinking and effort |
| `CONVERSATION_EFFORT` | `low` | first reply: `low`, `medium` or `high`; tune with `npm run test:live:conversation` |
| `CONVERSATION_MAX_TOKENS` | 1500 | first reply: output ceiling per request |
| `CONVERSATION_TIMEOUT_MS` | 25000 | first reply: the one request |
| `CONVERSATION_TURN_EFFORT` | `medium` | later replies; tune with `npm run test:live:flow` |
| `CONVERSATION_TURN_MAX_TOKENS` | 3000 | later replies: output ceiling per request |
| `CONVERSATION_TURN_TIMEOUT_MS` | 40000 | later replies: each request |
| `CONVERSATION_TURN_REPAIRS` | 1 | extra requests when a reply fails validation (0 or 1) |
| `CONVERSATION_MAX_REPLIES` | 10 | replies in one conversation, the first included; the last is a statement |
| `CONVERSATION_CONVERGE_AFTER` | 6 | replies after which the agent is told to draw to a close |
| `CONVERSATION_REPLY_MAX_CHARS` | 480 | the longest answer |
| `CONVERSATION_SESSION_TTL_MS` / `_MAX_MS` | 1800000 / 10800000 | renewal window, and total lifetime from the first qualification |
| `CONVERSATION_QUALIFICATION_TTL_MS` | 900000 | how long the gate's qualification is good |
| `CONVERSATION_MAX_ATTEMPTS` | 3 | failed requests one step may cause |
| `CONVERSATION_RATE_MAX` | 40 per 10 min | per-isolate fallback when no binding |
| `CONVERSATION_ENABLED` | true | `false` switches generation off |
| `QUALIFICATION_SECRET` | derived | optional dedicated signing key (16+ characters) |

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
  140, statement 360, first-conversation answer 480.
- `auditOverflow()` walks the DOM and reports anything that would need
  scrolling. It runs after every render with `?audit`, and the browser harness
  asserts it at every state on every viewport. Intentional one- and two-line
  previews whose full text is one action away carry `data-clamp`.

## What is simulated

| Behaviour | Status |
|---|---|
| Begin → classification (PROCEED / BLOCK / UNAVAILABLE) | **Live**: Jev via TypeSafe AI, decided by fixed rules (see below). |
| First reflection and question after PROCEED | **Live**: one Claude request, validated server-side (see "The conversation"). |
| Replies to the visitor's answers, and the statement of the project's purpose | **Live**: one Claude request per reply, from the whole conversation, validated server-side; the visitor confirms or corrects the statement. |
| Relevance classification (4 tiers) | Simulated lexicon in the browser; no longer on the Begin path. |
| Discovery reflections, questions, options | Simulated: derived deterministically from the submission and prior answers. |
| Project statement and refinements | Simulated: composed from structured parts in four registers. |
| Model routing (Haiku / Sonnet / Opus) | Heuristic only; shown in *Prototype notes*, never used to call a model. |
| Think-time | Simulated delays, proportional to input length; `?fast` disables them. |
| Decision Channel handoff | Simulated: the record is built and a local receipt is issued; nothing is transmitted. |
| Accounts, email, persistence beyond this browser | Not present; the UI says so. |

Every simulated step is labelled in the interface (*simulated*, *prototype*).

## Production integration

1. **Jev**: done as a gate (see "The Jev gate"), and PROCEED now opens the
   conversation. BLOCK still stops at the diagnostic, which is its only
   handling.
2. **Claude**: the whole conversation is live, up to the confirmed statement of
   the project's purpose, with a signed per-conversation budget. What follows is
   the move of the confirmed statement and the transcript (`discovery.conversation`
   in the handoff record) into real requirements work in Decision Channel; the
   simulated `DiscoveryProvider` and `routing.js` remain the design for that.
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
- Begin sends the visitor's words to the Worker and on to TypeSafe AI (Jev),
  and, once they pass, to Anthropic (Claude), with each answer and the
  conversation so far; the text is not stored or logged by the site. The
  handoff record never leaves the browser.
- The conversation lives in the browser (and `localStorage`): nothing is held
  server-side between replies, which is what makes the signed count the guard.
  A visitor can resend an older history under a fresh qualification (checked by
  Jev again); the per-visitor rate limit and the token ceiling are what bound
  that.
- The per-qualification ledger (one request per qualification, remembered
  successes) lives in each Worker isolate. The rate limit, the qualification's
  short life and the token ceiling are what bound cost across isolates; a
  durable counter (a Durable Object or KV) is the next step if the volume
  justifies it.
- Reply quality is judged by reading real replies, not by a test: run
  `npm run test:live:conversation` (it flags speculation markers and menus of
  alternatives) after any change to `prompt.js`, and compare `CONVERSATION_EFFORT`
  levels. At `low`, 80 live replies to eight different descriptions had no
  rejections and two repairs, at about 2 to 3 s and 0.005 USD each; `medium` was
  not measurably slower but also not measurably better on that sample.
- Fonts load from Google Fonts, so the page makes that one outbound request. Self-hosting the three
  families is a straightforward follow-up.
- Browser tests run only where Chrome or Edge is installed.
