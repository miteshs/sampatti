# Sampatti relay

A ~50-line Cloudflare Worker that lets people use Sampatti without their own Anthropic key.
It forwards each request to the Anthropic API and streams the answer back. **That's all it
does.**

## The privacy contract

- **No storage.** The Worker binds no KV / D1 / R2 / Durable Object — there is physically
  nowhere for it to keep your data. The portfolio brief is held only in memory for the
  milliseconds it takes to forward the request.
- **No logging of content.** We never log request or response bodies.
- **Pass-through only.** We inject the API key and `anthropic-version`; we do not read,
  rewrite, or persist the body. Anthropic does not train on API traffic.

Users who want zero third parties in the path can switch to **"My own Anthropic key"** on
the Privacy screen — then the app talks to Anthropic directly and never touches this relay.

## Deploy

```
cd relay
npm install
npx wrangler secret put ANTHROPIC_API_KEY     # required
npx wrangler secret put APP_TOKEN             # optional shared token (recommended)
npm run deploy
```

Put the resulting URL in the app (Privacy → Relay URL). If you set `APP_TOKEN`, the app must
send it as `x-app-token` — wire it into `streamClaude`/`claude_stream` headers.

> A Vercel Edge Function or any other stateless host works equally well — the only
> requirements are: keep the key server-side, stream the response through, and store nothing.
