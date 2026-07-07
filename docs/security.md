# Cybara Security Model

Cybara is designed for self-hosted deployment on personal devices and home networks. This guide covers the security features and best practices.

## Network Binding

By default, Cybara binds to `127.0.0.1` (localhost only). This means it's only accessible from the same machine.

### Exposing to LAN

To access Cybara from other devices on your network:

```bash
cybara start --expose          # Binds to 0.0.0.0
CYBARA_HOST=0.0.0.0 cybara start  # Same via env var
```

> **⚠️ Warning**: Only use `--expose` on trusted networks. See "Best Practices" below.

## API Key Authentication

Cybara auto-generates an API key on first run and saves it to `~/.cybara/api_key` with `600` permissions (owner-only read/write).

### Authentication Methods

```bash
# Bearer token
curl -H "Authorization: Bearer cybara_abc123..." http://localhost:4269/api/status

# Environment variable
CYBARA_API_KEY=my_custom_key cybara start
```

### Localhost Bypass

In development mode (`NODE_ENV !== "production"`), Cybara keeps a narrow localhost bypass for
same-origin browser requests from the local Web/Tauri/native UI. Local CLI tools, bare `curl`
requests, cross-origin browser requests, DNS-rebinding attempts, and non-local requests still need a
valid API key. In production mode, all connections require a valid API key unless the operator has
explicitly changed auth settings.

Settings exposes localhost auth policy, API-key reveal/rotation, and gateway restart. API-key
rotation hot-swaps the key in memory without restarting the gateway.

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Global | 200 req/min per IP |
| Chat | 60 req/min per IP |
| Pairing | 10 req/min per IP |
| Auth failures | 5 per 5 min per IP |

Rate limit headers are included in every response:
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

## SSRF Protection

Outbound requests from tools (web fetch, browser) block:
- Private IP ranges (10.x, 172.16-31.x, 192.168.x)
- Loopback (127.x)
- Link-local, multicast, broadcast
- Cloud metadata endpoints (169.254.x, metadata.google.internal)

## Input Validation

- Messages capped at 32KB
- Null bytes stripped from all input
- String inputs trimmed to length limits

## File System Access

File-writing tools enforce a hard deny-list before writes, including credentials, SSH keys, `.env`
files, cloud credentials, and OAuth token material. Workspace confinement can be enabled through the
execution context so agentic file writes stay inside the selected workspace; symlink escapes are
blocked by the path policy tests. Agent file reads and writes should still be treated as privileged
local actions and paired with tool approvals for untrusted tasks.

## Security Headers

All API responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

## Web Terminal

The built-in web terminal is **disabled by default**. Enable with:

```bash
cybara start --enable-terminal
```

It can also be enabled from Web/Tauri settings for local operator workflows.

When enabled:
- Requires API key authentication
- PTY sessions are isolated per-connection
- Only accessible from localhost unless `--expose` is also set
- Tauri desktop app can use terminal natively

Paired mobile devices require the `terminal` scope before terminal entrypoints are usable.

## Plugins

Cybara plugins are trusted local code, not a sandbox boundary.

Production guidance:

- install only reviewed plugins from trusted sources
- prefer workspace-local plugins for project-specific behavior
- understand that plugin-contributed skills execute with the same host trust boundary as other local Cybara runtime code
- use extra caution on shared operator machines until plugin signatures/integrity metadata are in place
- treat MCP server installs the same way: they run external commands selected by the operator and
  should only be installed from trusted packages or reviewed local paths

## Best Practices for Self-Hosting

1. **Keep it local** — Don't expose to the internet. Use a VPN if remote access is needed.
2. **Use a strong API key** — Set `CYBARA_API_KEY` to a custom key if exposing to LAN.
3. **Run behind a reverse proxy** — For HTTPS, use nginx/caddy with TLS.
4. **Update regularly** — Pull latest for security patches.
5. **Review agent permissions** — Limit tool access for agents that interact with external channels.
6. **Treat plugin installs as privileged** — Review manifests and contributed content before installing.

## Files & Permissions

| Path | Purpose | Permissions |
|------|---------|-------------|
| `~/.cybara/api_key` | API key | `600` (owner only) |
| `~/.cybara/config.json` | Configuration | `644` |
| `~/.cybara/data/platform.db` | Database | `644` |
| `~/.cybara/cybara.log` | Daemon log (optional) | `644` |
