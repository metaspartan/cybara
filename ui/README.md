# Cybara Web UI

React 19 + Vite + TanStack Query frontend for the Cybara Agent Platform.

## Stack

- **React 19** with modern hooks and concurrent features
- **Vite** for fast development and production bundling
- **TanStack Query** for server state management
- **Tailwind CSS v4** with Liquid Glass design system
- **xterm.js** for the web terminal

## Pages (21)

| Page | Description |
|------|-------------|
| **Dashboard** | System overview, agent status, health metrics |
| **Chat** | Real-time conversational interface with agent/model selector |
| **IDE** | Code editor with LSP integration (hover, go-to-definition, diagnostics) |
| **Terminal** | Full-featured web terminal with PTY support |
| **Skills** | Browse, install, manage skills with eligibility indicators |
| **Memory** | Semantic memory browser and search |
| **Agents** | Create and manage AI agents |
| **Providers** | Configure AI providers (API key + OAuth flows) |
| **Router** | Model routing and provider fallback settings |
| **Sessions** | Active session monitoring |
| **Tasks** | Cron job management with run history |
| **Channels** | Multi-channel configuration (Telegram, Discord, etc.) |
| **MCP Servers** | Install and manage MCP tool servers |
| **LSP** | Language server installation and status |
| **Metrics** | Token usage and performance analytics |
| **Logs** | System and agent activity logs |
| **Tools** | Tool registry and documentation |
| **Wallet** | Encrypted local wallet, balances, transfers, and policy controls |
| **Artifacts** | Generated artifact browser and previews |
| **Settings** | Platform configuration with 10 theme accent colors |
| **Setup** | First-run setup wizard |

## Development

```bash
# From the project root
bun run ui:dev      # Start Vite dev server with HMR
bun run ui:build    # Build for production
bun run ui:preview  # Preview production build
```

The UI connects to the Cybara backend at `http://localhost:4269` by default.

## Design System

Uses a "Liquid Glass" design system:
- High-blur glassmorphism effects
- Static radial backgrounds
- 10 user-selectable accent colors
- Dark mode optimized
- Responsive layouts with collapsible sidebar
- Custom header toolbars per page

## Project Structure

```
ui/
├── src/
│   ├── App.tsx           # Router + layout
│   ├── index.css         # Global styles + design tokens
│   ├── main.tsx          # Entry point
│   ├── pages/            # 21 page components
│   ├── components/       # Shared components
│   └── stores/           # State management
├── public/               # Static assets
├── index.html            # HTML template
└── vite.config.ts        # Vite configuration
```
