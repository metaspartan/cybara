---
name: systematic-debugging
description: Structured root-cause debugging loop — reproduce, isolate, form a hypothesis, verify the fix. Use whenever a bug, crash, test failure, or unexpected behavior is reported.
---

# Systematic Debugging

A disciplined loop that finds the true root cause before changing code. Skipping it is the #1 cause of "fixes" that regress or don't hold.

## The loop

1. **Reproduce reliably.** Get a minimal, repeatable repro (command, input, test). If you can't reproduce it, say so and gather more info before touching code.
2. **Read the error fully.** Capture the exact message, stack trace, and the line it points to. Don't guess from a summary.
3. **Isolate.** Narrow the trigger: which input, which code path, which environment/version? Binary-search with logs or by disabling code.
4. **Form ONE hypothesis** about the root cause. State it explicitly: "I think X happens because Y."
5. **Verify the hypothesis** with the cheapest probe: a log, a print, a test, a debugger breakpoint (`lsp_diagnostics`, `exec` with a tiny script). Confirm before fixing.
6. **Fix the root cause**, not the symptom. The fix should make the repro pass AND not break related cases.
7. **Add a regression test** that captures the repro, so it can't come back.
8. **Re-run the full affected test suite**, not just the one case.

## Anti-patterns to avoid

- Changing multiple things at once → you won't know which fixed it.
- "Fixing" by catching/swallowing the error.
- Editing code based on a guess without confirming the hypothesis.
- Declaring fixed without re-running the repro.

## When stuck

- Re-read the original repro; assumptions drift.
- Search code (`grep`) and the issue for similar symptoms.
- Check recent changes (`git log`, `git diff`) — regressions usually track recent edits.
- Form a NEW hypothesis; don't keep retesting the same one.
