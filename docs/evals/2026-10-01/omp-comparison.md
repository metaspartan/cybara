# Cybara vs oh-my-pi — October 1, 2026

## Executive result

Using the same `space-bunny-free` model ID and authorized OpenCode Zen endpoint, both harnesses solved all six final confirmation trials. Cybara initially lost to OMP on speed and input/output tokens. A confirmed capability-prompt bug was repaired: restricted file agents were paying for the entire skill catalog although they had no `skill_load` capability. The optimized Cybara prompt is substantially smaller and total input tokens are lower than OMP in the final run. **OMP still wins completion latency, request count, completion tokens, uncached input and cache-hit fraction. No overall superiority or accuracy improvement is established.**

This is a small engineering fixture pilot, not an official Terminal-Bench, SWE-bench or statistically decisive 2026 leaderboard score.

## Pins and configuration

| Entity | Exact execution configuration |
| --- | --- |
| Cybara | Base commit `787d78c9`; uncommitted browser-import/context fixes preserved; Bun 1.4.0 on Windows x64; isolated warm gateway, fresh agent/session/provider per task |
| OMP | Official `v18.4.8`, tag commit `717f97f4d22b3d65c4a4eef6a744255d46f4d1a6`; official Windows x64 binary; SHA-256 `64e8cc817c91b6ea5c7f5c507fd4590f1e339759e42f3b414e6071bdcd99cad2`, verified against release SHA256SUMS |
| Model/route | `space-bunny-free`, `https://opencode.ai/zen/v1/chat/completions`; the locally configured authorized OpenCode credential was used without exporting it into reports |
| Reasoning | `high` observed on provider requests in instrumented runs; buffered upstream responses replayed as SSE when requested |
| Tools | Cybara: read/write/edit/exec/grep/file_search; OMP: read/write/edit/bash/grep. Comparable file/process scope, not identical implementations |
| Learning/state | Cybara self-improving skills and auto-learning disabled on fixture gateway only; OMP memory backend off, autolearn off, no skills/rules/extensions/LSP/prewalk, ephemeral session, fresh profile per task |
| Tasks | Three file-grounded transformations: posted ledger with duplicate IDs, inventory state changes, boundary/type filtering; two rounds each; exact JSON output assertions; original files independently checked |
| Permissions | Explicit fixture mutation allowance. The real gateway on 4269 was not restarted or reconfigured |

OMP's published Bun package hit an extensionless `prelude` import that resolved to `prelude.js` instead of `prelude.ts` on this host. Setup probes were not scored. All scored OMP runs used the unmodified official release binary. The unrelated registry package named `oh-my-pi` was not used.

## Before fixes: baseline

| Metric, six trials each | Cybara baseline | OMP 18.4.8 |
| --- | ---: | ---: |
| Correctly completed | 6/6 | 6/6 |
| Mean wall time | 18.838 s | 14.311 s |
| Total input tokens | 173,707 | 140,324 |
| Total output tokens | 4,686 | 4,046 |
| Requests | 35 | 27 |
| Cached input | 130,816 | 113,174 |
| Uncached input | 42,891 | 27,150 |
| Cache-hit fraction | 75.3% | 80.7% |

OMP was faster and more token-efficient here. This baseline remains intact at `omp/omp-baseline.json`.

## Changes implemented

1. **Capability-scoped skill catalog:** `buildSystemPrompt` now includes the skill catalog only when `skill_load` is offered. Restricted file agents no longer get approximately 13k characters of unavailable skill instructions. Full agents retain skill discovery and loading. Restricted tool prompt length fell from approximately 20.6k characters to 7.0k provider-visible characters (6.7k core prompt), depending on runtime framing. Safety, required evidence, exact deliverable contracts, confinement, approvals and final verification remain in the prompt/runtime.
2. **Efficient input guidance:** exact input paths should be read directly; independent reads should be batched when safe; unchanged inputs should not be rediscovered or reread unnecessarily. Re-reading after mutation/new evidence remains required. Equivalent execution instructions were tightened without weakening their constraints; the existing concise prompt-size test is now green.
3. **Cache accounting:** compatible included-cache aliases (`input_tokens_details.cached_tokens`, `prompt_cache_hit_tokens`, `cache_read_tokens`) now appear in Cybara's session metrics without double-counting input. Previously the evaluation proxy correctly observed provider cache hits while Cybara's own metrics could show zero. This is an accounting repair, not a claim of new provider cache capacity.
4. **Evaluation integrity:** requests now include metadata-only byte/schema/message counts, stable-prefix hashes, observed reasoning/output budgets, uncached input and upstream duration. No prompts, passwords, model keys or tool arguments are logged in these receipts. HTTP200 failure bodies are failures. Run-scoped proxy routes prevent delayed requests contaminating the next trial; upstream requests are cancellable and bounded. A timeout cannot pass merely because it wrote a correct file before hanging.

The first guidance-only candidate did not improve token use reliably (187,041 input tokens, versus 173,707 baseline). That result was retained; the capability fix produced the defensible reduction.

## Final confirmation after run-isolation hardening

| Metric, six trials each | Optimized Cybara | OMP 18.4.8 | Interpretation |
| --- | ---: | ---: | --- |
| Correctly completed | 6/6 | 6/6 | Accuracy tied on fixtures |
| Mean wall time | 17.933 s | 10.991 s | OMP faster; Cybara 63.2% slower |
| Median wall time | 16.711 s | 9.680 s | OMP faster |
| Total input tokens | 108,881 | 118,707 | Cybara 8.3% fewer |
| Total output tokens | 5,933 | 3,422 | OMP fewer |
| Total input + output | 114,814 | 122,129 | Cybara 6.0% fewer raw total tokens |
| Provider requests | 37 | 21 | OMP fewer round trips |
| Cached input | 76,585 | 89,506 | More cache reuse for OMP |
| Uncached input | 32,296 | 29,201 | Cybara 10.6% more uncached tokens |
| Cache-hit fraction | 70.3% | 75.4% | OMP higher |
| Mean summed upstream latency/task | 17.348 s | 8.165 s | Provider/round-trip time dominates Cybara |
| Tool-enabled system characters | 6,994–7,000 | 12,702 | Cybara substantially smaller stable prompt |
| Observed reasoning effort | high | high | No silent low-effort win |

Compared with the original Cybara baseline, the final Cybara input total is **37.3% lower**. This is not a clean latency A/B because runs occurred at different times; the paired frozen-baseline run below addresses that limitation. Raw tokens include cached tokens. They must not be confused with newly computed/billable tokens or cost; the free provider exposes no meaningful dollar-cost distinction here.

### Final per-task times

| Task / round | Optimized Cybara | OMP | Independent result |
| --- | ---: | ---: | --- |
| Ledger / 1 | 9.424 s | 7.753 s | Both correct |
| Inventory / 1 | 19.671 s | 12.378 s | Both correct |
| Boundary transform / 1 | 30.711 s | 10.879 s | Both correct |
| Inventory / 2 | 11.499 s | 6.820 s | Both correct |
| Boundary transform / 2 | 13.750 s | 19.634 s | Both correct |
| Ledger / 2 | 22.540 s | 8.480 s | Both correct |

## Interleaved frozen baseline / optimized / OMP check

A separate immutable source copy served the old prompt at port4472; the optimized source served port4471. This preserved unrelated edits while rotating all three candidates on the same six task instances. Input totals: **157,937 baseline**, **94,112 optimized**, **154,036 OMP**. Thus the matched input reduction against old Cybara was **40.4%**, with every independently checked file correct.

However, optimized Cybara had **one 181.489s timeout** after creating a correct output and another provider-affected 73.605s trial. Completion was **5/6**, not6/6. Its mean was53.172s against16.696s baseline and13.220s OMP. This does not support a speed win. The archived pre-hardening report labels `all_passed` based only on output assertions; this report explicitly distinguishes correct output from successful completion. No failed trial was removed from the receipts.

The long request also revealed a runner flaw: a request finishing after a run deadline could be attributed to a later run by the unscoped collector. That was fixed, tested with two cancelled upstream requests and exact per-run request counts, and the final confirmation uses the hardened runner. The earlier paired request/time totals are diagnostic evidence, not authoritative latency superiority statistics.

## Cache conclusions and remaining opportunities

- The biggest measured gain is **not sending inaccessible capabilities**. It is legitimate prompt reduction rather than pretending cached tokens cost nothing.
- OMP's request prefix remained stable within its tool rounds; Cybara's observed limited file-task schema also remained stable, so no blind schema-changing patch was justified here.
- OMP's higher cache-hit fraction and lower uncached input mean that “Cybara beats OMP in prompt caching” is unsupported.
- Cybara still spends more rounds and output on these tasks. Stronger next experiments: stage-matched batched reads, provider-side parallel-tool preference on verified routes, bounded reasoning appropriate to simple vs difficult tasks, and a separately selectable coding prompt policy that preserves safety. These need preregistered tasks and real regression checks before changing defaults.
- No speculative cache-warming request was added. Warming can inflate token use and bias a free hosted-model benchmark; count it if tested in a separate warm-session track.

## Limitations

Small, straightforward, locally authored tasks; not held-out software repair. Temperature/provider cache state and hosted backend identity are not controlled. Cybara's warm server versus OMP's cold native CLI is an asymmetric workflow measurement. Both selected high reasoning, but provider-specific sampling and token-budget policies are not fully identical. Cybara's title-generation requests are counted; OMP print/RPC policies differ. No same-task statistical accuracy advantage is established. No GLM-5.3-Flash trial or official container leaderboard submission is claimed.

The actual endpoint was the verified Zen free-model route using the locally authorized OpenCode key, not an invented Go-only contract. Credentials remain outside the reports.

## Receipts and reproducibility

- `omp/omp-baseline.json`: original before-change measurement.
- `omp/omp-candidate-1.json`: guidance/accounting-only candidate, retained despite worse token use.
- `omp/omp-scoped.json`: capability-scoped candidate.
- `omp/omp-paired.json`: interleaved frozen baseline diagnostic, including timeout.
- `omp/omp-confirmation.json`: final scoped/cancellable-run confirmation.
- `omp/summary.json`: derived metrics with correct-output and completed-correct counts separated.
- `omp/versions.json`, `omp/tasks.json`: version hashes and exact tasks.
- Generic runner protocol: `docs/harness-benchmark.md`.

Original input files in the18-run paired experiment were preserved30/30. Adapters/fixture workspaces remain under `.scratch/harness-evals/` and contain only fixture data/state; credential values are supplied through process memory, not archived.

## Verification

Focused efficiency/prompt/cache/runner tests passed, including the full-agent skill catalog guard and zero-cache precedence. Real CLI proxy/SSE/scoring/credential-redaction E2E passed. New two-run timeout test proves exactly2 upstream starts and2 cancellations, no cross-run metrics and no timeout success. Existing compaction E2E passed. Browser import E2E passed4/4 standalone; a combined run during deliberate gateway restart surfaced a `Failed to fetch` pageerror and is disclosed, not suppressed.

Full CI remains red on the broader Windows checkout. The final run had **52 distinct failing test names**, exactly the prior 53-name baseline minus the concise prompt-size failure fixed here; no new failure names. The isolated test runner also reported Windows EBUSY cleanup. Backend/UI typechecks, lint, formatting, LOC and mobile pre-smoke gates passed; deadcode report completed, with native knip reporting only the pre-existing unused `undici` dependency. No all-green checkout is claimed.

## Official sources

Retrieved2026-10-01:

- Repository and release: https://github.com/can1357/oh-my-pi/releases/tag/v18.4.8
- Release checksum: https://github.com/can1357/oh-my-pi/releases/download/v18.4.8/SHA256SUMS.txt
- OMP CLI: https://github.com/can1357/oh-my-pi/blob/v18.4.8/docs/cli-reference.md
- Model/provider schema: https://github.com/can1357/oh-my-pi/blob/v18.4.8/docs/models.md
- RPC/cache-warming behavior: https://github.com/can1357/oh-my-pi/blob/v18.4.8/docs/rpc.md
- Free model route: https://opencode.ai/docs/zen/
