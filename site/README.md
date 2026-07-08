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
bun run typecheck  # tsc --noEmit
```

All page copy and lists (features, channels, platforms) live in
[`src/data/content.ts`](src/data/content.ts). Sections are components under
`src/components/`; the design system is in `src/styles/global.css`. The logo is
served from `public/cybara.png`.
