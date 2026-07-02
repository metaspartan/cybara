# Cybara Skills Guide

Skills are modular capabilities that extend agent behavior.

## Skill Format

Every skill is a folder containing at minimum `SKILL.md`:

```
my-skill/
├── SKILL.md           # Required: instructions + metadata
├── scripts/           # Optional: helper scripts
├── examples/          # Optional: usage examples
└── resources/         # Optional: assets/templates
```

### SKILL.md Structure

```yaml
---
name: git-commit
description: Generate semantic commit messages from staged changes
os: [darwin, linux]          # Optional: OS filter
env:                         # Optional: required env vars
  - GITHUB_TOKEN
binaries:                    # Optional: required binaries
  - git
---

# Git Commit Skill

When the user asks to commit changes:

1. Run `git diff --cached` to see staged changes
2. Analyze the changes and generate a semantic commit message
3. Format as: `<type>(<scope>): <description>`
4. Use `exec` to run `git commit -m "<message>"`

## Commit Types
- feat: New feature
- fix: Bug fix
- docs: Documentation
- refactor: Code refactoring
- test: Tests
- chore: Maintenance
```

## Skill Discovery (4 tiers)

1. **Bundled** - `<install>/skills/`
2. **Local** - `~/.cybara/skills/`
3. **Workspace** - `<workspace>/.skills/`
4. **Registry** - ClawhHub, skills.sh

## Eligibility Gating

Skills can specify requirements:

```yaml
---
os: [darwin, linux]      # Only macOS/Linux
env: [OPENAI_API_KEY]    # Require env var
binaries: [ffmpeg, git]  # Require binaries
---
```

Ineligible skills are hidden from the agent.

## Installing Skills

### From Registry

```bash
# ClawhHub
cybara skill install clawhub:git-commit

# skills.sh
cybara skill install skills.sh:code-review

# Direct URL
cybara skill install https://github.com/user/skill.git
```

### Via UI

1. Navigate to Skills page
2. Click "Browse Registry"
3. Search and click "Install"

## Creating Custom Skills

1. Create folder in `~/.cybara/skills/my-skill/`
2. Add `SKILL.md` with YAML frontmatter
3. Write markdown instructions
4. Skills auto-reload (no restart needed)

## Self-Improving Skills

Agents can create their own skills at runtime with the `skill_save` tool. After
finishing a complex multi-step task whose procedure is likely to recur, an agent
writes a concise SKILL.md-style procedure (when to use it, prerequisites, the
verified steps) to `~/.cybara/skills/<slug>/SKILL.md`. The loader picks it up so
future sessions can reuse the procedure — the same discovery, eligibility
gating, and hot-reloading rules apply as for hand-authored skills.

```json
{"name": "skill_save", "args": {"name": "Deploy Cloudflare Worker", "description": "When and how to ship a Worker", "content": "## When to use\n...\n## Steps\n1. ..."}}
```

### Example: Code Review Skill

```yaml
---
name: code-review
description: Review code for best practices and issues
binaries: [git]
---

# Code Review Skill

When asked to review code:

1. Use `exec` to run `git diff` or `git show`
2. Analyze the changes for:
   - Security issues
   - Performance problems
   - Code style violations
   - Missing error handling
3. Provide actionable feedback

## Review Format

**Severity**: Critical/Warning/Info
**File**: path/to/file.ts
**Line**: 42
**Issue**: Description
**Fix**: Suggested solution
```

## Skill Lifecycle

```
Agent Request
     │
     ▼
┌─────────────────┐
│ Scan Skills     │ ← All SKILL.md files
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Check Eligible  │ ← OS, env, binaries
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Match Request   │ ← Description matching
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Load SKILL.md   │ ← Read full instructions
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Follow Steps    │ ← Agent executes
└─────────────────┘
```

## Hot Reloading

Skills are watched for changes. Edit and save - no restart needed.

## Multi-Registry Search

Search across all configured registries:

```bash
cybara skill search "git"
```

API:
```
GET /api/skills/registry/search?q=git&registry=all
```
