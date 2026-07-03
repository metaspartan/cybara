---
name: oss-forensics
description: Investigate open-source repository compromise, deleted commits, force-pushes, suspicious releases, and supply-chain indicators with evidence IDs.
metadata: {"cybara":{"requires":{"bins":["git","curl","jq","rg"]}}}
---

# OSS Forensics

Use this for defensive supply-chain investigations: suspicious commits, force-pushes, deleted releases, maintainer takeover concerns, leaked secrets, or package compromise.

## Guardrails

- Evidence first. Every claim needs an evidence ID such as `EV-0001`.
- Separate fact from hypothesis. Prefix unverified inferences with `[HYPOTHESIS]`.
- Do not run code from the investigated repository.
- Redact secrets in chat and reports.
- Double-check SHAs, URLs, package versions, and actor names against more than one source when possible.

## Evidence Store

Create a working directory outside the target repo:

```bash
INVESTIGATION="oss-forensics-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$INVESTIGATION"/{evidence,reports}
cd "$INVESTIGATION"
printf "# Evidence\n\n" > evidence/index.md
```

Evidence entry shape:

```text
EV-0001
Source: local git log
Time collected: <ISO timestamp>
Claim supported: <short claim>
Artifact: evidence/git-log.txt
Notes: <why it matters>
```

## Collection Plan

1. Extract targets:
   - repo, package names, SHAs, actors, date range, releases, domains, URLs.
2. Local git source:
   - `git clone --mirror` or normal clone.
   - `git log --all --full-history --stat --format="%H|%ae|%an|%ai|%s"`.
   - `git fsck --lost-found --unreachable`.
   - `git branch -a -v`, tags, release branches, suspicious binaries.
3. GitHub/API source:
   - commits, PRs, issues, releases, events, tags.
   - Use `GITHUB_TOKEN` if available to avoid low rate limits.
4. Archive sources:
   - Wayback CDX for deleted PRs/issues/releases.
   - GH Archive or public event datasets when date windows matter.
5. Package registries:
   - npm/PyPI/crates/GitHub Releases metadata, checksums, publish dates.
6. IOC extraction:
   - domains, IPs, package names, hashes, suspicious scripts, workflow edits.

## Analysis

Create hypotheses, then validate:

- Force-push hide: evidence from local unreachable commits plus public events.
- Maintainer takeover: unusual actor timing, permissions, workflow changes, signed commit drift.
- Release/package swap: tag/release/package timestamps disagree or artifacts changed.
- Secret leak: secret-like material existed in a reachable/dangling commit and was pushed externally.

## Report

Include:

- Scope and timeline.
- Evidence table.
- Findings with severity and supporting evidence IDs.
- Hypotheses ruled out and why.
- Recommended containment, rotation, and hardening steps.
