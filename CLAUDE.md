# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Project Shape

- **Stack:** Vanilla JS + Vite 8 (ESM). No frontend framework. Lightweight CSS animations only — no GSAP or Three.js. Caribbean ocean/compass theme via CSS gradients and SVG.
- **Hosting / deploy:** Cloudflare Workers Static Assets via Wrangler (`@cloudflare/vite-plugin`) — assets-only with SPA fallback, **no Worker code exists** in this repo. Workers Builds CI is connected to this repo on `master` branch; merging to `master` triggers auto-deploy. Manual deploy via `npm run deploy` also works.
- **Custom domain:** `compascaribe.com` is configured in the Cloudflare dashboard, not in `wrangler.jsonc`. Don't try to change domains via this repo.
- **Content / copy lives in:** `index.html` at the repo root — all site content, sections, and copy. `src/` contains **only** `main.js` (minimal entrance animations and smooth scroll) and `style.css`.
- **Styling:** Plain CSS in `src/style.css` (no Tailwind, no CSS-in-JS in dependencies). Caribbean ocean palette, Space Grotesk font, mobile-first responsive design.
- **Site language:** English. Only the brand name "Compás Caribe" is Spanish. Default to English for copy edits unless asked otherwise.
- **Site structure:** One-page company site with sections: Hero, What we do, How we work, Selected work, Who it's for, Contact, Footer.
- **Don't touch without asking:**
  - `wrangler.toml` / `wrangler.jsonc` (deploy config)
  - `vite.config.*` (build config)
  - `package.json`, `package-lock.json` (no dep changes unless requested)
  - `dist/` (build output — never edit by hand)
  - Any `.env*` files or secrets
- **Run before declaring done:** `npm run build` must succeed. There is no lint or test script — if you add tests, add the script too. For visual/animation changes, also run `npm run dev` and confirm in a browser.
- **Local preview:** `npm run dev` (Vite dev server). `npm run preview` runs a full build and serves it via `wrangler dev`; since there's no Worker code, this is essentially a static preview of the built `dist/`.
- **Performance note:** Site is intentionally lightweight — vanilla JS, CSS animations only. Avoid adding heavy dependencies.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly and proceed. Only stop to ask when ambiguity would change the *approach*, not when it would only change a detail you can flag inline.
- If multiple interpretations exist and they lead to materially different work, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is genuinely blocking, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No defensive code for scenarios the type system or call site already prevents. (Real edge cases still need handling — "impossible" is where bugs live.)
- Before writing, sketch the shape. If the sketch is 200 lines and it could be 50, start over.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style by default. If existing style is genuinely broken (real bug pattern, not just a preference), flag it and ask before changing.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Verification Before "Done"

**"It should work" is not done.**

Before claiming a task is complete:
- Run `npm run build`. If it fails, the task isn't done.
- For UI/animation changes, run `npm run dev` and confirm visually (or describe exactly what to check if you can't).
- For Worker-touching changes, run `npm run preview` — `npm run dev` does not exercise the Worker.
- Report what you ran and what passed. If you skipped a check, say which and why.
- **Never run `npm run deploy` on your own.** That ships to production. Always ask first.

## 6. Destructive Operations

**Confirm before doing anything you can't undo.**

Always pause and ask explicitly before:
- `npm run deploy` (ships to production Cloudflare Worker)
- `git push --force` or any history rewrite
- Deleting branches, files, or directories beyond the immediate task
- Touching `wrangler.toml`/`wrangler.jsonc`, env vars, or secrets
- Modifying CI/CD config or DNS
- `rm -rf`, `npm publish`, or anything similarly one-way

Mid-task is not a license to skip the confirmation. Stop and ask.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, and "done" actually means done.
