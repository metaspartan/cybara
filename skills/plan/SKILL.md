---
name: plan
description: Break a large task into a concrete, ordered implementation plan before writing code. Use for multi-file features, refactors, or anything non-trivial where a plan prevents rework.
---

# Plan

Before non-trivial implementation, produce a plan the user can sanity-check. This catches bad assumptions early and reduces rework.

## When to use

- Multi-file features or refactors.
- Anything with >3 steps or unclear scope.
- When the user says "plan this out" / "how would you approach …".

## Procedure

1. **Understand the goal.** Restate it in one sentence. If ambiguous, ask a focused question (use the `clarify` tool) before planning.
2. **Survey the relevant code.** Read the files/areas that will change. Ground the plan in real symbols and paths, not guesses.
3. **Produce a sequenced plan:**
   - Ordered steps, each with: what changes, which files, and the verification for that step.
   - Flag decisions/risks and unknowns explicitly.
   - Note what is deliberately out of scope.
4. **Propose the plan for sign-off** before implementing. Don't start editing until the user agrees (unless the task was explicitly "just do it").
5. **Track progress** with the `todo` tool as you implement; update statuses as steps complete.

## Good plan properties

- **Concrete:** names files and functions, not "update the auth module".
- **Ordered:** step N doesn't depend on step N+2.
- **Verifiable:** each step has a check (test, typecheck, manual repro).
- **Scoped:** explicit out-of-scope list prevents scope creep.

## Output shape

```
Goal: <one line>

Steps:
1. <file/symbol> — <change>. Verify: <how>.
2. …

Out of scope: …

Risks / decisions: …
```

Prefer the smallest plan that achieves the goal; split large plans into phases.
