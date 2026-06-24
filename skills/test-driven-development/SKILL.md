---
name: test-driven-development
description: Test-driven development discipline — write a failing test, implement the minimum to pass, then refactor. Use when adding a feature or fixing a bug where correctness matters.
---

# Test-Driven Development (TDD)

Write the test first. It forces precise specifications and gives a free regression net.

## Red → Green → Refactor

1. **Red.** Write ONE small test for the behavior you want. Run it. It must FAIL (and fail for the right reason — an assertion, not a compile error in unrelated code).
2. **Green.** Write the minimum code to make that test pass. No more, no less. Run it.
3. **Refactor.** Clean up duplication while keeping tests green. Re-run after each change.

Repeat with the next smallest increment.

## Rules of thumb

- Test behavior, not implementation. Prefer public API; don't poke private internals.
- One assertion concept per test. If "and" appears in the test name, consider splitting.
- Name tests like `it("returns X when Y")` / `should do Z when …`.
- If a bug fix, write the test that reproduces the bug FIRST (see `systematic-debugging`).
- Don't write tests that depend on wall-clock, random, or network unless you stub them.

## Running tests

- Match the project's framework and command (`bun test`, `pytest`, `go test`, …).
- For Bun projects: `bun test` (per `AGENTS.md`, Bun is the only JS runner).

## When TDD is overkill

- Throwaway exploration / spikes — write the test after you know the shape.
- Pure UI tweaks with no logic — a visual check is fine.

TDD pays off most for: parsers, state machines, financial/permission logic, and anything with many edge cases.
