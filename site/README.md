# Sampatti landing page

A single static page (`index.html`) — no build step, no framework. Same "editorial calm" design
system as the app (warm paper, indigo accent, Fraunces + Inter), with the fonts **self-hosted** so
the marketing page honours the same no-CDN privacy stance as the product.

## What's here

```
site/
  index.html            the whole page (styles inline in <head>)
  _headers              Cloudflare Pages security + cache headers
  assets/
    logo.svg            the app icon
    fonts/              Inter + Fraunces (latin variable woff2), self-hosted
    shots/              app screenshots — REGENERATED from the current build
```

## Preview locally

```
cd site && python3 -m http.server 8080   # → http://localhost:8080
```

## Refresh the screenshots

The screenshots are captured from the **current** build so they never go stale. After any UI
change, re-run:

```
node scripts/landing/shots.mjs            # writes site/assets/shots/*.png (@2x retina)
```

It builds the app, loads the demo portfolio with a frozen clock, and shoots Overview /
Performance / Holdings / Analysis (India), plus dark-mode and US-mode overviews.

## Deploy (Cloudflare Pages)

Recommended, since the project already lives in the Cloudflare ecosystem:

```
npx wrangler pages deploy site --project-name sampatti-site
```

Or wire it through the dashboard: **Cloudflare → Workers & Pages → Create → Pages → Connect to
Git**, set the build output directory to `site/` and leave the build command empty (it's static).
Then add your custom domain under the project's **Custom domains** tab.

## Before going live — TODO

- **Domain:** set the absolute `og:`/canonical URL in `index.html` (search `TODO(domain)`).
- **Download buttons:** they point at the latest GitHub release and, via a small script,
  resolve the actual `.dmg`/`.exe` for one-click download. For a cleaner URL later, a tiny
  Cloudflare Worker at e.g. `/download/mac` can 302 to the newest asset.
- **Share image:** `og:image` currently uses the overview screenshot; swap for a purpose-made
  1200×630 card if you want tighter social previews.
