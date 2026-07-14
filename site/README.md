# Cybara Site

Marketing site for Cybara. React + TypeScript + Vite, Bun-only.

## Develop

```bash
cd site
bun install
bun run dev        # http://localhost:3399
```

## Build

```bash
bun run build      # type-checks, then emits dist/
bun run preview    # serve the production build on 3399
bun run typecheck  # native TypeScript 7 check
```

## Docker

```bash
cd site
docker compose up --build     # builds dist and serves on http://localhost:3399
```

The multi-stage `Dockerfile` builds with Bun, then serves the static `dist/` with
`serve.ts` (a tiny Bun static server) on the `PORT` env var (default 3399). Or
run it directly:

```bash
docker build -t cybara-site .
docker run -p 3399:3399 cybara-site
```

All page copy and lists (features, channels, platforms) live in
[`src/data/content.ts`](src/data/content.ts). Sections are components under
`src/components/`; the design system is in `src/styles/global.css`. The logo is
served from `public/cybara.png`.
