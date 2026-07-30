---
name: huggingface-papers
description: Discover and analyze Hugging Face papers with traceable sources, linked models and datasets, and clearly separated claims and evidence.
metadata: {"cybara":{"homepage":"https://huggingface.co/papers","os":["darwin","linux","win32"]}}
---

# Hugging Face Papers

Use `hf papers list --format json` or the Hub papers pages for discovery, then inspect the original paper before relying on a claim.

## Workflow

1. Capture the title, authors, publication date, paper URL, and stable identifier.
2. Read the abstract, method, training data, evaluation setup, ablations, limitations, and license.
3. Follow linked model, dataset, code, and demo repositories only when they are relevant.
4. Distinguish author claims from reproduced or independently verified results.
5. Compare metrics only when tasks, splits, prompts, baselines, and compute settings are compatible.
6. Cite the original paper and primary artifacts near each technical claim.

Do not infer implementation details that are absent from the paper or its linked source. State when evidence is missing, unpublished, or not reproducible from available artifacts.
