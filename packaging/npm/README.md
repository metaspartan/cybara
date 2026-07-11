# Cybara

Self-hosted, open-source AI agent platform — the `cybara` command-line interface.

Cybara pairs a Bun agent runtime with a web dashboard, desktop and mobile apps, a broad tool layer, 25+ messaging-channel adapters, MCP support, and encrypted wallet controls — so agents can code, automate browsers, run messaging workflows, and execute on-chain operations under full operator control.

## Install

Run it instantly with no install:

```sh
npx cybara
# or
bunx cybara
```

Or install globally:

```sh
npm install -g cybara
# or
bun add -g cybara
```

## Usage

```sh
cybara            # start the gateway (dashboard on http://localhost:4269)
cybara --help     # list all commands
cybara --version  # print the version
```

## How this package works

This package is a thin launcher. On install (or on first run) it downloads the matching prebuilt `cybara` binary for your platform from the official [GitHub release](https://github.com/metaspartan/cybara/releases) and verifies its SHA-256 checksum. Supported platforms:

- macOS — Apple Silicon (`arm64`) and Intel (`x64`)
- Linux — `x64` and `arm64`
- Windows — `x64`

The binary embeds the Bun runtime, so no separate Bun or Node runtime is required to run it.

## Links

- Website: https://cybara.ai
- Source: https://github.com/metaspartan/cybara
- Issues: https://github.com/metaspartan/cybara/issues

## License

MIT
