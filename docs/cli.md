# Cybara CLI Reference

The `cybara` command controls the Cybara agent platform.

## Synopsis

```bash
cybara <command> [options]
```

## Commands

### Daemon Control

```bash
cybara start              # Start daemon (foreground)
cybara start -d           # Start daemon (background)
cybara stop               # Stop daemon
cybara restart            # Restart daemon
cybara status             # Show status and health
```

### Channels

```bash
cybara channel list             # List configured channels
cybara channel add <type>       # Add channel (telegram, discord, etc.)
cybara channel remove <id>      # Remove channel
cybara channel test <id>        # Test channel connection
```

### MCP Servers

```bash
cybara mcp list                 # List MCP servers
cybara mcp add <name> <config>  # Add MCP server
cybara mcp remove <name>        # Remove MCP server
cybara mcp restart <name>       # Restart MCP server
```

### Skills

```bash
cybara skill list               # List installed skills
cybara skill install <url>      # Install from URL/registry
cybara skill remove <name>      # Remove skill
cybara skill update             # Update all skills
cybara skill search <query>     # Search registries
```

### Agents

```bash
cybara agent list               # List agents
cybara agent create <name>      # Create new agent
cybara agent delete <id>        # Delete agent
cybara agent start <id>         # Start agent
cybara agent stop <id>          # Stop agent
```

### Configuration

```bash
cybara config get <key>         # Get config value
cybara config set <key> <val>   # Set config value
cybara config list              # List all config
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
BRAVE_API_KEY=...        # Web search API key
CYBARA_HOME=~/.cybara    # Data directory
```

## Examples

```bash
# Start in development
bun run dev

# Start production daemon
cybara start -d

# Install a skill from ClawhHub
cybara skill install clawhub:git-commit

# Add Telegram channel
cybara channel add telegram

# Check platform health
cybara status
```
