import type { SkillEntry } from "./types";

interface BuiltinPack {
  name: string;
  description: string;
  instructions: string;
}

const PACKS: BuiltinPack[] = [
  {
    name: "web-research",
    description:
      "Run a structured web research pass: plan queries, gather from multiple sources, cross-check, and synthesize with citations.",
    instructions: `# Web research

1. Restate the question and list the specific facts you need to answer it.
2. Draft 3-5 distinct search queries covering different angles and terminology.
3. For each promising result, fetch the page and extract only the passages that bear on the question; note the source URL.
4. Cross-check every non-obvious claim against at least two independent sources; flag anything you can only find once.
5. Synthesize a concise answer. Attribute each claim to its source and separate verified facts from inference.
6. End with a short "confidence and gaps" note: what is solid, what is uncertain, what to check next.`,
  },
  {
    name: "code-review",
    description:
      "Review a change for correctness, security, and clarity before it merges, ranked by severity.",
    instructions: `# Code review

Read the diff in the context of the surrounding code, then check, in order:
- **Correctness**: edge cases, off-by-one, null/undefined, error paths, concurrency, resource cleanup.
- **Security**: untrusted input reaching queries/commands/paths, secrets in code, authz gaps, unsafe deserialization.
- **Behavioral drift**: does the change alter a contract, output shape, or default that callers rely on?
- **Tests**: is the new behavior covered? do existing tests still assert the right thing?
- **Clarity**: names, dead code, comments that lie, needless complexity.

Report findings most-severe first with a concrete failing scenario (inputs → wrong result) for each. Do not pad the list with style nits when there are real defects.`,
  },
  {
    name: "debugging",
    description: "Systematically isolate the root cause of a bug instead of guessing at fixes.",
    instructions: `# Debugging

1. Reproduce it reliably. Capture the exact inputs, environment, and the full error/stack.
2. State the expected vs actual behavior in one sentence each.
3. Form hypotheses ranked by likelihood. Change one variable at a time.
4. Bisect: narrow the failing surface with logging, a minimal repro, or git bisect until you have the smallest input that triggers it.
5. Confirm the root cause by explaining the mechanism — why this input produces this output.
6. Fix the cause, not the symptom. Add a regression test that fails before and passes after.
7. Check for the same class of bug elsewhere.`,
  },
  {
    name: "data-analysis",
    description: "Explore a dataset (CSV/JSON/table) and answer questions about it defensibly.",
    instructions: `# Data analysis

1. Profile first: row count, columns, types, null rates, obvious duplicates, and value ranges.
2. State assumptions about what each column means; verify a few rows by hand.
3. Clean deliberately — document every transformation (dropped rows, coerced types, filled nulls) so results are reproducible.
4. Answer the question with the simplest aggregation that works; sanity-check totals against a known figure.
5. Watch for traps: survivorship bias, mixed units, timezone/locale, silently truncated joins.
6. Report the number with its caveats and the exact steps used to derive it.`,
  },
  {
    name: "diagramming",
    description:
      "Produce a clear Mermaid diagram (flowchart, sequence, ER, or state) from a description or code.",
    instructions: `# Diagramming

1. Pick the diagram type that fits the intent: flowchart for process, sequenceDiagram for interactions over time, erDiagram for data models, stateDiagram-v2 for state machines.
2. Extract the real entities and relationships from the source; do not invent detail.
3. Emit valid Mermaid in a \`\`\`mermaid code block. Keep labels short; group with subgraphs when it aids reading.
4. Left-to-right (LR) usually reads better than top-down for wide processes.
5. Verify every node referenced by an edge is declared, and the syntax parses.`,
  },
  {
    name: "security-review",
    description:
      "Defensive security audit of code or a change: find exploitable weaknesses and how to close them.",
    instructions: `# Security review (defensive)

Audit for real, exploitable issues — not theoretical checklists:
- **Injection**: untrusted input reaching SQL, shell, file paths, template engines, or eval.
- **AuthN/AuthZ**: missing checks, IDOR (acting on an id without ownership check), privilege escalation.
- **Secrets**: hardcoded keys/tokens, secrets logged, secrets in URLs.
- **Data exposure**: overly broad responses, PII in logs, missing redaction.
- **Untrusted deserialization / SSRF / path traversal.**

For each finding: state the concrete attack (input → impact), rate severity, and give the minimal fix. Only report issues you can trace to a real code path.`,
  },
  {
    name: "technical-writing",
    description:
      "Write or restructure documentation (README, guide, API doc) that a newcomer can actually follow.",
    instructions: `# Technical writing

- Lead with what it is and who it's for, in one or two sentences.
- Put a working quickstart near the top: the shortest path from zero to a running result, copy-pasteable.
- Order sections by reader need (get started → common tasks → reference), not by how the code is organized.
- Show, don't tell: concrete commands and example inputs/outputs beat prose.
- Name things the way the reader thinks of them, not by internal implementation.
- Keep each command's effect explicit; call out anything destructive or irreversible.
- End with troubleshooting for the failures people actually hit.`,
  },
  {
    name: "release-management",
    description: "Cut a clean release: version bump, changelog, tag, and verification.",
    instructions: `# Release management

1. Decide the version bump from the changes (semver: breaking → major, feature → minor, fix → patch).
2. Assemble a changelog grouped by Added / Changed / Fixed / Removed, written for users, linking notable changes.
3. Verify the tree is green (build, typecheck, tests) before tagging.
4. Bump the version in every place that declares it, consistently.
5. Tag and push; confirm the release pipeline produced the expected artifacts and checksums.
6. Smoke-test the built artifact, not just the source.`,
  },
  {
    name: "api-integration",
    description:
      "Integrate a third-party API safely: auth, pagination, retries, rate limits, and error handling.",
    instructions: `# API integration

1. Read the auth model first (API key, OAuth, signed requests) and keep credentials out of code — load from config/env.
2. Model the happy path, then the failure paths: 4xx (fix the request), 429 (back off), 5xx (retry with jitter).
3. Handle pagination explicitly; never assume one page.
4. Set timeouts and a bounded retry policy with exponential backoff; make retries idempotent.
5. Validate and narrow the response shape before using it; do not trust fields exist.
6. Log enough to debug (status, request id) but never log secrets or full PII payloads.`,
  },
  {
    name: "refactoring",
    description:
      "Refactor safely without changing behavior — small, verified steps behind a test net.",
    instructions: `# Refactoring

1. Establish a safety net first: characterization tests that pin current behavior. If none exist, add them before touching code.
2. Make one structural change at a time (rename, extract, inline, move) and run the tests after each.
3. Keep refactors and behavior changes in separate commits — never mix them.
4. Preserve public contracts; if a signature must change, update all call sites in the same change.
5. Delete dead code you uncover, but confirm it is truly unused first.
6. Stop when the code is clear enough — refactoring has diminishing returns.`,
  },
  {
    name: "incident-response",
    description: "Triage a production incident: stabilize first, diagnose second, prevent third.",
    instructions: `# Incident response

1. Assess impact and blast radius; decide severity. Communicate status early and often.
2. Stabilize before you diagnose — roll back, disable the feature flag, or fail over if that stops the bleeding.
3. Preserve evidence (logs, metrics, timestamps) before it rotates away.
4. Find the trigger: what changed right before it started (deploy, config, traffic, dependency)?
5. Once recovered, write a blameless timeline: what happened, why, how it was fixed.
6. Turn the root cause into concrete follow-ups (a test, an alert, a guardrail) so it can't recur silently.`,
  },
  {
    name: "testing",
    description:
      "Write tests that catch real regressions — meaningful cases, clear assertions, no flakiness.",
    instructions: `# Testing

- Test behavior and contracts, not implementation details — a good test survives a refactor.
- Cover the boundaries: empty, one, many, max; nulls; error paths; and the specific bug you're fixing.
- One reason to fail per test; assert the actual value, not just "no error".
- Make tests deterministic: no real clock, network, or random unless injected/seeded; isolate shared state.
- Prefer a few high-signal tests over many shallow ones. A test that can't fail is noise.
- For a bug fix, write the failing test first, then make it pass.`,
  },
  {
    name: "devops",
    description: "Containerize, build in CI, and deploy a service reliably and reproducibly.",
    instructions: `# DevOps

- Make builds reproducible: pin base images and dependency versions; build once, promote the same artifact across environments.
- Keep containers lean: multi-stage builds, no secrets in layers, run as non-root, minimal base.
- CI should fail fast and mean something: lint → typecheck → test → build, in order.
- Config via environment, secrets via a secret store — never baked into the image or committed.
- Deploys should be reversible: health checks, and a rollback path (previous image/tag) that's one command.
- Observe what you ship: logs, a health endpoint, and one alert on the thing that actually breaks.`,
  },
  {
    name: "git-workflow",
    description:
      "Use Git cleanly: focused commits, understandable history, safe branching and rebasing.",
    instructions: `# Git workflow

- One logical change per commit; a message that says what changed and why (not "fixes").
- Branch off the latest main; keep branches short-lived and rebased on main to avoid drift.
- Never rewrite history that others have pulled; rebase only your own unpushed work.
- Review your own diff before committing — no stray debug code, secrets, or unrelated churn.
- Resolve conflicts by understanding both sides, not by blindly picking one; re-run tests after.
- Keep generated artifacts and secrets out of the tree via .gitignore.`,
  },
  {
    name: "accessibility",
    description: "Make a web UI usable by keyboard and screen readers, meeting WCAG basics.",
    instructions: `# Accessibility

- Every interactive element must be reachable and operable by keyboard, with a visible focus state.
- Use semantic HTML first (button, a, nav, label); reach for ARIA only to fill gaps, never to replace semantics.
- Give images meaningful alt text (or empty alt if decorative); label every form control.
- Maintain color contrast (4.5:1 for text) and never encode meaning by color alone.
- Respect prefers-reduced-motion; don't trap focus except in intentional modals (which must trap and restore it).
- Test the flow with the keyboard only and with a screen reader before calling it done.`,
  },
  {
    name: "github",
    description:
      "Work effectively on GitHub: pull requests, issues, reviews, and releases via the gh CLI.",
    instructions: `# GitHub workflow

- Open PRs from a topic branch against the default branch; title says what changes, body says why + how to test.
- Keep PRs small and single-purpose; a reviewer should hold the whole change in their head.
- Link the issue the PR closes; use "Closes #123" so it auto-closes on merge.
- For reviews: read the diff in context, run it if you can, and leave specific, actionable comments — approve, request changes, or comment, not vague praise.
- Use the gh CLI for automation (gh pr create/view/checks, gh issue list, gh release create); never paste tokens into commands.
- Before requesting review, ensure CI is green and the branch is up to date with main.`,
  },
  {
    name: "prompt-engineering",
    description:
      "Write clear, reliable prompts for LLMs — structure, examples, and constraints that reduce failure.",
    instructions: `# Prompt engineering

- State the role, the task, and the exact output format up front; ambiguity is the main cause of bad output.
- Give the constraints explicitly (length, tone, what to avoid) rather than hoping they're inferred.
- Show 1-3 concrete examples of input→desired output when the format matters (few-shot beats description).
- Put the most important instruction last or first, not buried in the middle.
- Ask for reasoning before the answer when correctness matters; ask for the answer only when brevity matters.
- Iterate on real failures: capture a bad output, identify which instruction it violated, and tighten that.`,
  },
  {
    name: "note-taking",
    description: "Capture and organize knowledge so it's findable and reusable later.",
    instructions: `# Note-taking

- Write the note for your future self who has forgotten the context — include the why, not just the what.
- One idea per note; give it a descriptive title you'd actually search for.
- Link related notes explicitly so knowledge forms a graph, not a pile.
- Prefer durable, evergreen phrasing over dated status updates.
- Capture the source (URL, person, date) so a claim can be traced later.
- Review and prune periodically — a note you never revisit and can't find is wasted effort.`,
  },
  {
    name: "regex",
    description:
      "Write, read, and debug regular expressions safely — including avoiding catastrophic backtracking.",
    instructions: `# Regular expressions

- Anchor when you mean it (^ $ \\b); an unanchored pattern matches anywhere and causes surprises.
- Prefer specific character classes over . ; escape regex metacharacters in literal text.
- Beware catastrophic backtracking: nested quantifiers on overlapping classes ((a+)+, (.*)*) can hang on adversarial input — rewrite to be linear or bound the input.
- Use non-capturing groups (?:...) unless you need the capture; name captures when there are several.
- Test against the tricky cases: empty string, unicode, newlines (dotall vs multiline), and the input that should NOT match.
- For anything structural (HTML, nested syntax), use a real parser, not a regex.`,
  },
  {
    name: "sql",
    description: "Write correct, efficient SQL and reason about query performance.",
    instructions: `# SQL

- Start from the exact question; write the SELECT list and grouping that answers it, then add filters.
- Be explicit about JOIN type and keys; a missing/loose join condition silently multiplies rows — verify row counts.
- Filter before aggregating; use HAVING only for post-aggregate conditions.
- Beware NULL semantics (NULL != NULL; NOT IN with NULLs), timezone handling, and integer division.
- For performance: check that filtered/joined columns are indexed; avoid functions on indexed columns in WHERE; prefer set operations over row-by-row logic.
- Read the query plan when a query is slow rather than guessing.`,
  },
];

export function getBuiltinSkillPacks(): SkillEntry[] {
  return PACKS.map((pack) => ({
    skill: {
      name: pack.name,
      description: pack.description,
      location: `builtin:${pack.name}`,
      instructions: pack.instructions,
    },
    frontmatter: { name: pack.name, description: pack.description },
    invocation: { userInvocable: true, disableModelInvocation: false },
    filePath: `builtin:${pack.name}`,
    source: "bundled",
  }));
}
