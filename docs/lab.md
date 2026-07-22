# Cybara Lab

The Lab turns completed agent work into material that can be replayed, compared, curated, and
exported. It is designed for regression testing, model and prompt evaluation, training-data
preparation, and inspection of desktop or simulator behavior.

## Enable the Lab

Open Settings -> Lab to control:

- the Lab feature and navigation surface
- automatic trajectory capture for persisted sessions
- the chat action for saving a completed turn as a golden run
- computer-use and simulator trajectory capture
- the default research export format
- export sanitization and media inclusion defaults

Disabling the Lab stops new chat trajectory capture and hides Lab actions. Computer-use capture has
its own toggle. Existing local data remains available when the Lab is enabled again.

## Trajectories and Golden Runs

A trajectory records the observable request, response, tool calls, tool results, timing, usage, and
run provenance for a persisted chat. Provider-exposed thinking can be retained, but Cybara never
infers or reconstructs hidden reasoning.

Saving a completed turn as a golden run creates a reusable regression case. Replaying it with the
current model, prompt, tools, and policy compares structural behavior such as tool selection, order,
arguments, outputs, and completion state rather than requiring identical prose.

Typical workflow:

1. Enable the Lab and trajectory capture.
2. Complete a representative chat task.
3. Save a successful assistant turn as a golden run.
4. Change a model, prompt, tool policy, provider pool, or runtime configuration.
5. Replay the golden run and inspect structural differences.

## Research and Training Exports

The Data tab supports selected or bulk exports in these formats:

| Format | Intended use |
|--------|--------------|
| Sequence distillation SFT | Teacher responses, provenance, observable reasoning, tool turns, and schemas |
| Hugging Face / TRL SFT | Message sequences and reconstructed tool turns for supervised fine-tuning |
| Hugging Face session trace | Viewer-compatible message and tool events from selected chats |
| Full agent trajectories | Prompts, responses, observable reasoning, and complete tool I/O |
| Long-context QA | Prompt, tool observations, and final completion |
| Prompt and completion | Minimal pairs for analysis or general training pipelines |

Exports use deterministic train, validation, and test splits so repeated exports remain comparable.
Trace quality checks flag missing prompts, missing final responses, failed tools, and missing tool
results. Dataset cards summarize the selected data and export settings.

Research endpoints:

```http
GET /api/evals/research/traces
GET /api/evals/research/export?format=distillation_sft&sanitize=true
GET /api/evals/research/card?format=distillation_sft&sanitize=true
GET /api/evals/export?format=jsonl&sanitize=true
```

## Computer-Use Data

Desktop, iOS Simulator, and Android Emulator actions can be captured with screenshots, action
coordinates, platform metadata, and post-action frames. These trajectories can be replayed for
debugging or exported for multimodal dataset workflows. Optional media inclusion should be enabled
only when screenshots are required by the downstream use case.

## Benchmarks

The benchmark tab runs a reproducible, judge-free suite with objectively graded tasks and persists
run progress so navigation does not discard an active run. Scores are internal ordinals for comparing
runs of the same suite version; they are not externally calibrated measures of intelligence.

## Data Safety

Trajectories can contain prompts, workspace paths, tool arguments and results, attachments,
screenshots, and provider-visible reasoning. Use sanitized exports before sharing data, inspect media
separately, and keep unsanitized trajectories inside the same trust boundary as the original chat.
