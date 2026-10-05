# Claims on the warmed Hermes graphic

## Headline source

`docs/evals/2026-10-04/hermes-warm/confirmation.json` and its check receipts: a predeclared unchanged repeat of six distinct local workflow tasks. Both ongoing sessions completed the same warmup before the scored clock. The preceding candidate's failures and unmatched task-start pair remain in the report; they were not replaced with successful retry results.

| Visible claim | Verified inputs |
| --- | --- |
| Both6/6 correct | All12 exact-output checks passed; both repaired sources passed121 additional cases each |
| 29.4% lower mean task time | Cybara25,291.971ms versus Hermes35,808.551ms; startup, warmup and teardown excluded for both |
| 65.1% fewer total tokens | Cybara78,475 versus Hermes224,875; scored input + completion including cached input |
| 26.9% fewer requests |19 versus26 actual scored provider requests |
| Both sessions warmed | Same agent/session retained across excluded warmup and timed task, validated timestamp partitions |
| Hermes uses fewer output and uncached tokens | Completion5,569 versus8,490; uncached input7,890 versus12,832 |

No all-metric, every-task-speed, price, production-traffic or universal superiority claim is justified. The six workloads are representative-shaped synthetic fixtures on Windows using the same model, high reasoning and8,192 cap. The graphic explicitly says scoped pilot.

Warmup and full lifecycle requests/tokens are separately archived; they were not silently removed from the evidence. Provider cache state and generated warmup histories differ. Earlier candidate reliability is Cybara12/12 and Hermes9/12, including one failed warmup. This confirmation is6/6 each, not an aggregate description of those earlier failures.

Files: `cybara-vs-hermes.png`1600×900, editable `.svg`, `generate-hermes.ts`. Real `cybara.png` is embedded. Original October2 graphic remains historical; use this warmed version for the revised claim. Nothing was posted.
