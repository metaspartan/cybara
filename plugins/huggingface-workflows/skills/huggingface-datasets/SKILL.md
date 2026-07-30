---
name: huggingface-datasets
description: Explore, validate, filter, paginate, export, and prepare Hugging Face datasets through the Dataset Viewer API and Hub tooling.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/dataset-viewer","os":["darwin","linux","win32"]}}
---

# Hugging Face Datasets

Prefer the read-only Dataset Viewer API for discovery and validation. Use Cybara's `http` tool so responses remain structured and visible in the chat.

## Read-only workflow

1. Validate the dataset with `GET https://datasets-server.huggingface.co/is-valid?dataset=<id>`.
2. Resolve subsets and splits through `/splits`.
3. Inspect representative records with `/first-rows`.
4. Paginate `/rows` with a zero-based `offset` and `length` no greater than 100.
5. Use `/search` for text and `/filter` for predicates instead of downloading the full dataset.
6. Inspect `/size`, `/statistics`, and `/parquet` before training or bulk processing.

URL-encode dataset IDs, subset names, split names, queries, and predicates. Add `Authorization: Bearer <token>` only for a gated or private dataset, and never expose the token in output.

## Training readiness

Before proposing a training run, report:

- dataset ID, revision, subset, and split
- row count and relevant columns
- a small redacted sample
- missing, malformed, duplicate, or unexpectedly long records
- license, gating, and provenance constraints visible in the dataset card
- the exact mapping required by the selected trainer

For SFT, verify text, conversational `messages`, or prompt-completion records. For preference training, verify prompt, chosen, and rejected values. For reward or RL workflows, verify the expected prompt and reward inputs.

Cybara Lab can export `hf_session_trace` data. Validate and redact that export before uploading it as a dataset.

Uploading, changing visibility, or deleting a dataset is an external side effect. Confirm the destination repository and affected files immediately before the write.
