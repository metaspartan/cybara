# Accuracy-gated request efficiency — October 1, 2026

## Verdict

**The all-around goal was not achieved.** Meaningful, general-purpose improvements are implemented, but the expanded final suite favors OMP for speed, requests, and tokens. Both systems retained full task correctness on that suite. Do not advertise universal superiority or a proven accuracy improvement.

The X-ready graphic uses the real `cybara.png` and the final equal-budget three-task comparison: **23.7% fewer input tokens**, both6/6. It explicitly discloses the small pilot and that the expanded suite favors OMP. It was created locally, not posted to X.

## Implemented improvements

1. **Bounded multi-file reads.** `read.path` accepts a string or an array of1–8 independent paths. Results preserve input order, exact text and individual errors; at most4 file reads are active. The shared output budget is2,000,000 characters with explicit recovery/truncation notice. Each path passes sensitive-read and realpath/workspace confinement. Vision remains single-file rather than silently dropping pixels. Existing single-path/PDF/directory semantics remain available.
2. **Local titles by default.** A useful title is derived locally, avoiding an auxiliary model request for every fresh chat. `session_title_model_enabled: true` restores model-generated background titles. Agent answer contents and reasoning are not shortened.
3. **Honor memory-disabled agents.** The previous background memory reviewer still spawned provider calls after a `memory_enabled:false` agent completed. Both caller and reviewer now respect that flag. The live isolated API test proves exactly one answer request, then exactly one additional title request only when explicitly enabled.
4. **Verified write receipts.** Writes perform exact UTF-8 read-back equality and return byte count, SHA-256 and JSON syntax status. Invalid JSON is reported, not repaired; non-JSON writes claim no JSON validity. Syntax is explicitly not semantic correctness. The final prompt requires independent recomputation for transformations when executable checks are available.

No default reasoning downgrade, output truncation hack, removal of evidence checks, path-policy bypass or competitor-specific branch was introduced.

## Controls and provenance

- Model: `space-bunny-free`; authorized locally configured OpenCode credential, verified Zen chat-completions route.
- OMP: official unmodified18.4.8 Windows native binary, SHA-256 `64e8cc817c91b6ea5c7f5c507fd4590f1e339759e42f3b414e6071bdcd99cad2`.
- Windows x64, Bun1.4.0; Cybara base commit787d78c9 plus preserved local browser/image/context changes and the changes above.
- Same task files/prompts, fresh sessions and fixture profiles, rotated run order, buffered provider responses. Background learning disabled explicitly for both Cybara profiles; OMP's learning/memory extensions disabled.
- Frozen old Cybara source at4473; candidate at4474. The real gateway4269 and installed desktop were not restarted or reconfigured.
- All task-associated provider requests count; unknown usage stays null. Failed variants are retained instead of silently discarded.
- Main seven-task run requested high reasoning but harness policies differed: Cybara max output8192 versus OMP16384. Most Cybara requests reported high; a small number of fallback/closing calls reported no explicit effort. A separate equal-output-budget pilot is retained to distinguish that confound.
- Cybara is a warm server; OMP starts a cold native CLI per trial. Hosted cache state, sampling and model backend identity are not controlled. Results are workflow pilot measurements, not pure harness overhead or leaderboard scores.

## Experiment history

| Phase | Successful correctness | Requests | Mean latency | Evidence status |
| --- | --- | --- | --- | --- |
| First pilot,6 trials each | Baseline6/6; candidate6/6; OMP6/6 |34 /33 /27 |17.09 /36.87 /21.51s | Late background reviewer exposed run-window contamination; Cybara token totals unknown. Diagnostic only |
| Clean pilot,9 each | All9/9 |44 /36 /34 |26.44 /14.82 /22.63s | Batch/local-title candidate reduced requests vs old Cybara and was faster here, but still made more calls than OMP. Baseline had an unavailable-provider retry; usage unknown |
| Write-receipt candidate,9 each | Cybara8/9; OMP9/9 |30 /37 |13.85 /21.97s | Rejected as an accuracy-safe marketing winner. Inventory disabled-state rule missed; byte/syntax validity did not prove semantics |
| Final semantic confirmation,14 each | **Both14/14** |**104 /80** |**43.32 /35.16s** | Seven tasks, two rounds, all inputs independently preserved; repaired code checked separately |

`pilot.json`, `clean-pilot.json`, `write-receipt.json` and `semantic-confirmation.json` retain every scored run. The rejected write-receipt result is not erased. Findings from adaptive exploration must not be presented as held-out statistical evidence.

## Final expanded suite

| Metric | Cybara | OMP18.4.8 |
| --- | ---: | ---: |
| Successfully correct outputs |14/14 |14/14 |
| Mean completion time |43.323s |35.162s |
| Provider requests |104 |80 |
| Input tokens |626,050 |490,192 |
| Output tokens |28,976 |16,446 |
| Cached input |515,068 |407,113 |
| Uncached input |110,982 |83,079 |
| Raw input + output |655,026 |506,638 |

Cybara takes23.2% longer than OMP on this expanded suite; equivalently OMP takes18.8% less time than Cybara. Do not swap percentage denominators. Cybara makes30.0% more requests. No all-around improvement over OMP is established.

The tasks cover posted-ledger duplicate handling, inventory state transitions, strict numeric boundaries, Unicode/control-character string fidelity, a four-file join, dependent-pointer reads, and code repair. The independent code-repair acceptance ran121 property cases on each of4 repaired implementations; all passed. The original readonly task inputs were unchanged56/56. No claim of identical natural-language answers or universal model-accuracy preservation is made.

### Three-task pilot subset, same final source

| Metric | Cybara | OMP |
| --- | ---: | ---: |
| Correct outputs |6/6 |6/6 |
| Input tokens |84,251 |123,603 |
| Mean latency |17.934s |22.208s |
| Median latency |16.890s |14.556s |
| Requests |25 |22 |

**31.8% fewer input tokens** is a valid narrow observation. It is not a compute-cost claim and does not generalize: the four harder tasks reverse the token advantage. The mean and median disagree on speed, so the graphic does not claim a reliable speed win. This subset retains the8192/16384 output-policy difference, disclosed above. The equal-budget check below is the graphic source; this earlier subset is retained rather than substituted silently.

### Final equal-budget pilot (graphic source)

Both systems reported high reasoning and the same observed max-output8192 cap. Cybara:6/6 correct,95,714 input,5,098 output,28 requests,22.437s mean,63,295 cached input. OMP:6/6 correct,125,448 input,3,577 output,22 requests,19.027s mean,96,168 cached input. **23.7% fewer input tokens**, but Cybara still makes27.3% more requests and takes17.9% longer; OMP has fewer uncached tokens (29,280 versus32,419). No speed/request/cache win is claimed. All20 readonly input files were unchanged. `equal-budget.json` and `equal-budget-checks.json` retain the receipts.

A preceding attempt to raise the Cybara output cap through the chat request was clamped by its model policy to8192; OMP remained16384. The phase name `budget-parity.json` is retained as an attempted parity run, not declared actual parity. Actual parity was established by setting OMP's custom model max to8192, not by altering Cybara output policies.

## SOL-Pi: what the paper and code actually say

The authoritative [SoL-Pi abstract](https://arxiv.org/abs/2609.20519), submitted September17,2026, reports **44.7–49.0% recorded token-traffic reduction** and **API cost reduced by about one third** on51 EdgeBench tasks across its tested models. “33% token reduction” conflates cost and token traffic. These are the authors' experiment results, not a promised local Cybara result.

The checkout's existing evidence reducer handles sufficiently large `exec` output: archive original, request extraction, verify source hash/exit code/verbatim quotes, reject unsafe or unhelpful receipts, fall back to original. It does not establish full implementation parity with all four paper mechanisms. Batch reads/action grouping and request-overhead reduction improve other parts of the harness, but this study does not claim to reproduce the full paper or its percentage. OMP support for identical mechanisms was not established by the bounded source scan.

## Verification

-117 focused tests /413 assertions passed: batch boundary/order/security, cancellation, write fidelity, reducer contracts, request policy and agent allowlists.
-3 API/proxy E2E tests /57 assertions passed, including real caller-visible useful title, full retained answer, exact request counts and cancellation isolation.
-Full `check:ci` remains red with52distinct failing names, exactly the preceding Windows baseline; no new failure names after updating the read-schema contract regression. Pre-smoke typecheck/UItypecheck/lint/UIlint/format/LOC/mobile gates passed. Deadcode and native knip completed, reporting only the pre-existing unused `undici` dependency.
- Source hashes, independent check receipts, preserved inputs and raw provider metrics are retained here. Secrets and user conversation contents are not exported.

## Marketing and reproducibility

Graphic: `docs/marketing/2026-10-01/cybara-vs-omp-x.png` (1600×900), editable embedded-asset SVG, generator and `claims.md`. This pilot claims fewer input tokens only. The image includes a visible expanded-suite caveat and no unsupported “beats them all” text. `marketing-metrics.json` identifies `equal-budget.json` as the exact source receipt; broader14/14 is from the separately labeled seven-task acceptance.

Run generic measurements via `scripts/harness-benchmark.ts` with the archived task contracts; fixture adapters and credentials remain separate under `.scratch/request-efficiency/`. Do not publish scratch profiles or secrets. Changes are local and uncommitted, not loaded into the installed desktop or live gateway4269.

## Next bottlenecks, not yet claimed fixed

String-fidelity and code repair produced repetitive verification scripts and repair loops; OMP needed fewer calls. Further work should test stable read-batch evidence accounting, verified semantic receipts, compact source-format-preserving observations, and provider-specific parallel calls on confirmed contracts. Reject improvements that trade failed outputs for lower counts, and measure cache/reducer auxiliary requests rather than hiding them.
