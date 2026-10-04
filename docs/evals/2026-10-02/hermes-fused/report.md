# Cybara fused mode vs Hermes — October 2, 2026

## Result: a scoped speed/token win, not an all-metric win

The first permission-matched pilot completed **6/6 correctly for both harnesses**. Cybara finished in **48.4% less mean wall time** and used **28.2% fewer total input-plus-completion tokens**. However, **Hermes used fewer provider requests: 31 versus Cybara’s 42**. The graphic displays this tradeoff rather than claiming universal superiority.

### Headline pilot: unchanged three tasks, two rotated rounds

| Metric | Cybara fused mode | Hermes v0.21.5 | Interpretation |
| --- | ---: | ---: | --- |
| Correct outputs | 6/6 | 6/6 | Same fixture success |
| Mean completion time | 27.132 s | 52.573 s | Cybara: 48.4% less time |
| Median completion time | 19.318 s | 50.075 s | Small convenience sample |
| Provider requests | 42 | 31 | Hermes: fewer requests |
| Input tokens | 149,192 | 217,832 | Cybara: fewer input tokens |
| Completion tokens | 11,145 | 5,390 | Hermes: fewer completion tokens |
| Total input + completion | 160,337 | 223,222 | Cybara: 28.2% fewer total tokens |
| Cached input | 124,891 | 174,379 | Included in input totals |
| Failed provider requests | 0 | 0 | Complete usage on both sides |
| Actual reasoning effort | high | high | Matched wire control |
| Actual output cap | 8,192 | 8,192 | Matched wire control |

`replication.json` is the headline source. Its name reflects execution order: the earlier run exposed a permissions mismatch and was retained as diagnostic evidence. None of its more favorable percentages were substituted into this card. The requested outputs were independently recomputed from original fixture contents; all 12 outputs passed and all 20 readonly input instances were unchanged.

These are three distinct tasks run twice, not six distinct benchmark tasks. They are the exact prompts, inputs and assertions from the previous fused-mode comparison: multi-file ledger, exact retrieval with ordered commands, and boundary transformation. No fixture or Cybara agent source was tuned during this comparison.

## Unchanged confirmation

A second full permission-matched run again passed **6/6 for both** with no failed provider requests and complete usage. Cybara: **14.530 s** mean, **63,917** total tokens and **23** requests. Hermes: **58.081 s** mean, **181,477** total tokens and **26** requests. Both sent high reasoning and the same 8,192 cap. Independent recomputation passed all 12 outputs; all 20 readonly input instances were unchanged.

Across the two permission-matched runs, both completed **12/12** trials. The repeated tasks are not twelve distinct tasks. The graphic retains the first matched run's more conservative speed/token figures rather than replacing them with the repeat's larger gains. Request counts varied materially: Hermes won the first matched run (31 versus42), Cybara the repeat (23 versus26). The headline therefore makes no consistent fewer-requests claim.
## Versions and controls

- Cybara commit `2de80a6e141636fbcfc41d7090841ec8e118687c`, Bun 1.4.2, opt-in fused execution with read/write verification helpers.
- Official Hermes stable release `v2026.9.24`, package `0.21.5`, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`. The official latest-release API returned this release on October 2, 2026. The source checkout remained unmodified; its editable installation used Python 3.11.9.
- Same authorized `space-bunny-free` route: `https://opencode.ai/zen/v1/chat/completions`. The same proxy measured actual requests and controls without recording upstream credentials.
- Hermes received its stock `terminal,file,code_execution` toolsets, including its own programmatic execution capability, not an artificially restricted read/write-only competitor. Its 60-turn allowance was not exhausted. Each trial had a 180-second overall ceiling.
- Fresh sessions and fixture homes; task/harness order rotated between rounds. Cybara used the same fused configuration as the earlier pilot. No model budget was changed based on which harness was running.
- Hermes output cap came from supported custom-provider `extra_body.max_tokens: 8192`; CLI `reasoning="high"` selected reasoning. Actual wire records—not merely configuration intent—were checked.
- Both used unattended approvals in disposable local fixtures: Cybara’s fixture profile `always_allow`, Hermes’s supported `HERMES_YOLO_MODE=1`. Production approval settings were not changed.
- Hermes automatic title model upgrades were disabled through `auxiliary.title_generation.model_upgrade_enabled: false`; derived titles remained enabled. This matches Cybara’s local-title behavior and avoids an unrelated low-effort request. The failed title request in preflight is retained, not counted as a successful paired run.

## Setup and environment limitations

The first smoke/preflight trial passed its task but Hermes also issued an auxiliary title request that returned HTTP 400 with unavailable usage. Its totals remain unknown. The subsequent `main.json` passed 6/6 for each harness but still used Hermes’s default unattended safety mode, which blocked inline script verification commands. It is preserved but excluded from the graphic. Only the first fully permission-matched six-trial pilot is used for the headline.

This is a Windows-local setup: a **warm Cybara gateway versus a cold Hermes Python CLI**. Hermes local file/environment initialization, persistent code kernel startup and cleanup are inside its measured wall time. The result does not isolate pure harness overhead, first-token latency or token-generation speed. Provider responses were buffered by the measurement proxy, and hosted cache, queue and sampling variability were not fully controlled.

Hermes logged an optional `nemo_relay` module-unavailable warning and selected SQLite DELETE journaling because its Python-linked SQLite version was below the recommended WAL fix. Its code execution was available and successfully used, though some generated snippets failed and were corrected within the run. These environment details and model retries are not removed from the timing or request totals. Neither checkout was modified to fix or slow the competitor.

Cybara also had costly repeated tool rounds: one exact-retrieval trial took 68.953 seconds and 15 requests. All such trials remain in the mean and totals; no outlier was dropped. The request-count advantage therefore belongs to Hermes in this pilot, despite Cybara’s lower overall tokens and wall time.

Raw total tokens include cached input. A 28.2% token reduction is **not** a 28.2% monetary-cost or compute-cost claim. This small adaptive engineering fixture study is not Terminal-Bench, SWE-bench, a blinded held-out dataset, or proof of universal accuracy/performance superiority.

## Deliverables

- Raw preflight, diagnostic main and permission-matched pilot receipts, independent checks, fixture definitions and version/source hashes are in this directory.
- Separate PNG and editable SVG: `docs/marketing/2026-10-02/cybara-vs-hermes.png` and `.svg`, generated by `generate-hermes.ts` from archived scored receipts.
- The previous OMP graphics and receipts remain unchanged. No application source, release workflow, installed application, or live gateway on port 4269 was changed. No social post was sent.

## Acceptance

Both matched six-trial receipts were checked directly for high reasoning,8,192 caps, successful provider requests, complete usage and correct actual output files. Independent reference implementations matched the benchmark scorer and preserved20 input instances in each phase. The generator's strict TypeScript check passed. The full local `bun run check:ci` passed with all eight smoke groups green:3146 core tests passed, zero failures, and two unchanged existing platform-specific skips. Documentation consistency checks passed. No new skip, suppressed failure, application code change, commit or push was added for this task.
