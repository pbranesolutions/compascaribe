# Compás Caribe

> Custom software, simple websites, and AI agents for real operations.

Company website for Compás Caribe, a Caribbean-based software development shop specializing in custom operations tools, web presence, and AI workflow automation.

## About

Compás Caribe builds software for operators and owners who need tools that fit how they already work. We create:

- **Custom software** — operations tools, catalogs, service workflows
- **Sites & presence** — fast, simple, Cloudflare-hosted websites
- **Bots & agents** — AI automation in workflows, inbox support, publishing pipelines

## Tech Stack

- **Framework**: Vanilla JavaScript + Vite 8 (ESM)
- **Styling**: Plain CSS with Caribbean ocean/compass theme
- **Hosting**: Cloudflare Workers Static Assets (SPA mode)
- **Deployment**: Manual via `npm run deploy` or auto-deploy via Workers Builds CI on `master`
- **Domain**: `compascaribe.com` (configured in Cloudflare dashboard)

## Development

```bash
# Install dependencies
npm install

# Run dev server (Vite)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Deploy to Cloudflare (requires auth)
npm run deploy
```

## Site Structure

Single-page site with sections:
- Hero — brand introduction with CTAs
- What we do — three service areas
- How we work — four-step process
- Selected work — case studies (Gastro Studio, Coordinador)
- Who it's for — target audience
- Contact — email and WhatsApp info
- Footer — copyright and tagline

## Design

- **Colors**: Caribbean ocean palette (deep blues, turquoise accents, sand text)
- **Typography**: Space Grotesk for clean, modern readability
- **Performance**: Lightweight CSS animations, no heavy 3D libraries
- **Accessibility**: WCAG-compliant contrast, keyboard navigation, reduced-motion support
- **Mobile-first**: Responsive design optimized for all screen sizes

## Deployment

This site is deployed via Cloudflare Workers Builds, which automatically deploys when changes are merged to `master`. The `wrangler.jsonc` config sets up:
- SPA fallback handling for client-side routing
- Observability enabled for production monitoring
- Node.js compatibility flags

To manually deploy:
```bash
npm run deploy
```

Requires Cloudflare authentication. Contact hello@compascaribe.com for access.

## Contact

- **Email**: hello@compascaribe.com
- **Website**: https://compascaribe.com

---

© 2026 Compás Caribe. Caribbean-based, globally connected.
