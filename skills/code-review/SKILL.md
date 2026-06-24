---
name: code-review
description: Review code changes for correctness, security, performance, and maintainability before merging. Use when reviewing a PR/diff or auditing a file for quality.
---

# Code Review

Review changes against a consistent checklist. Be specific and kind; cite file:line.

## Procedure

1. **Understand intent.** Read the PR description / linked issue first. What is this change trying to do?
2. **Read the diff in full** (`git diff main...HEAD`). Then read the surrounding context, not just changed lines.
3. **Check correctness first:** does it do what it claims? Edge cases? Error handling? Off-by-ones? Null/empty inputs?
4. **Check security:** untrusted input handling, injection (SQL/HTML/cmd), authz, secrets in code/logs, path traversal, unsafe deserialization.
5. **Check performance:** N+1 queries, accidental O(n²), unbounded loops, missing pagination, large allocations in hot paths.
6. **Check maintainability:** naming, duplication (DRY), dead code, overly long functions, missing tests, misleading comments.
7. **Verify tests** actually cover the new behavior and aren't just happy-path.

## Severity levels

- **Blocking** (must fix): correctness bugs, security holes, data loss, missing tests for risky logic.
- **Important** (should fix): poor error handling, perf issues, unclear naming.
- **Nit** (optional): style, minor refactors.

## Writing good review comments

- Lead with the problem, not the solution. ("This will NPE if `user` is null" beats "add a null check".)
- Suggest a fix only after stating the issue.
- Distinguish blocking from nit explicitly.
- Praise good design decisions too — reviews aren't only for problems.

## Output format

```
## Blocking
- path/file.ts:42 — <issue>

## Important
- path/file.ts:88 — <issue>

## Nits / Suggestions
- path/file.ts:120 — <nit>

## What's good
- <concise positive note>
```
