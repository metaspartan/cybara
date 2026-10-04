# Claims on the Hermes comparison graphic

Headline source: `docs/evals/2026-10-02/hermes-fused/replication.json`, the first permission-matched six-trial pilot. The earlier restricted-permission main run is excluded; the unchanged confirmation is reported separately, not substituted for larger headline gains.

| Visible claim | Evidence |
| --- | --- |
| 6/6 correct, both | Every trial completed successfully and passed exact output assertions; all12 outputs independently recomputed |
| 48.4% lower mean completion time | Cybara27,131.667ms versus Hermes52,572.667ms; `(1 − Cybara/Hermes) ×100` |
| 28.2% fewer total tokens | Cybara160,337 versus Hermes223,222; input + completion, including cached input |
| 42 vs31 requests; Hermes uses fewer | Actual provider request counts; no consistent request advantage claimed for Cybara |
| Matched controls | Space Bunny Free, high reasoning,8,192 cap; stock Hermes terminal/file/code execution enabled |

Caveats are visible on the card: warm Cybara gateway versus cold Hermes Python CLI, matched unattended approvals, Windows host, three tasks run twice, cached input included, and not universal superiority. Hermes environment warnings and Cybara’s slow repeated-tool trial are retained in the report. This is not a cost, leaderboard, or six-distinct-task claim.

The second matched pilot again passed6/6 for each harness and favored Cybara on wall time and total tokens; request direction changed. Both matched phases and setup diagnostics remain archived.

`cybara-vs-hermes.png` is1600×900; `.svg` is editable. Full-size and800×450 previews were inspected. The real `cybara.png` mascot was used. Regenerate with `bun run docs/marketing/2026-10-02/generate-hermes.ts`. Previous OMP assets remain unchanged. Nothing was posted.
