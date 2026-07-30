---
name: hf-cli
description: Inspect and manage Hugging Face Hub models, datasets, Spaces, repositories, cache, authentication, and downloads with the current hf CLI.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/huggingface_hub/guides/cli","os":["darwin","linux","win32"]}}
---

# Hugging Face CLI

Use the current `hf` CLI for Hub operations. Do not use the deprecated `huggingface-cli` command.

## Workflow

1. Run `hf version` and `hf --help` before relying on a command that may vary by installed version.
2. Use public read-only operations without authentication when possible.
3. For private or write operations, run `hf auth whoami` without printing stored tokens.
4. Prefer structured output such as `--format json` when another tool will consume the result.
5. Use `--dry-run` when supported before downloads, cache cleanup, synchronization, or deletion.
6. Confirm the repository, revision, visibility, and affected paths before uploads or destructive changes.

## Common operations

```bash
hf models info namespace/model --format json
hf models list --search "query" --limit 20 --format json
hf datasets info namespace/dataset --format json
hf datasets list --search "query" --limit 20 --format json
hf download namespace/model --include "*.json" --dry-run
hf cache list --limit 30
hf papers list --limit 20 --format json
```

Use `hf upload` for a bounded file or directory and `hf upload-large-folder` for resumable large uploads. Never place a token in command arguments, source files, logs, or chat output. Use the authenticated credential store or `HF_TOKEN` environment variable.

If `hf` is unavailable, report that prerequisite clearly. Do not install software unless the user requested installation.
