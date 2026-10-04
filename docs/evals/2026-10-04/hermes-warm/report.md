# Symmetric warmed-session comparison — October 4, 2026

## Result

Both ongoing sessions were genuinely warmed before timing the scored task. The six-distinct-task confirmation passed **6/6 for each harness**. Cybara used **29.4% less mean task time**, **26.9% fewer provider requests**, and **65.1% fewer total tokens**. It did **not** win every metric: Hermes used fewer completion tokens and fewer uncached input tokens.

| Scored confirmation metric | Cybara fused | Hermes v0.21.5 | Direction |
| --- | ---: | ---: | --- |
| Correct task outputs | 6/6 | 6/6 | Tie |
| Mean warmed task time | 25.292 s | 35.809 s | Cybara lower by29.4% |
| Median warmed task time | 10.568 s | 37.323 s | Cybara lower |
| Provider requests | 19 | 26 | Cybara lower by26.9% |
| Input tokens, cached included | 69,985 | 219,306 | Cybara lower |
| Completion tokens | 8,490 | 5,569 | Hermes lower |
| Total input + completion | 78,475 | 224,875 | Cybara lower by65.1% |
| Cached input | 57,153 | 211,416 | Cache usage, not a standalone win metric |
| Uncached input | 12,832 | 7,890 | Hermes lower |
| Failed provider requests, scored | 0 | 0 | Tie |
| Actual reasoning/output cap | high /8,192 | high /8,192 | Matched |

The updated graphic uses `confirmation.json`, the predeclared unchanged six-task repeat. It does not average startup into one harness's score or substitute missing usage with zero. Accuracy ties are not wins, and lower total tokens do not establish lower monetary cost: no provider-price model was measured. Cybara's code-repair task was slower than Hermes's in this confirmation; the average-speed claim is not “every task faster.”

## Workload and warming protocol

Six distinct local workflows were used: multi-file ledger reconciliation, exact inventory updates, validated normalization, a four-file business-order join, dependent pointer discovery, and TypeScript code repair. Prompts, original inputs and output assertions match the existing regression fixtures. The extra `warmup.json` was identical on both sides. These are representative-shaped synthetic workflows, not production traffic, a blinded held-out dataset, Terminal-Bench, SWE-bench or a proof of general accuracy.

Before each scored task, both harnesses receive the same excluded warmup message in the same continuing agent/session: read only `warmup.json`, compute its sum by two methods, and return the checked result. This warms local execution, model conversations and provider prefixes. The scored monotonic clock begins when the actual task is submitted and ends when its final response returns, before teardown. Hermes uses its unmodified CLI initialization to create a reusable agent, then calls the stock conversation API twice; Cybara uses two calls to the same chat session. Thus neither import/process startup nor initial environment/kernel startup is deliberately charged only to the competitor.

Every request has proxy timestamps. `*-checks.json` records task/warmup boundaries and both partitions; their union is checked against all run requests, with no overlap or unclassified calls. ISO timestamps are parsed consistently rather than comparing PowerShell-converted local dates. Actual wire requests retain high reasoning,8,192 output cap and the same `space-bunny-free` upstream route. Cache state is observed, not forcibly equalized. Hosted queueing, cache eviction and generation sampling remain uncontrolled.

Both use disposable unattended local permissions and equivalent file/process capabilities. Hermes retains stock terminal, file and code-execution toolsets and a60-turn limit; Cybara uses its opt-in fused mode with existing enabled file/process tools. Both have a300-second full-trial ceiling including warmup; failures remain in reliability counts. Derived titles are enabled but auxiliary title model upgrades/background reviews are disabled to avoid unrelated model calls.

## Warmup and total lifecycle costs remain visible

Confirmation warmup: Cybara17 requests and43,841 total tokens; Hermes31 requests and223,909 total tokens. Full setup-through-task lifecycle: Cybara36 requests and122,316 total tokens versus Hermes57 requests and448,784 total tokens. These are separately disclosed and are **not** the warmed-task headline. The scored prompt still contains each harness's actual warmup conversation; identical warmup instructions do not guarantee identical generated history lengths.

The raw runner `elapsed_ms` is full adapter lifecycle time. It must not be relabeled warmed latency. Only `.timing.json`'s `task_elapsed_ms`, archived in check receipts and checked against wall timestamps, supplies the warmed headline.

## Baseline, candidate and reliability

All phases are archived: preflight, six-task original-code baseline, two-round candidate, and unchanged six-task confirmation. The baseline passed Cybara6/6 and Hermes5/6; one Hermes provider retry had unknown usage, so no aggregate token advantage is asserted from that phase.

The main candidate ran six tasks twice. Cybara passed12/12; Hermes passed9/12. Two Hermes business-join outputs had incorrect schemas. One Hermes warmup returned a malformed planning response without executing the required check, so the scored task was never submitted. That trial remains a failure in reliability; its warmed mean is **null**, not13.081 seconds of fast task completion. One additional Hermes provider retry occurred during warmup with unavailable usage. Scored usage for the11 started Hermes tasks is available, but comparing those totals with12 Cybara tasks would be unequal.

For transparency, the11 matched task-start pairs give Cybara11/11 versus Hermes9/11: mean26.644 s versus49.334 s,42 versus60 requests,180,478 versus548,474 total tokens. Hermes still wins uncached input in those pairs:25,727 versus30,552. This pair analysis explicitly excludes the one no-task-start pair from *efficiency*, not from overall reliability. It is supplementary, not the graphic's source.

The predeclared confirmation retained the same code, tasks, controls and warming procedure. Both passed6/6 and no provider request failed. Across the candidate plus confirmation, Cybara passed18/18 scheduled trials; Hermes15/18, including the failed warmup. This small number does not prove general superior accuracy. Every slow trial was retained; no individual fastest runs were selected. Code-repair outputs additionally passed121 independently generated cases per implementation per started successful repair trial. Input files were checked unchanged except the explicitly editable `source.ts`.

## General Cybara improvement

The comparison exposed a real evidence-transport bug: successful nested read/write operations inside fused execution did not satisfy the same deliverable predicate as direct tools. A before-fix probe actually wrote and verified an output file while the old production predicate still rejected it.

The fix collects bounded parent-generated tool receipts and separate WeakMap-backed trusted evidence. Only successful allowed nested operations count. Real write/edit paths must match; failed outer execution, denied/caught failures, fabricated returned receipts, wrong paths, placeholders and inappropriate code-as-markdown cannot satisfy completion. Public receipts disclose paths and content lengths without echoing written contents; sensitive values use existing redaction. Retained receipts are capped at64 and16,384 argument characters each. Initial inspection tool selection permits an enabled fused route even when direct inspection tools are also offered.

This makes existing safeguards understand real work; it does not reduce reasoning effort, remove semantic assertions, hardcode answers or add comparator-specific production logic. The fix does not claim to explain all earlier repeated model rounds, and native file validation remains necessary.

## Versions and environmental limits

Cybara source started at commit `2de80a6e141636fbcfc41d7090841ec8e118687c` plus the uncommitted trusted-evidence changes documented above. Before/after source hashes are archived. Bun1.4.2. Hermes official v2026.9.24 / package0.21.5, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, Python3.11.9, clean checkout. The published pin is retained for continuity with the earlier test; this pass did not certify that it remained the newest release on October4.

Windows local execution and buffered upstream responses were used. This is not streaming first-token latency. Hermes emitted optional relay-module warnings and SQLite DELETE-journal fallback warnings; stock generated snippets also sometimes required corrections. These conditions, retries and incorrect outputs remain disclosed, not removed to produce a win. Both code paths are warmed, but their implementations and histories differ; “warmed” does not mean equal internal code or guaranteed identical caches.

## Verification and delivery

-51 focused regression tests passed,184 assertions, including forgery/denial, placeholder, path, truncation, bounded receipts, read-only claims and existing execution behavior.
-Full local `bun run check:ci` passed: all eight smoke groups green;3159 core tests passed, zero failures, two unchanged existing platform-specific skips. No new skipped tests or quality bypasses.
-Strict graphic TypeScript validation and documentation consistency checks passed; graphic numbers are recomputed directly from warmed confirmation receipts.
-New PNG/SVG and generator: `docs/marketing/2026-10-04/cybara-vs-hermes.*`; full report, tasks, raw records, timing partitions, property checks and source hashes remain alongside this file. Previous October2 assets remain historical and unchanged, not proof of steady-state performance.

Changes and new deliverables remain local and uncommitted. No app installation, live gateway4269 restart, Git push or social post was performed. To use the runtime improvement in the installed app requires a gateway/UI update. No universal or every-metric superiority claim is justified.
