# Agent harness comparison — 2026-10-01

## Evidence standard

This report separates published benchmark evidence from a local same-model pilot. A product feature inventory, model-provider throughput claim, or one successful task is not a harness accuracy score. Cybara's superiority in speed, token efficiency, or correctness is a hypothesis to evaluate, not a conclusion assumed in advance.

## Current source-backed facts

| Entity | Verified source / version | Benchmark relevance | What remains unproven |
| --- | --- | --- | --- |
| Cybara | Local checkout `787d78c9`, with uncommitted browser-import and context-accounting work | Includes an internal capability smoke suite and trajectory evaluation infrastructure | No independent same-model head-to-head result established by the sources inspected |
| Hermes Agent | Official stable release `v2026.9.24`; release checkout resolves to `f97608f178d1ffeca59860195ab7da295f7c8e5f`; package declares `0.21.5` | Real terminal/file tools, toolset selection, one-shot CLI; official source is suitable for a pinned adapter | No verified comparable Space Bunny Free speed/token/accuracy result obtained |
| OpenClaw | Official stable release `v2026.9.7`, published 2026-09-30; package `2026.9.7` | Custom OpenAI-compatible providers, embedded headless agent execution and JSON usage output | No verified comparable Space Bunny Free speed/token/accuracy result obtained |
| oh-my-pi | Official latest release inspected `v18.4.8`, published 2026-10-01 | Useful implementation reference; a distinct coding harness | Not included in a measured comparison yet |
| Space Bunny Free | Official OpenCode Zen model ID `space-bunny-free`; endpoint `https://opencode.ai/zen/v1/chat/completions` | Official page lists free input/output/cache pricing and describes a limited-time stealth model | Identity/weights are undisclosed; equal API model IDs do not prove backend weights stayed fixed across time |

Cybara's currently configured Space Bunny route is `opencode-go` at `https://opencode.ai/zen/go/v1`. A head-to-head must use one verified upstream route for all participants; do not silently compare different gateways.

## Professional evaluation choices

- **Terminal-Bench 4.0 / Harbor:** the official Terminal-Bench page currently identifies 4.0 and links to tasks hosted by Harbor. Suitable for terminal execution and environment-level success checks. Its live leaderboard was verified in the embedded browser at 2026-10-01T08:16Z. Examples: GPT-6 Astra (max) + Codex: 58.2% ± 2.8% (1.5B tokens, $3.3k); Fable 5.1 (max) + Claude Code: 57.9% ± 3.8% (2.7B tokens, $6.2k); GLM-5.3 (max) + Claude Code: 41.8% ± 3.2% (8.7B tokens, $2.7k). The page labels these as 95% confidence intervals. These are different model/harness pairs, not evidence that one harness alone is better. The inspected 4.0 table did not list Cybara, Hermes, OpenClaw or Space Bunny Free.
- **SWE-bench Verified:** 500 human-filtered software-engineering issues. The official site's Bash Only view fixes the harness to mini-SWE-agent; those model results are not scores for Cybara, Hermes or OpenClaw. A harness study needs each harness to run the same issue set and test-based grader.
- **ProgramBench:** the official SWE-bench site announced this in May 2026 for meaningful software artifacts written from scratch. Useful for broader build-from-scratch quality, but not a substitute for controlled latency/token accounting.
- **Local controlled pilot:** fresh fixture workspace per task/round/harness, pinned releases, one upstream model and endpoint, identical task content and budgets, independent exact output checks, sequential rotated order, complete provider request counts and usage. This is an engineering pilot, not an official benchmark score.

Docker Desktop's Linux daemon is unavailable on this host at inspection time. No official container benchmark run is claimed.

## Measurement contract

Record task-level success independently from an agent's own completion claim. Report wall-clock time including harness startup, tool execution, provider requests, retries and summaries. Sum provider input, output and cached-input tokens across every request. Unknown provider usage is `null`, never fabricated as zero. Report failures/timeouts, not only successful runs. Preserve task-level artifacts and version receipts so a result can be reproduced.

Compare token use on tasks that both harnesses solve; fewer tokens from a failed/incomplete task are not an efficiency win. Report all-task success first, then matched-success latency/token summaries. For formal release claims, expand the suite, repeat trials, use paired statistics/confidence intervals, control cache warming and provider drift, and publish task selection before running. Do not call a tiny pilot statistically decisive.

## Sources

Retrieved 2026-10-01:

1. OpenCode Zen model IDs, endpoints, pricing and retention: https://opencode.ai/docs/zen/
2. Hermes Agent release: https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24
3. Hermes official tools and toolsets: https://hermes-agent.nousresearch.com/docs/user-guide/features/tools
4. Hermes one-shot implementation: https://github.com/NousResearch/hermes-agent/blob/v2026.9.24/cli.py
5. OpenClaw release: https://github.com/openclaw/openclaw/releases/tag/v2026.9.7
6. OpenClaw headless agent CLI: https://docs.openclaw.ai/cli/agent
7. OpenClaw custom providers: https://docs.openclaw.ai/concepts/model-providers/custom-providers
8. oh-my-pi release: https://github.com/can1357/oh-my-pi/releases/tag/v18.4.8
9. Terminal-Bench: https://www.tbench.ai/
10. SWE-bench official protocol and news: https://www.swebench.com/

## Measured local pilot

Completed 2026-10-01T09:06:55Z. Three file-grounded tasks × two rounds × two runnable harnesses = twelve trials. Same `space-bunny-free` API ID, same Zen endpoint, same input files/task prompts, independent exact JSON-output checks, sequential rotated order. Buffered proxy mode; reasoning `high` requested in both adapters, but actual provider shaping equivalence is not proven.

| Metric | Cybara | Hermes Agent | OpenClaw |
| --- | ---: | ---: | --- |
| Independently correct tasks | 6/6 | 6/6 | Not scored: infrastructure failure |
| Mean wall time / task | 18.655 s | 55.617 s | Not comparable |
| Median wall time / task | 14.877 s | 52.833 s | Not comparable |
| Observed p95 / maximum at n=6 | 33.716 s | 72.843 s | Not comparable |
| Provider requests | 35 | 38 | Not comparable |
| Failed provider requests | 0 | 6 HTTP 400s | Adapter failed before valid trial |
| Complete input-token total | 170,509 | Unknown | Unknown |
| Complete output-token total | 6,072 | Unknown | Unknown |
| Known successful-request input subtotal | 170,509 | 170,947 | Not comparable |
| Known successful-request output subtotal | 6,072 | 4,442 | Not comparable |
| Cached-input subtotal | 126,953 | 120,891 on reported requests | Not comparable |

The latency ratio is **2.98×** (Cybara's mean is **66.5% lower**) for this pilot. Both harnesses tied on correctness. This does **not** establish better accuracy or least-token performance. Cybara used more known output tokens; Hermes' six failed requests had unknown usage, so its full totals are intentionally `null`. The input subtotals are nearly equal and insufficient for an efficiency claim.

### Task-level times

| Task / round | Cybara | Hermes | Correct output |
| --- | ---: | ---: | --- |
| Multi-file ledger / 1 | 33.716 s | 55.098 s | Both |
| Exact retrieval / 1 | 8.640 s | 47.149 s | Both |
| Boundary transform / 1 | 29.520 s | 72.843 s | Both |
| Exact retrieval / 2 | 10.301 s | 39.441 s | Both |
| Boundary transform / 2 | 17.370 s | 68.605 s | Both |
| Multi-file ledger / 2 | 12.384 s | 50.568 s | Both |

### Important confounds

- Cybara ran against an already-started isolated gateway; Hermes started its Python one-shot CLI for each trial. Thus the observed latency includes different startup costs. It is an end-user workflow measurement, not pure warmed harness overhead.
- The fixture task set is small and straightforward, not a held-out repository-repair or autonomous long-horizon benchmark. No significance, general accuracy superiority, or official leaderboard score is claimed.
- Native Windows/Bun execution was used. OpenClaw `2026.9.7` could load its direct CLI entry but failed with SQLite read-only worker snapshot cleanup / EBUSY. Retrying on its supported Node runtime or Linux is needed before a fair three-way score. This is not evidence of model incapability.
- Initial setup probes had missing protocol/config fields or default tool approval blocking writes. Those were excluded from this pilot. The disposable Cybara gateway explicitly allowed fixture mutations; the user's real gateway was unchanged.
- Cybara's self-improving skill capture remained enabled. Associated requests were included when observed, but learned-state/background timing may affect runs. Formal isolation should disable learning for every harness or run separate fresh-profile and adaptive-profile tracks.
- Model backend identity, provider cache warming, network noise, exact reasoning controls and native streaming first-token behavior remain confounds.

### Reproduction receipts

- `docs/evals/2026-10-01/space-bunny-pilot.json`: per-trial assertions and provider-request metrics.
- `docs/evals/2026-10-01/tasks.json`: the exact fixture tasks and expected outputs.
- `docs/evals/2026-10-01/versions.json`: pinned versions/runtime and limitations.
- `docs/evals/2026-10-01/compaction-live-receipt.json`: separate actual-model compaction proof; not counted as a harness task.
- `docs/harness-benchmark.md`: generic runner protocol and usage.

Adapters and full local workspaces remain under `.scratch/harness-evals/`. They are local testing state, not package dependencies or release assets. No credentials are included in the checked report files.

## Recommended release-quality comparison

Run each candidate on supported Linux/Node/Python runtimes in equivalent containers. Publish the selected task IDs and version pins before running, use fresh per-trial state and matched warmed/cold tracks, freeze model/reasoning/tool budgets, and record cache state. Use Terminal-Bench 4.0/Harbor and SWE-bench Verified with their official graders, plus a separately named long-context retention/recovery suite. Repeat paired trials and report 95% confidence intervals for correctness and paired bootstrap intervals for latency/token ratios. Score token efficiency only on matched successful tasks, account for retries/compaction/background work, and retain every failed trial. Include security/isolation and resilience as distinct scored dimensions rather than collapsing them into a speed score.

The defensible current statement is: **Cybara was faster than Hermes on this small Windows pilot and tied on correctness; token superiority and OpenClaw performance remain unestablished.**
