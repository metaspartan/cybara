---
name: code-wiki
description: Generate architecture wiki docs, module maps, and Mermaid diagrams for a codebase using Cybara file/search/write tools.
metadata: {"cybara":{"requires":{"bins":["git","rg"]}}}
---

# Code Wiki

Use this when the user asks to document a repository, generate architecture diagrams, create a code wiki, or onboard to an unfamiliar codebase.

This is a reference-documentation workflow. It explains what exists and how it fits together; it is not a product strategy or roadmap exercise.

## Output Location

Default to `~/.cybara/wikis/<repo-name>/` so active repositories are not modified. Only write under the repo, such as `docs/wiki/`, when the user explicitly asks for in-repo documentation.

## Workflow

1. Resolve the target repository.
   - If the user gave a local path, use that path.
   - If they gave a GitHub URL, clone with `git clone --depth 50 <url> <tmp>/repo`.
   - Record `git rev-parse HEAD` when available.
2. Scan the structure with `rg --files`, excluding generated and dependency dirs:
   - `.git`, `node_modules`, `dist`, `build`, `target`, `.next`, `.expo`, `coverage`, `venv`, `.venv`.
3. Read the README, manifests, and main entry points:
   - `package.json`, `bun.lock`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Package.swift`, app entry files.
4. Pick 8-10 modules for the first pass.
   - Prioritize entry points, shared/core modules, API boundaries, UI route roots, persistence layers, and integration adapters.
5. Write:
   - `README.md` with purpose, concepts, entry points, and module map.
   - `architecture.md` with a Mermaid flowchart.
   - `modules/<module>.md` for each selected module.
   - `diagrams/sequences.md` with 2-4 key workflows.
   - `getting-started.md` with verified local commands.
   - `.codewiki-state.json` with repo path, commit, generated time, and files reviewed.

## Quality Bar

- Every statement should trace to code, config, or docs you read.
- Use relative links for local output; use commit-pinned GitHub links for cloned public repos.
- Keep Mermaid valid and readable. Prefer `flowchart LR` for architecture and `sequenceDiagram` for workflows.
- Do not document generated bundles or dependency directories.
- Do not claim coverage of the whole repo when you only sampled modules; list gaps explicitly.

## Verification

After writing the wiki:

```bash
find "$OUTPUT_DIR" -type f | sort
rg -n "TODO|TBD|unknown" "$OUTPUT_DIR" || true
```

Read the generated `README.md` and one module page before reporting paths back to the user.
