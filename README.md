# Compás Caribe

Ambitious ideas. Exceptional software.

Company website for Compás Caribe: bespoke applications, scalable platforms, connected operations, and intelligent workflows. Brand positioning, visual rules, and asset guidance live in [BRAND.md](BRAND.md).

## Development

```sh
npm ci
npm run dev
npm run build
npm run preview
```

The site uses vanilla JavaScript, plain CSS, Vite 8, and the Cloudflare Vite plugin. The interactive bearing is made from masked CSS surfaces with scroll-driven transforms. It uses native scrolling, stops rendering after settling, and respects reduced-motion preferences. There are no new runtime dependencies.

Outfit and Manrope fonts are self-hosted in `public/fonts/`, alongside their licenses. The site makes no third-party font requests.

## Content and assets

- `index.html`: all page content, semantic navigation, service disclosures, and project descriptions.
- `src/style.css`: brand tokens, responsive layouts, sculpture, and reduced-motion styles.
- `src/main.js`: scroll/pointer response and current copyright year.
- `public/brand-mark.svg`: reusable vector identity.
- `public/favicon.svg`: site icon.
- `public/social-card.svg` and `.png`: editable and rendered sharing artwork.

Project visuals are labeled interface concepts. Descriptions for Coordinador and Gastro Studio come from the existing company site; no case-study results or testimonials have been invented.

## Verification

Run `npm run build` and inspect `npm run dev` in a browser. Check desktop and mobile widths, native anchor links, keyboard-operated service/project disclosures, contact address, and scroll response. With reduced motion enabled, the hero is static and has no extended pinned sequence. Core content, links, and disclosures also work without JavaScript.

## Deployment

GitHub repository: `pbranesolutions/compascaribe`. Source of truth: `master`.

Preferred flow: PR → review → merge to `master` → Cloudflare Workers Builds.

- Production build command: `npm run build`.
- Production deploy command: `npx wrangler deploy`.
- Other branches build with `npm run build` and upload preview versions with `npx wrangler versions upload`.
- Worker: `compascaribe`.
- Hosting: Workers Static Assets with SPA fallback.
- Custom domains: `compascaribe.com` and `www.compascaribe.com`, configured in `wrangler.jsonc`.
- Observability is enabled.

Keep deployment configuration in source control. Do not make routine manual dashboard edits or deploy from a local working copy in place of the PR workflow.

## Contact

`hello@compascaribe.com` forwards through Cloudflare Email Routing to `compascaribesrl@gmail.com`.
