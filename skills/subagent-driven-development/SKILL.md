---
name: subagent-driven-development
description: Execute implementation plans with isolated subagents plus spec and quality review passes.
metadata: {"cybara":{}}
---

# Subagent-Driven Development

Use this for larger implementation plans where independent work can be delegated and reviewed before integration.

This adapts the Hermes/OpenClaw subagent workflow to Cybara's `sessions_spawn`, `sessions_send`, `sessions_history`, `session_status`, `todo`, and `kanban_*` tools.

## When To Use

- The plan has multiple mostly independent tasks.
- Fresh context per task reduces confusion.
- You need an implementer plus a spec reviewer and quality reviewer.
- The user explicitly asks for subagents or parallel implementation.

Do not use it for small single-file fixes; direct implementation is faster and clearer.

## Workflow

1. Read the plan once and extract every task with full context.
2. Create a todo list with all task IDs.
3. For each task:
   - Spawn an implementer session with the exact task, relevant files, constraints, and verification command.
   - After implementation, spawn or reuse a reviewer for spec compliance.
   - Then run a quality/security/test review.
   - Fix gaps and re-review before marking complete.
4. After all tasks, run a final integration review across the full diff.
5. Run the affected test suite and full project checks required by the repo.

## Implementer Prompt Shape

Include:

- Task text copied from the plan.
- Files likely involved.
- Project constraints such as package manager, test command, platform, and style.
- Definition of done.
- A request to avoid unrelated refactors and avoid committing unless instructed.

## Reviewer Prompt Shape

Spec reviewer:

- "Compare implementation to this exact task spec."
- "Output PASS or specific gaps with file paths."

Quality reviewer:

- "Check correctness, security, performance, tests, and maintainability."
- "Output Critical, Important, Minor, and Verdict."

## Rules

- Never make subagents infer missing requirements from the full plan; pass the relevant task context directly.
- Review receipts count only after both spec and quality review are complete.
- Keep worktree ownership explicit. Do not let parallel agents edit the same files without coordination.
- Final integration review is mandatory for cross-task behavior.
