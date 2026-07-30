---
name: huggingface-community-evals
description: Run reproducible local or remote model evaluations with inspect-ai or LightEval, bounded smoke tests, captured configurations, and comparable results.
metadata: {"cybara":{"homepage":"https://huggingface.co/docs/evaluate","os":["darwin","linux","win32"]}}
---

# Hugging Face Community Evaluations

Use Inspect or LightEval for models hosted on the Hub. Keep evaluation execution separate from publishing results.

## Workflow

1. Record the model ID, immutable revision, inference backend, tokenizer, chat template, dtype, quantization, generation parameters, task revision, and seed.
2. Check gated-model authentication without printing credentials.
3. Choose a backend supported by the model and hardware. Prefer vLLM for supported throughput workloads and Transformers or Accelerate as compatibility fallbacks.
4. Start with a bounded smoke run such as 10 examples.
5. Inspect failures and sample outputs before scaling.
6. Save raw results, aggregate metrics, environment metadata, and the exact command.
7. Compare only runs with compatible task versions, prompts, few-shot settings, and inference parameters.

Use `uv run` for Python evaluation environments. Run remote evaluation through the `huggingface-jobs` workflow only after confirming paid hardware and timeout.

Do not cherry-pick favorable tasks, silently discard failures, or present incomparable scores in one ranking. Publishing model-card results, opening a pull request, or modifying a leaderboard is a separate external action that requires confirmation.
