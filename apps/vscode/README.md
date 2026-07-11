# Cybara for VS Code

Opens the [Cybara](https://cybara.ai) self-hosted AI agent platform for your current workspace.

## Commands

- **Cybara: Open Dashboard** — opens the gateway dashboard
- **Cybara: Open Chat for Workspace** — opens chat scoped to the open folder
- **Cybara: Open IDE for Workspace** — opens the Cybara IDE for the open folder

A status-bar item shows whether the gateway is reachable and opens the dashboard on click.

## Setup

1. Run the Cybara gateway locally: `cybara start` (default `http://localhost:4269`).
2. Set `cybara.gatewayUrl` in settings if your gateway runs elsewhere.

## Develop

```bash
cd apps/vscode
bun install
bun run build     # bundles dist/extension.js
bun run package   # produces a .vsix (requires @vscode/vsce)
```
