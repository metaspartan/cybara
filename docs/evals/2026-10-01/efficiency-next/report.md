# Fused-mode efficiency study — October 1, 2026

## Result

**Cybara achieved the requested joint pilot result: faster mean completion, fewer provider requests, fewer total tokens, and6/6 correctly completed trials against OMP18.4.8.** This is a scoped engineering pilot, not a universal or leaderboard superiority claim. The results depend on selecting the new opt-in fused execution mode; ordinary direct-mode agents are not silently switched.

### Equal-budget main pilot: three tasks, two rotated rounds

| Metric | Cybara fused mode | OMP18.4.8 | Measured difference |
| --- | ---: | ---: | --- |
| Correct completion |6/6 |6/6 | Same fixture success |
| Mean wall time |12.518s |15.126s |17.2% less time |
| Median wall time |12.272s |12.602s |2.6% less time |
| Provider requests |20 |28 |28.6% fewer |
| Input tokens |51,108 |158,924 |67.8% fewer |
| Completion tokens |5,106 |4,183 |Cybara uses more output |
| Total input + completion |56,214 |163,107 |65.5% fewer |
| Cached input |30,057 |124,733 |Absolute cache count is not a benefit metric |
| Uncached input |21,051 |34,191 |38.4% fewer |
| Failed provider requests |0 |0 |Complete usage on both sides |
| Observed reasoning effort |high |high |Matched |
| Observed output cap |8,192 |8,192 |Matched |

`fused-mode.json` is the sole source of the headline percentages. Raw total tokens include cached input; this is not a65.5% dollar-cost or compute savings claim. OMP retains advantages in completion-token count and cache-hit fraction; the card does not say “wins every metric.”

### Replication with the same candidate

Both harnesses again completed6/6. Cybara:14.876s mean,10.718s median,20 requests,50,818 input and5,016 output tokens. OMP:22.830s mean,13.612s median,25 requests including one failed provider request. Usage for the failed OMP request is unavailable; its aggregate tokens and cache metrics remain **null**, not zero. This repeat supports correctness, latency and request-count direction, but cannot validate a token-savings percentage. The headline deliberately uses the complete main run, not the retry-affected larger speed difference.

Across main and replication there are12/12 correct trials per harness, comprising repetitions of the same three tasks—not12 distinct tasks. All20 readonly input instances in each run were unchanged.

### Broader correctness check

Four additional tasks exercised exact Unicode/control-character strings, a four-file join, a dependent-pointer read, and source-code repair. Cybara completed4/4; OMP3/4. Cybara mean30.029s,24 requests,76,391 input and8,199 output; OMP mean45.575s,42 requests,314,018 input and11,652 output. No provider requests failed. Both repaired implementations independently passed121 additional property cases each; all18 readonly input instances were preserved.

This remains small, exploratory evidence. These tasks were already present in the earlier study, so they are a broader regression suite rather than a newly blinded held-out dataset. Their accuracy difference is not the graphic's headline.

## Changes that produced the improvement

1. **Expose the existing capability correctly.** Coding policy could allow `execute_code` without offering its schema. Direct tool mapping now includes it. The process toolset explicitly preserves exec/process/git/ssh/scp/sandbox_run and adds fused execution; safe profiles and explicit deny rules retain their restrictions.
2. **Opt-in schema fusion.** `tool_execution_mode: "fused"` offers one execution schema instead of separate enabled file/process schemas. The underlying allowed-tool namespace stays the same; pending plan features and ordinary direct agents remain separate. Invalid modes fail closed, and fused mode requires an allowed execution capability.
3. **Typed JSON workflow helpers.** `cybara.readJson({path})` parses a single enabled read; `writeJson({path,value})` invokes enabled write and read-back verification; `assertEqual(actual,expected)` ignores irrelevant object-key ordering while retaining array ordering and string contents. Unsupported/non-finite values are rejected rather than silently equated through lossy JSON serialization.
4. **Fewer model round trips, not less reasoning.** The prompt advises combining known-input reads, transformation, writes and an independently computed reference check in a single call. Artifact schemas remain exact, diagnostics stay in the receipt, and failed/uncertain checks require follow-up. No hidden low-effort setting, output cap reduction relative to OMP, answer hardcoding, or skipped semantic check was used.
5. **Usable agent settings.** Agents → Edit → Tool Execution now exposes “Direct tools (default)” and “Fused code (trusted local work).” Saving/reloading/removing this opt-in was exercised through the rendered UI while preserving model parameters and explicit tool allow/deny settings.

## Security boundary

Fused code is **trusted host execution, not a security sandbox**. The JSON helpers and `cybara` namespace dispatch through existing enabled tools, approval policy and file-path checks. They do not technically prevent arbitrary host code from directly accessing the filesystem. Use sandboxed execution for untrusted code; the UI, tool description and documentation explicitly state this boundary. No production clipboard/browser/session security policies were loosened for this optimization.

## Controls and limitations

- Locally authorized `space-bunny-free` via the verified OpenCode Zen chat-completions route; credentials remain outside archived reports.
- Official unmodified OMP18.4.8 Windows x64 binary, SHA-256 `64e8cc817c91b6ea5c7f5c507fd4590f1e339759e42f3b414e6071bdcd99cad2`.
- Same task prompts/files, output assertions, high reasoning and8,192 output cap. Fresh sessions/profiles and rotated order. Learning/review background work disabled in fixture profiles.
- Cybara used a warm gateway; OMP started a cold native CLI for each trial. Both measured end-to-end workflow time, not pure harness execution overhead. This asymmetry is visible on the graphic.
- Provider responses were buffered by the measurement proxy; streaming first-token latency is not established. Hosted backend, sampling, queueing and cache state are not fully controlled.
- Cybara's final source includes previously pending plan-lifecycle changes. Version/source hashes and individual receipts are retained. The live4269 gateway and installed desktop were not restarted or updated.
- No official Terminal-Bench/SWE-bench or universal model-accuracy claim. No unchanged natural-language-output guarantee: the verified contract here is task output correctness.

## Rejected experiments remain visible

The archived sequence includes initial misconfigured capability/approval runs, direct-schema fusion experiments, JSON helpers, and the final opt-in fused exposure. Several broad candidates added unrequested diagnostic fields to JSON output or wasted calls on object-key-order-only comparisons; those failures were retained and addressed, not deleted or counted successful. `summary.json` enumerates every phase. The accepted main and repeat were preselected six-trial runs, not a selection of individual fastest trials. Repeated adaptive tuning still makes this an engineering pilot rather than a statistical generalization.

The source change after the scored phase tightened rejection of unsupported JSON values; its regression tests prove previously supported JSON behavior remains intact. The agent-settings UI was added afterward and verified separately. Neither mutation changes model budgets or the scored valid JSON path.

## Verification and assets

-44 focused core tests /195 assertions passed, covering capability preservation, explicit denial, fused file transformations, exact strings/arrays, unsupported JSON rejection and existing execution limits.
-Rendered agent-settings E2E passed9 assertions: save, reload, switch back to direct, and unchanged tool/model policy.
-Full local `bun run check:ci` passed: all eight smoke groups green,3137 core tests passed,0 failures. Two existing Windows/platform-specific skips remained unchanged; no new skips were added. Strict deadcode check passed.
-Independent scoring and immutable-input checks passed for the archived accepted main, replication and broader suite. Both source repairs passed121 property cases.

Updated assets: `docs/marketing/2026-10-01/cybara-vs-omp-x.png` and `.svg`, plus matching `cybara-context-claim` files, generator, `claims.md` and `x-copy.md`. PNG resolution1600×900; actual full-size and800×450 previews were visually inspected. Real `cybara.png` is embedded; headline/metrics are unclipped and the startup, raw-token and small-pilot caveats are visible. Nothing has been posted to X.

Changes are local and uncommitted. Selecting the mode on the installed application requires updating its gateway/UI; the verification instance uses port4476.
