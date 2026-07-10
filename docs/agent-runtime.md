# Agent Runtime and Prompt Architecture

This document describes Cybara's current model-facing runtime contract. Prompt text provides context
and operating guidance; it never grants filesystem, network, wallet, or process access.

## Request Construction

Cybara builds each model request from current runtime state:

1. Resolve the active agent, provider/model, workspace, channel, and session options.
2. Select built-in tools from the agent configuration and turn intent.
3. Apply tool enablement, permission, approval, URL/path, sandbox, and provider constraints.
4. Load eligible skill descriptions; the model reads one selected `SKILL.md` on demand.
5. Load bounded memory recall and root workspace context files.
6. Add session/subagent state, token budgets, and model-aware reasoning configuration.
7. Compact historical messages and large tool results when the provider context budget requires it.

Runtime policy remains authoritative. Untrusted text from web pages, source files, messages, or tool
results cannot expand the capabilities exposed to an agent.

## Workspace Context

The selected workspace root can contain:

- `AGENTS.md`: project instructions
- `SOUL.md`: persona and tone
- `IDENTITY.md`: identity context
- `USER.md`: user preferences and context
- `TOOLS.md`: workspace-specific tool guidance

Direct user instructions override project files. Tool and security policy override all prompt text.
Context injection is bounded to 20,000 characters per file and 60,000 characters in total so the
stable prompt cannot grow without limit.

## Implemented Contracts

| Area | Current behavior |
|------|------------------|
| Tool exposure | Intent-aware built-in selection, per-agent allowlists and permissions, dynamic tool discovery, MCP tools, and execution-time approval checks |
| Skills | Eligibility-gated catalog, on-demand loading, registry installation, and optional agent-authored reusable procedures |
| Memory | Durable and daily files, hybrid retrieval, optional external providers, and per-agent recall |
| Planning | Session task lists, durable plan artifacts, plan UI, tasks, and environment surfaces |
| Subagents | Isolated sessions, bounded child count, model/reasoning selection, live activity, result delivery, and multi-result synthesis |
| Approvals | Ask/allow modes, per-session and persistent allowlists, dangerous-tool policy, checkpoints, path policy, and sandbox enforcement |
| Context management | Model-aware compaction, provider-overflow retry, recoverable large tool-result storage, and token accounting |
| Hooks | Shell lifecycle hooks plus tool-result, model-output, and terminal-output transforms |
| Interaction | Web/Tauri, native macOS, mobile, CLI/TUI, channels, queue/steer, streaming tool activity, and persisted sessions |

The runtime supports streaming tool execution, plans/tasks, memory, skills, approvals, compaction,
MCP, browser and terminal control, subagents, channels, and cross-client session persistence.
