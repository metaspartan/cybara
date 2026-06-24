---
name: spike
description: Run a throwaway spike/prototype to validate feasibility or compare approaches, then report a clear verdict. Use when the user is unsure an approach works and wants a quick proof before committing.
---

# Spike

A spike is a time-boxed, throwaway investigation. Its output is a **decision**, not production code.

## When to use

- "Will approach X even work?" / "Can we do Y with Z?"
- Comparing 2+ approaches and needing empirical data, not opinion.
- De-risking an unknown (an API, a library, a perf claim) before building the real thing.

## Procedure

1. **State the question precisely.** What must be true for the approach to be viable? ("Can library X parse a 1GB file in <2s without OOM?")
2. **Set a time/effort box.** Spikes are short — if it's taking long, narrow the question.
3. **Write the minimum code** to answer the question. Use `exec`/`write` in an isolated scratch path (e.g. `spike/`). Don't worry about quality.
4. **Measure the actual thing.** Run it; capture timing/output/errors. Don't extrapolate.
5. **Report a verdict:**
   - **Verdict:** VIABLE / NOT VIABLE / NEEDS-MORE-INFO
   - **Evidence:** concrete numbers, snippet, or the failure mode observed.
   - **Recommendation:** proceed with X / avoid X because / next probe needed.
6. **Clean up** the scratch code (or move it aside) unless it's promoted to real code.

## Anti-patterns

- Spending a spike polishing code instead of answering the question.
- Reporting "it should work" without measuring.
- Letting a spike silently become production code without a review pass.

Keep spikes honest: a "no, this won't work" verdict with evidence is a successful spike.
