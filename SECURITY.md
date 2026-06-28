# Security Policy

Cybara is an open-source AI agent platform with a CLI, web UI, and desktop apps.
We take the integrity of release artifacts and the handling of user secrets
seriously. This document covers supported versions, reporting vulnerabilities,
and how releases are protected.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security problems.**

Instead, report vulnerabilities privately using GitHub's advisory system:

1. Go to **Security → Advisories → Report a vulnerability** on the
   [`metaspartan/cybara`](https://github.com/metaspartan/cybara/security/advisories/new)
   repository, **or**
2. Email the maintainer directly.

Please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept, minimal config, etc.).
- Affected versions, if known.
- Any suggested fix.

We aim to acknowledge reports within **72 hours** and to publish a fix and CVE
(if warranted) within **30 days**, coordinating disclosure with you.

## Supported Versions

Only the **latest** release line receives security fixes. Older releases are not
patched — use `cybara update` to stay current.

## Release Integrity

Cybara ships three kinds of artifacts from GitHub Releases; each is protected as
follows:

| Artifact | Verification |
| --- | --- |
| Compiled CLI binaries (`cybara-<os>-<arch>`) | Each ships with a `<asset>.sha256` sidecar and a combined `checksums.txt`. `cybara update` and `install.sh` verify the SHA256 before installing. A missing sidecar aborts the install unless explicitly overridden with `--force`. |
| Tauri desktop installers (macOS/Windows/Linux) | Signed with a Tauri updater keypair; the in-app updater checks the `latest.json` manifest and signature. The publish workflow refuses to publish a release that is missing `latest.json`. |
| Native macOS `.app` bundles | Codesigned and notarized with an Apple Developer ID when the Apple secrets are configured; each ships with a `.sha256` sidecar. |

To manually verify a CLI binary after download:

```bash
shasum -a 256 cybara-darwin-arm64   # macOS/Linux
# compare against the value in cybara-darwin-arm64.sha256
```

### Release gating

A release can only be cut after the full CI suite passes (`bun run check:ci`:
typecheck, lint, LOC guard, smoke tests, dead-code report). Tag-triggered builds
run the checks unconditionally; the `skip_tests` escape hatch applies only to
manual `workflow_dispatch` runs.

## Signing Secrets (for maintainers)

Releases require the following repository secrets to be configured. Without
them, the desktop in-app updater and/or macOS Gatekeeper approval will fail:

- `TAURI_SIGNING_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — required for desktop auto-updates.
- `APPLE_DEVELOPER_ID_CERTIFICATE_P12`,
  `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`,
  `APPLE_DEVELOPER_ID_SIGNING_IDENTITY`, `APPLE_KEYCHAIN_PASSWORD` — codesigning.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — notarization.

Generate the Tauri updater keypair with:

```bash
bunx @tauri-apps/cli signer generate -w ~/.cybara/tauri-updater.key
```

Store the private key + password as repo secrets and the public key as
`TAURI_SIGNING_PUBLIC_KEY`. Never commit signing keys to the repository.

## Local API trust model

The HTTP API binds to `127.0.0.1` by default and requires an API key. For local
development convenience, **same-origin browser requests** (the bundled web UI,
identified by the `Sec-Fetch-Site: same-origin` signal) are allowed without a
token. Non-browser local clients (curl, scripts, other processes) must present
the API key — they do **not** inherit the bypass. To require the key for every
request (including the web UI), set `CYBARA_REQUIRE_AUTH=1`. Only expose the API
beyond localhost (`--expose` / `CYBARA_HOST`) on a trusted network; the API key
is then mandatory for all callers.

Dangerous tools (shell/code execution, file writes, wallet sends, computer-use)
are additionally gated by the dangerous-tool approval policy
(`tool_approval_mode`). Wallet sends honor an optional recipient allowlist and
per-transaction cap (`wallet` agent policy). Provider credentials are stored in
`~/.cybara/data/platform.db` with owner-only file permissions.

## Third-party channels (use at your own risk)

The **WhatsApp** channel uses [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js),
an **unofficial, reverse-engineered** automation of WhatsApp Web that is **not**
affiliated with or endorsed by WhatsApp/Meta. Automating WhatsApp this way may
violate WhatsApp's Terms of Service and **can get your account banned**. The
WhatsApp channel is opt-in; enable it only if you accept that risk. Other
channels (Discord, Telegram, Slack, Signal, SMS, email) use official or
documented APIs.

## Scope

This policy covers the Cybara codebase and its official release artifacts. It
does **not** cover third-party MCP servers, plugins, or models you connect to
after install — configure those per their own security guidance.
