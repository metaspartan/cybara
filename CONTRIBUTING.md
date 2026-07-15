# Contributing to Cybara

Thanks for your interest in improving Cybara! This guide covers local setup,
the rules every change must follow, and how releases are produced.

## Package manager: Bun only

**Bun is the only allowed JavaScript/TypeScript package manager and runner.**
Never use `npm`, `npx`, `pnpm`, `yarn`, or `corepack`. If a third-party snippet
mentions npm-style commands, translate them to Bun before running:

| npm / others | Bun |
| --- | --- |
| `npm install` | `bun install` |
| `npm i -g <pkg>` | `bun add -g <pkg>` |
| `npm install <pkg>` | `bun add <pkg>` |
| `npm uninstall <pkg>` | `bun remove <pkg>` |
| `npm run <script>` | `bun run <script>` |
| `npx <tool>` | `bunx <tool>` |

`bun.lock` is the canonical lockfile — commit it with dependency changes.

## Local setup

```bash
git clone https://github.com/metaspartan/cybara.git
cd cybara
git switch dev
git pull --ff-only origin dev
bun install            # installs server + CLI dependencies
cd ui && bun install   # installs web UI dependencies
```

Run the full local check (this is what CI runs on every PR):

```bash
bun run check:ci
```

That runs: `typecheck` → `lint` → `check:loc` → `test:smoke` → `deadcode:report`.

Useful scripts:

- `bun run dev` — build once, then run the server in watch mode
- `bun run ui:dev` — Vite dev server for the web UI
- `bun run cli` — run the CLI from source (`bun run src/cli.tsx`)
- `bun run sexy:write` — typecheck + lint + auto-format with prettier

## Code style

- TypeScript everywhere; pass `bun run typecheck` with no errors.
- Respect prettier formatting (`bun run format`) — CI checks this.
- Match the surrounding code's naming, comment density, and idioms.
- The CLI has a hard size guard (`check:loc`); keep `src/cli.tsx` under its
  limit by extracting logic into `src/core/*` modules rather than inlining.

## Adding or updating models / providers

The single source of truth is [`src/core/providers.ts`](src/core/providers.ts).
The TUI (`src/cli.tsx`), web UI (`ui/src/pages/Providers.tsx`, which fetches
dynamically), and CLI defaults all consume it — so editing that one file
propagates everywhere. When you add a provider, also:

1. Add an entry to the `providers` catalog with exact model IDs, context
   windows, max tokens, reasoning flag, and input modalities.
2. Add any aliases to `PROVIDER_TYPE_ALIASES`.
3. Set a sensible default model in `getDefaultModel()`.

Prefer OpenAI-compatible providers (`api: "openai-completions"`) — they need no
new protocol code. New API protocols require matching branches in the agent loop
(`src/core/agent.ts`).

## Development workflow

`dev` is the integration branch for ongoing development. Create contribution
branches from the latest `dev` branch and open pull requests against `dev`:

```bash
git switch dev
git pull --ff-only origin dev
git switch -c <type>/<short-description>
```

Keep an existing contribution branch current with `origin/dev` before requesting
review. The `main` branch is reserved for tested release merges from `dev` and
maintainer-directed hotfixes.

## Pull requests

- Branch off `dev` and target `dev`. Keep pull requests focused.
- Ensure `bun run check:ci` is green before requesting review.
- Don't commit `release/` artifacts, build output, or signing keys.
- Don't bump the version yourself. The `main-version-tag.yml` workflow derives
  it from the commit count and syncs it across files automatically.

## Release process

Releases are **fully automated** from git tags:

1. A tested release merge from `dev` to `main` triggers
   `main-version-tag.yml`, which syncs the version across
   `package.json`, `ui/package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`, then tags `v<version>`.
2. The `v*` tag triggers `release.yml`, which runs the quality gate and produces
   the supported CLI, desktop, native macOS, mobile, and package release
   artifacts.
3. Users update with `cybara update` (verifies SHA256) or the in-app desktop
   updater (verifies the Tauri signature + `latest.json`).

See [`SECURITY.md`](SECURITY.md) for the signing secrets maintainers must
configure, and [`docs/desktop.md`](docs/desktop.md) for desktop-specific notes.
