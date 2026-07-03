---
name: cloudflare-temporary-deploy
description: Deploy a temporary Cloudflare Workers preview with Wrangler for short-lived web app smoke tests.
metadata: {"cybara":{"requires":{"bins":["bun"]}}}
---

# Cloudflare Temporary Deploy

Use this when the user wants a short-lived public smoke-test URL for a Worker or static web app without setting up a permanent Cloudflare project.

Cybara repos use Bun. Translate npm/npx examples to `bunx`.

## Preconditions

- Node-compatible project or Worker entrypoint.
- No Cloudflare credentials in the shell when using `--temporary`.
- Temporary deployments expire unless claimed.
- Treat the claim URL as credential-equivalent.

## Commands

Check Wrangler:

```bash
bunx wrangler@latest --version
```

Deploy:

```bash
bunx wrangler@latest deploy --temporary
```

Capture output to parse URLs:

```bash
bunx wrangler@latest deploy --temporary 2>&1 | tee /tmp/wrangler-temporary-deploy.log
```

Verify the live URL:

```bash
curl -sS "<live_url>"
```

## Rules

- Always verify the live URL with `curl`; do not trust deploy output alone.
- If the shell is authenticated, `--temporary` may fail by design. Ask before logging out or unsetting credentials.
- Do not put secrets into Worker source, Wrangler config, or deploy logs.
- For anything longer-lived than a demo/smoke test, use a real Cloudflare account and configured project.
