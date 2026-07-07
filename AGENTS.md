# Cybara Agent Rules

Rules for any AI agent or contributor working in this repo. Follow them exactly;
they override default habits. Deeper conventions live in `CLAUDE.md`.

## Package Manager Policy (Strict)

- Bun is the only allowed JavaScript/TypeScript package manager and task runner.
- Always use Bun commands:
  - `bun install`
  - `bun add <pkg>`
  - `bun remove <pkg>`
  - `bun run <script>`
  - `bun test`
  - `bunx <tool>`
- Never use `npm`, `npx`, `pnpm`, `yarn`, or `corepack`.
- Treat `bun.lock` as the canonical lockfile.
- Prefer Bun-native APIs (`Bun.spawn`/`Bun.spawnSync`, `Bun.file`) over `child_process`/`fs` shell-outs.

## Command Translation

- If docs or snippets mention npm-style commands, translate them to Bun equivalents before running.
- If a third-party instruction cannot run with Bun, stop and propose a Bun-compatible alternative.

## TypeScript Type Safety

- Never use `any` — not in signatures, casts, generics, or `as any`. It is banned.
- Model real shapes with `interface`/`type`. For genuinely unknown input use `unknown`
  and narrow it before use (type guards, discriminated unions).
- Type every exported function's parameters and return value explicitly. Do not rely on
  inference across module boundaries.
- Avoid non-null assertions (`!`). Handle `null`/`undefined` with `?.` and `??`.
- No `@ts-ignore` / `@ts-expect-error` to silence real errors — fix the type instead.
  If a third-party type is missing, declare a local `interface` for the slice you use.
- Keep functions and route handlers returning consistent, fully-typed API shapes
  (snake_case fields for HTTP responses — see `CLAUDE.md`).

## No Comments

- Write code with no comments. Names and structure carry the meaning.
- Do not add header blocks, JSDoc, inline `//` notes, or commented-out code.
- Never reference other products, competitors, or external projects anywhere in code or comments.
- The rare exception is a short `/* ... */` note only when logic is genuinely non-obvious
  and cannot be made clear by renaming or restructuring; default to none.

## DRY & Code Quality

- Extract shared logic into a well-named helper or module; do not copy-paste blocks.
  Adapters/handlers that repeat a pattern should share a single utility
  (e.g. `channels/access-gate.ts`, `wallet-url-guard.ts`, `api/html-escape.ts`).
- One responsibility per function; keep them small and composable.
- Reuse existing helpers before writing new ones — search first.
- Match the surrounding code's style, naming, and idioms.
- Fail closed on security-sensitive paths (auth, path/URL validation, access control):
  when in doubt, deny.
- Validate and sanitize all external input (tool args, webhooks, request bodies) at the boundary.
- Hard file cap: no TypeScript file may exceed **5000 LOC** (`bun run check:loc`).
  If an edit pushes a file over, extract a cohesive module instead.
- Do not leave dead exports; `bun run deadcode:report` surfaces them.

## Tests (Required)

- Every behavior change or fix ships with tests. Bug fixes get a regression test that
  fails on the old code and passes on the new.
- Use `bun:test` (`describe`/`test`/`expect`) under `tests/`, mirroring the source path.
- Test the real contract: security fixes must prove the exploit is blocked (e.g. feed the
  malicious input and assert it is rejected), not just that the happy path still works.
- Cover edge cases: empty/malformed input, boundaries, `null`/`undefined`, and failure modes.
- Prefer fast, dependency-free tests. For network/protocol code, stand up a local fake
  (e.g. an in-process server) rather than mocking away the logic under test.
- Keep tests deterministic and isolated; clean up any files/state they create.

## Before You Finish

Run the full gate and make it green — no skips, no `--no-verify`:

```bash
bun run check:ci
```

This runs: `typecheck` + `ui:typecheck` (`tsc --noEmit`), `lint` + `ui:lint` (eslint),
`check:loc` (5000-LOC cap), mobile typecheck, `test:smoke`, and `deadcode:report`.
Report results honestly — if something fails or was skipped, say so.
