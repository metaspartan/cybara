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

The Web/Tauri Settings → Auth page also has a **Listen on local network** switch. It toggles between
`127.0.0.1` and `0.0.0.0` with a controlled listener rebind, so a full gateway restart is not needed.
The Mobile page only defaults to a LAN QR URL after the running gateway is actually LAN-bound.

> **⚠️ Warning**: Only use `--expose` on trusted networks. See "Best Practices" below.

### Remote Mobile Access

Settings → Gateway → **Remote access domain** lets you add one explicit non-local URL for mobile
pairing without changing the gateway bind host. This is intended for:

- **Private mesh networks**: Tailscale, ZeroTier, or NetBird. Keep Cybara bound to localhost or the
  mesh/LAN interface, connect the phone to the same mesh, and use the mesh URL/IP as the client URL.
- **Public HTTPS tunnels**: Cloudflare Tunnel, Tailscale Funnel, or a custom reverse proxy. These
  must use HTTPS, and Cybara requires the gateway password to be enabled before the URL is considered
  ready for mobile QR pairing.

Recommended setup:

1. Prefer a private mesh when only your own devices need access.
2. For a public hostname, put identity/password protection at the tunnel layer when available
   (Cloudflare Access, Tailscale ACLs/Funnel controls) and enable Cybara's gateway password.
3. Do not bind Cybara directly to the public internet. If a reverse proxy is required, proxy to
   `http://127.0.0.1:4269`, terminate TLS at the proxy, and keep the Cybara API key and gateway
   password private.

Mobile QR pairings carry a short-lived one-time code, not a root API key. Redeemed devices receive
scoped mobile tokens that can be revoked without rotating the root key.

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

1. **Keep it local by default** — Use a private mesh such as Tailscale, ZeroTier, or NetBird for
   remote devices before considering a public domain.
2. **Use a strong API key** — Set `CYBARA_API_KEY` to a custom key if exposing beyond localhost.
3. **Enable the gateway password** — Required by the UI for public remote-access URLs.
4. **Use HTTPS and an access layer** — Cloudflare Access, Tailscale controls, or an authenticated
   reverse proxy should sit in front of public domains.
5. **Update regularly** — Pull latest for security patches.
6. **Review agent permissions** — Limit tool access for agents that interact with external channels.
7. **Treat plugin installs as privileged** — Review manifests and contributed content before installing.

## Files & Permissions

| Path | Purpose | Permissions |
|------|---------|-------------|
| `~/.cybara/api_key` | API key | `600` (owner only) |
| `~/.cybara/config.json` | Configuration | `644` |
| `~/.cybara/data/platform.db` | Database | `644` |
| `~/.cybara/cybara.log` | Daemon log (optional) | `644` |
