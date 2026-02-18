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
cybara chat               # Interactive TUI chat (sessions, subagents, tools)
cybara wizard             # Setup wizard (first-time configuration)
cybara tui                # Main menu (interactive TUI)
```

### System Status

```bash
cybara status             # Show status and health
cybara metrics            # Show token usage and metrics
cybara logs [count]       # Show recent logs (default: 20)
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

### MCP Servers

```bash
cybara mcp list           # List installed MCP servers
cybara mcp search <query> # Search MCP registry
cybara mcp install <pkg>  # Install MCP server package
cybara mcp popular        # Show popular servers
```

### Skills

```bash
cybara skills             # List installed skills
```

### LSP (Language Servers)

```bash
cybara lsp                # Show language server status
cybara lsp list           # Show status (explicit)
cybara lsp install <lang> # Install language server
cybara lsp uninstall <lang> # Uninstall language server
```

Supported languages: `rust`, `go`, `python`, `cpp`, `java`, `csharp`, `ruby`, `php`, `lua`, `zig`, `kotlin`, `swift`

### Configuration

```bash
cybara config             # Show current config
cybara config get <key>   # Get config value
cybara config set <key> <val> # Set config value
```

## Options

```
-d, --daemon, -bg    Run server in background
--expose             Bind to 0.0.0.0 (allow LAN access)
--enable-terminal    Enable web terminal access
--version, -v        Show version
--help, -h           Show help
```

## Environment Variables

```bash
PORT=4269                 # Server port
CYBARA_HOST=127.0.0.1     # Bind address (default: localhost only)
CYBARA_API_KEY=...        # API key (auto-generated if not set)
CYBARA_API=http://localhost:4269  # API endpoint for CLI
BRAVE_API_KEY=...         # Web search API key
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

# Check platform health
cybara status

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
