# Cybara CLI Reference

The `cybara` command controls the Cybara agent platform.

## Synopsis

```bash
cybara <command> [options]
```

## Commands

### Server Control

```bash
cybara                    # Start the server on port 4269 (foreground)
cybara start              # Start the server (foreground)
cybara start -d           # Start the server in background (daemon)
cybara stop               # Stop the background server
cybara daemon-logs        # Show daemon process logs
```

### Interactive Modes

```bash
cybara chat               # Interactive terminal chat with sessions, tools, queueing, and steering
cybara chat --agent <id>  # Start chat with a specific agent
cybara chat --workspace <path>  # Bind new turns to a workspace
cybara wizard             # Setup wizard (first-time configuration)
cybara tui                # Main menu (interactive terminal dashboard)
cybara tui status         # Gateway health panel
cybara tui metrics        # Token/tool/API metrics panel
cybara tui providers      # Provider and coding-plan usage panel
cybara tui router         # Model router state and route windows
cybara tui sessions       # Recent chat/session list
cybara tui logs           # Recent gateway/app logs
cybara tui mobile         # Paired mobile devices
```

`cybara chat` is the terminal chat surface. It supports session history, queued follow-ups while a
run is active, steering a queued follow-up into the active run, pending-message edit/delete/reorder,
agent switching, workspace switching, markdown emphasis, and grouped tool/activity output.

The dashboard TUI is optimized for normal terminals and remains read-only for dashboard panels. Use
the raw CLI commands when you need to mutate providers, router settings, mobile pairings, wallet
state, or channel configuration.

### System Status

```bash
cybara status             # Show status and health
cybara doctor             # Run API + stream + sandbox diagnostics
cybara metrics            # Show token usage and metrics
cybara metrics analysis   # Advanced token analysis
cybara update            # Verify SHA256, then download + install the latest CLI release
cybara update --check    # Only report whether a newer release exists (non-zero if stale)
cybara update --force    # Reinstall even when already current
cybara version           # Show the current version
cybara logs [count]       # Show recent logs (default: 20)
```

`cybara update` verifies the downloaded binary against its published SHA256 sidecar before
installing; it refuses an unverified binary unless you pass `--force`. You can also pin a specific
release:

```bash
cybara update --version 1.0.818
```

### Agents

```bash
cybara agents             # List configured agents
```

### Providers

```bash
cybara provider              # List configured providers
cybara provider available    # Show available provider types
cybara provider add <type>   # Add provider
      --name NAME            # Display name
      --key KEY              # API key (for bearer auth)
      --token TOKEN          # Access token (for token auth)
      --default              # Set as default provider
cybara provider update <id>  # Update provider (same flags)
cybara provider delete <id>  # Delete provider
cybara provider models <id>  # List provider's models
cybara provider discover     # Discover Ollama models
```

**Example:**
```bash
# See all available provider types
cybara provider available

# Add OpenAI with API key
cybara provider add openai --name "My OpenAI" --key sk-abc123... --default

# Add Ollama (no auth needed)
cybara provider add ollama --name "Local Ollama"

# Discover local Ollama models
cybara provider discover

# List models for a provider
cybara provider models abc12345

# Delete a provider
cybara provider delete abc12345
```

### Sessions

```bash
cybara sessions           # List active chat sessions
```

### Source Migration

```bash
cybara migrate sources                         # Detect OpenClaw/Hermes sources
cybara migrate --from openclaw                 # Preview import
cybara migrate --from hermes --apply           # Apply default user-data preset
cybara migrate --apply --preset full           # Include provider/speech categories
cybara migrate --migrate-secrets --overwrite   # Opt into API-key import and conflicts
```

The default migration run is a dry-run preview. Use `--apply` only after reviewing the report.
Secrets are skipped unless `--migrate-secrets` is supplied.

### Memory

```bash
cybara memory             # List recent memory entries
cybara memory <query>     # Search memories semantically
```

### Subagents

```bash
cybara subagent           # List all subagents
cybara subagent list      # List all subagents (explicit)
cybara subagent spawn <t> # Spawn subagent with task
cybara subagent kill <id> # Kill running subagent
```

### Browser

```bash
cybara browser            # Show browser status
cybara browser tabs       # List open browser tabs/profiles
```

### Channels

```bash
cybara channels           # List configured channels
```

### Wallet

```bash
cybara wallet status                                    # Wallet status + RPC settings
cybara wallet create --password <password>              # Create 24-word BIP39 wallet
cybara wallet import --password <password> --mnemonic "..."  # Import 24-word seed phrase
cybara wallet unlock --password <password>              # Unlock wallet in memory
cybara wallet lock                                      # Lock wallet immediately
cybara wallet accounts [--chains eth,btc,sol] [--count N] [--start N]
cybara wallet balances [--chains eth,btc,sol] [--count N] [--start N]
cybara wallet tokens <eth|sol> [--index N] [--include-zero] # ERC-20/SPL token balances
cybara wallet token-tx <eth|sol> [--index N] [--limit N] [--token ADDRESS] # ERC-20/SPL token transfer history
cybara wallet receive <eth|btc|sol> [--index N]        # Get receive address
cybara wallet tx <eth|btc|sol> [--index N] [--limit N] # Transaction history
cybara wallet send <eth|btc|sol> --to <addr> --amount <value> [--index N]
cybara wallet send-token <eth|sol> --token <addr|mint> --to <addr> --amount <value> [--index N]
cybara wallet swap-eth-uniswap --token <symbol|addr> (--percent N | --amount-eth ETH) [--execute]
cybara wallet price [BTC|BTC/USD|<SOL_MINT>] [--source auto|chainlink|pyth|jupiter]
cybara wallet swap [<TOKEN>] [--venue uniswap_v3|uniswap_v2|jupiter] [--execute]
cybara wallet endpoints
cybara wallet dapps                                     # List supported dapp adapters
cybara wallet rpc-call <eth|sol> --method <rpc_method> [--params '[...]'] [--rpc URL]
cybara wallet dapp --adapter <adapter> --json '{...}'  # Dynamic adapter payload
cybara wallet x402 --url <https_url> [--method GET|POST] [--network eip155:1] [--dry-run]
cybara wallet swap-quote --venue <uniswap_v2|uniswap_v3|jupiter> [venue-specific args]  # legacy alias
cybara wallet swap-execute --venue <uniswap_v2|uniswap_v3|jupiter> [venue-specific args] # legacy alias
cybara wallet contract-call --contract <addr> (--abi '<json_or_sig>' | --signature '<name(types)>') [--method <name>] [--args '[...]'] [--read]
cybara wallet sol-instruction --program <id> (--keys '[...]' | --accounts '[...]') [--data-base64 DATA | --data-hex HEX | --data-utf8 TEXT]
cybara wallet agent-access <on|off>                     # Enable/disable agent wallet tool access
cybara wallet agent-policy [show]
cybara wallet agent-policy set --json '{...}'
cybara wallet rpc [show]                                # Show configured endpoints
cybara wallet rpc status
cybara wallet rpc set [--eth URL] [--sol URL] [--btc URL]
```

### Channel Pairing

```bash
cybara pair               # List pending pairings
cybara pair <CODE>        # Approve a pairing code
cybara pair reject <CODE> # Reject a pairing code
cybara pair policy <chan> <policy>  # Set DM policy
```

Policies: `pairing`, `allowlist`, `open`, `disabled`

### Mobile Companion

```bash
cybara mobile connect
cybara mobile connect --url http://192.168.1.20:4269 --name "Studio Gateway" --device "Carsen iPhone"
cybara mobile connect --json
cybara mobile list
cybara mobile revoke <device-id>
cybara mobile remove <device-id>
```

`mobile connect` creates a managed device record and emits a QR-compatible
`cybara-mobile-connect-v1` payload for the React Native iOS/Android app. The payload contains a
revocable per-device token, not the root gateway API key. Use a LAN-reachable URL or a trusted
tunnel when pairing from a phone; `localhost` only works on the same machine.

### MCP Servers

```bash
cybara mcp list           # List installed MCP servers
cybara mcp search <query> # Search MCP registry
cybara mcp install <pkg>  # Install MCP server package
cybara mcp popular        # Show popular servers
cybara mcp serve          # Expose cybara's own tools as an MCP server (stdio)
```

`cybara mcp serve` speaks the MCP JSON-RPC protocol over stdio so other MCP clients (Claude Desktop,
IDEs, other agents) can call cybara's built-in tools. It reads newline-delimited JSON-RPC requests
on stdin and writes responses on stdout.

### Skills

```bash
cybara skills             # List installed skills
cybara plugin             # List installed plugins
cybara plugin validate <path>
cybara plugin install <path>
cybara plugin remove <plugin-id>
```

### LSP (Language Servers)

```bash
cybara lsp                # Show language server status
cybara lsp list           # Show status (explicit)
cybara lsp install <lang> # Install language server
cybara lsp uninstall <lang> # Uninstall language server
```

Supported languages: `rust`, `go`, `python`, `cpp`, `java`, `csharp`, `ruby`, `php`, `lua`, `zig`, `kotlin`, `swift`

### Model Router

```bash
cybara router status                 # Show router status + per-route availability
cybara router enable                 # Enable the router
cybara router disable                # Disable the router
cybara router strategy <name>        # weighted | round_robin | lowest_cost | priority | mixture_of_agents
cybara router set <id> <flags>       # Configure a route
                                     #   weight=70 limit5h=100 limitWeekly=500
                                     #   spendDaily=5 spendWeekly=20 priceIn=10 priceOut=30 enabled=true
```

### ACP (Agent Client Protocol)

```bash
cybara acp                 # Serve the default agent to an ACP client (Zed, etc.) over stdio
cybara acp --agent <id>    # Serve a specific agent
```

### Reasoning Effort

```bash
cybara config set reasoning_effort <minimal|low|medium|high|xhigh>   # default reasoning effort
```

### Configuration

```bash
cybara config             # Show current config
cybara config get <key>   # Get config value
cybara config set <key> <val> # Set config value
```

## Options

```
-d, --daemon, -bg    Run server in background
--port, -p <n>       Gateway port (default 4269; overrides PORT env and config)
--expose             Bind to 0.0.0.0 (allow LAN access)
--enable-terminal    Enable web terminal access
--version, -v        Show version
--help, -h           Show help
```

## Environment Variables

```bash
PORT=4269                 # Server port
CYBARA_HOME=~/.cybara     # Runtime data root
CYBARA_HOST=127.0.0.1     # Bind address (default: localhost only)
CYBARA_API_KEY=...        # API key (auto-generated if not set)
CYBARA_API=http://localhost:4269  # API endpoint for CLI
BRAVE_API_KEY=...         # Web search API key
CYBARA_RELEASE_REPOSITORY=metaspartan/cybara  # Alternate GitHub release repo for update/install
```

## Examples

```bash
# Start in development
bun run dev

# Start production daemon
cybara start -d

# Start with LAN access
cybara start -d --expose

# Interactive chat
cybara chat

# Interactive chat with explicit context
cybara chat --agent agent-codex --workspace ~/Documents/GitHub/cybara

# Headless pending-message controls
cybara chat queue <session-id> "follow up after the active turn"
cybara chat pending <session-id>
cybara chat steer <session-id> <pending-id>
cybara chat edit <session-id> <pending-id> "updated follow-up"
cybara chat reorder <session-id> <pending-id> <pending-id>

# Check platform health
cybara status

# Install the newest released CLI binary
cybara update

# List AI providers
cybara providers

# View recent logs
cybara logs 50

# Search memory
cybara memory "project architecture"

# Spawn a subagent
cybara subagent spawn "Research best practices for testing"

# Install MCP server
cybara mcp install @anthropic/mcp-server-filesystem

# Install Python LSP
cybara lsp install python
```
