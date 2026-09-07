# Compás Caribe

A vanilla JS + Vite 8 web application featuring animated 3D ocean (Three.js) and 2D particle effects (GSAP).

## Deployment

Deployed to Cloudflare Workers Static Assets via Wrangler.

**Custom Domains:**
- `compascaribe.com` (apex)
- `www.compascaribe.com` (www subdomain)

Both domains are configured as Workers Custom Domains on the `compascaribe` Worker. DNS and SSL certificates are automatically managed by Cloudflare when deployed.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm run build    # Production build
npm run preview  # Preview built output via wrangler dev
```

## Manual Deployment

```bash
npm run deploy
```

Deploy is manual — run `npm run deploy` to build and push to Cloudflare Workers.
