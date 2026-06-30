# Cybara Mobile

Cybara Mobile is the React Native companion app for iOS and Android. It does not run the Cybara runtime locally on the phone; it connects to a Cybara gateway already running from the CLI, Tauri desktop app, native macOS app, or hosted server.

## Design Direction

- dark theme by default
- Liquid Glass-inspired translucent surfaces, grouped controls, and interactive glass buttons
- compact operator dashboard instead of a marketing screen
- remote-first feature coverage for sessions, agents, providers, tools, approvals, wallet policy, channels, tasks, memory, terminal, logs, and settings

## Development

```bash
bun run mobile:dev
bun run mobile:ios
bun run mobile:android
bun run mobile:typecheck
bun run test:mobile
```

## Connect A Device

On the machine running Cybara:

```bash
cybara mobile connect --qr
```

Paste or scan the emitted payload in the mobile app. The payload uses the `cybara-mobile-connect-v1` contract and includes the gateway URL plus the local API key.

For LAN devices, make sure the gateway is reachable from the phone. Localhost only works from the same machine; use the host LAN IP or a trusted tunnel for remote access.
