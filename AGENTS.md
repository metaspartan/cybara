# Cybara Agent Rules

## Package Manager Policy (Strict)
- Bun is the only allowed JavaScript/TypeScript package manager and task runner.
- Always use Bun commands:
  - `bun install`
  - `bun add <pkg>`
  - `bun remove <pkg>`
  - `bun run <script>`
  - `bun test`
  - `bunx <tool>`
- Never use `npm`, `npx`, `pnpm`, `yarn`, or `corepack` commands.
- Treat `bun.lock` as the canonical lockfile.

## Command Translation
- If docs/snippets mention npm-style commands, translate them to Bun equivalents before running.
- If a third-party instruction cannot run with Bun, stop and propose a Bun-compatible alternative.
