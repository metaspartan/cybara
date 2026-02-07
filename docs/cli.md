# Cybara CLI Reference

The `cybara` command controls the Cybara agent platform.

## Synopsis

```bash
cybara <command> [options]
```

## Commands

### System Status

```bash
cybara status             # Show status and health
cybara metrics            # Show token usage and metrics
cybara logs [count]       # Show recent logs (default: 20)
```

### Daemon Control

```bash
cybara start              # Start daemon (foreground)
cybara start -d           # Start daemon (background)
cybara stop               # Stop daemon
cybara restart            # Restart daemon
```

### Agents

```bash
cybara agents             # List configured agents
cybara agent list         # List agents (alias)
cybara agent create <name> # Create new agent
cybara agent delete <id>  # Delete agent
cybara agent start <id>   # Start agent
cybara agent stop <id>    # Stop agent
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
cybara browser tabs       # List open browser tabs
```

### Channels

```bash
cybara channels           # List configured channels
cybara channel list       # List channels (alias)
cybara channel add <type> # Add channel (telegram, discord, etc.)
cybara channel remove <id> # Remove channel
cybara channel test <id>  # Test channel connection
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
cybara skill list         # List skills (alias)
cybara skill install <url> # Install from URL/registry
cybara skill remove <name> # Remove skill
cybara skill update       # Update all skills
cybara skill search <q>   # Search registries
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
cybara config get <key>   # Get config value
cybara config set <key> <val> # Set config value
cybara config list        # List all config
```

### Setup

```bash
cybara wizard             # Run setup wizard (first-time configuration)
```

## Options

```
-p, --port <port>    Server port (default: 4269)
-d, --daemon         Run in background
-v, --verbose        Verbose output
-h, --help           Show help
--version            Show version
```

## Environment Variables

```bash
PORT=4269                 # Server port
BRAVE_API_KEY=...         # Web search API key
CYBARA_HOME=~/.cybara     # Data directory
CYBARA_API=http://localhost:4269  # API endpoint for CLI
```

## Examples

```bash
# Start in development
bun run dev

# Start production daemon
cybara start -d

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

# Install a skill from ClawhHub
cybara skill install clawhub:git-commit

# Install MCP server
cybara mcp install @anthropic/mcp-server-filesystem

# Add Telegram channel
cybara channel add telegram

# Install Python LSP
cybara lsp install python
```
