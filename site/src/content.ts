export interface Feature {
  title: string;
  description: string;
  icon: string;
}

export interface Platform {
  name: string;
  detail: string;
  icon: string;
}

export interface Stat {
  value: string;
  label: string;
}

export interface Provider {
  name: string;
  mark: string;
}

export interface UseCase {
  title: string;
  description: string;
  icon: string;
}

export interface NavLink {
  label: string;
  labelKey?: TranslationKey;
  href: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { label: "Features", labelKey: "site.nav.features", href: "/features" },
  { label: "Providers", labelKey: "site.nav.providers", href: "/providers" },
  { label: "Channels", labelKey: "site.nav.channels", href: "/channels" },
  { label: "Download", labelKey: "site.nav.download", href: "/download" },
  { label: "FAQ", href: "/faq" },
];

export const GITHUB_URL = "https://github.com/metaspartan/cybara";
export const X_URL = "https://x.com/cybaraAI";
export const CREATOR_X_URL = "https://x.com/carsenklock";
export const RELEASES_URL = "https://github.com/metaspartan/cybara/releases/latest";
export const INSTALL_COMMAND =
  "curl -fsSL https://cybara.ai/install.sh | bash";
export const INSTALL_COMMAND_WINDOWS =
  'powershell -c "irm https://cybara.ai/install.ps1 | iex"';
export const INSTALL_COMMAND_NPM = "npx cybara";
export const INSTALL_COMMAND_BUN = "bunx cybara";

export interface InstallTab {
  key: "shell" | "windows" | "npm" | "bun";
  label: string;
  prompt: string;
  command: string;
  hint: string;
}

export const INSTALL_TABS: readonly InstallTab[] = [
  {
    key: "shell",
    label: "macOS / Linux",
    prompt: "$",
    command: INSTALL_COMMAND,
    hint: "SHA256-verified binary install for macOS and Linux (x64 & arm64).",
  },
  {
    key: "windows",
    label: "Windows",
    prompt: ">",
    command: INSTALL_COMMAND_WINDOWS,
    hint: "PowerShell installer for Windows x64 & arm64, added to your PATH.",
  },
  {
    key: "npm",
    label: "npm",
    prompt: "$",
    command: INSTALL_COMMAND_NPM,
    hint: "Runs instantly with npx — any OS with Node.js installed.",
  },
  {
    key: "bun",
    label: "Bun",
    prompt: "$",
    command: INSTALL_COMMAND_BUN,
    hint: "Runs instantly with bunx — the same runtime Cybara is built on.",
  },
];

export const STATS: readonly Stat[] = [
  { value: "50+", label: "model providers" },
  { value: "80+", label: "built-in tools" },
  { value: "25+", label: "messaging channels" },
  { value: "100%", label: "self-hosted" },
];

export const PROVIDERS: readonly Provider[] = [
  { name: "OpenAI", mark: "openai" },
  { name: "Anthropic", mark: "anthropic" },
  { name: "Google Gemini", mark: "google" },
  { name: "xAI Grok", mark: "xai" },
  { name: "Meta Llama", mark: "meta" },
  { name: "Mistral", mark: "mistral" },
  { name: "DeepSeek", mark: "deepseek" },
  { name: "Moonshot Kimi", mark: "moonshot" },
  { name: "MiniMax", mark: "minimax" },
  { name: "Zhipu GLM", mark: "zhipu" },
  { name: "Groq", mark: "groq" },
  { name: "Ollama", mark: "ollama" },
  { name: "OpenRouter", mark: "openrouter" },
  { name: "AWS Bedrock", mark: "bedrock" },
  { name: "Azure OpenAI", mark: "azure" },
  { name: "MCP", mark: "mcp" },
];

export const PROVIDER_NOTE =
  "Bring your own keys or coding plans. Cybara discovers models dynamically, pools multiple credentials per provider, rotates on rate limits, and enforces spend caps and circuit breakers — swap providers without touching a line of agent logic.";

export const USE_CASES: readonly UseCase[] = [
  {
    title: "Ship code, hands-off",
    description:
      "Point an agent at a repo to plan, edit across files, run the sandbox, and open reviewable diffs — with checkpoints and rollback if a step goes sideways.",
    icon: "tools",
  },
  {
    title: "Run an ops copilot in chat",
    description:
      "Drop the agent into Discord, Slack, or Telegram so your team triggers automations, queries systems, and gets reports where they already work.",
    icon: "orchestration",
  },
  {
    title: "Automate the browser & APIs",
    description:
      "Drive real websites, scrape and fill forms, call APIs, and generate media — each action gated by interactive approval and per-tool allowlists.",
    icon: "refresh",
  },
  {
    title: "Operate on-chain, safely",
    description:
      "Execute across Ethereum, Bitcoin, and Solana from an encrypted local wallet with amount caps, recipient allowlists, and private-address protection.",
    icon: "wallet",
  },
];

export const FEATURES: readonly Feature[] = [
  {
    title: "Multi-agent orchestration",
    description:
      "Fan a single turn out to several proposer agents and synthesize one answer with Mixture of Agents, or route by weighted, round-robin, lowest-cost, and priority strategies.",
    icon: "orchestration",
  },
  {
    title: "Real tool execution",
    description:
      "A large built-in tool library for code, files, browser and API automation, media generation, and a tool-calling code sandbox — all with interactive approval.",
    icon: "tools",
  },
  {
    title: "Self-improving skills",
    description:
      "Agents codify a verified multi-step procedure once, and the loader picks it up for every future session. Memory and skills compound over time.",
    icon: "skills",
  },
  {
    title: "Encrypted wallet control",
    description:
      "On-chain execution across ETH, BTC, and SOL behind an encrypted local wallet with policy caps, allowlists, and private-address SSRF protection.",
    icon: "wallet",
  },
  {
    title: "Broad provider catalog",
    description:
      "Dynamic model discovery across major providers with multi-key credential pools, rate-limit rotation, spend caps, circuit breakers, and coding-plan awareness.",
    icon: "providers",
  },
  {
    title: "Operator in the loop",
    description:
      "Per-session and persistent tool allowlists, filesystem checkpoint and rollback, transform hooks, and localhost auth policy keep control where it belongs.",
    icon: "control",
  },
  {
    title: "Code-aware IDE",
    description:
      "A built-in IDE with semantic workspace indexing — embeddings run locally via Transformers.js — plus LSP diagnostics, git blame, and project-wide search and replace.",
    icon: "code",
  },
  {
    title: "Usage-aware routing",
    description:
      "Coding-plan windows are detected automatically from your subscriptions. The router skips exhausted plans, downweights near-limit providers, and honors spend caps.",
    icon: "gauge",
  },
  {
    title: "MCP in both directions",
    description:
      "Install MCP servers as agent tools from the official registry, Smithery, or npm — or flip it around and expose Cybara's own tools to Claude Desktop and other agents over MCP.",
    icon: "plug",
  },
  {
    title: "Editor integration over ACP",
    description:
      "Drive Cybara agents straight from your editor over the Agent Client Protocol. Run `cybara acp` and connect Zed or any ACP client to code with your own self-hosted runtime.",
    icon: "terminal",
  },
  {
    title: "Live browser preview",
    description:
      "A session-bound embedded browser the agent drives — open pages, click, scroll, extract data, and screenshot — while you watch it work live in the chat panel.",
    icon: "desktop",
  },
  {
    title: "25+ messaging channels",
    description:
      "Run agents on Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Teams, and 20+ more — each gated by pairing, allowlists, and per-channel access policy.",
    icon: "mobile",
  },
  {
    title: "Persistent memory",
    description:
      "Agents recall prior work, decisions, people, and preferences from a searchable memory store, with semantic recall that compounds across every session.",
    icon: "package",
  },
  {
    title: "Skill registry & install",
    description:
      "Browse and install reusable SKILL.md procedures from ClawHub, Skills.sh, and GitHub, or let agents author their own — self-improvement that grows your toolkit.",
    icon: "skills",
  },
  {
    title: "Voice, in and out",
    description:
      "Talk to your agents hands-free with local Kokoro TTS, OS and cloud voices, speech-to-text transcription, and a realtime full-duplex conversation mode.",
    icon: "voice",
  },
  {
    title: "Computer use",
    description:
      "Agents drive the desktop in the background — capture, click, type, scroll, and drag — without taking over your cursor, in a sandboxed flow you approve.",
    icon: "cursor",
  },
  {
    title: "Scheduled automations",
    description:
      "A built-in cron scheduler runs agents and tools on your timetable — recurring reports, monitors, and maintenance jobs that fire even while you're away.",
    icon: "clock",
  },
  {
    title: "Plugins & account connectors",
    description:
      "One hub for skill bundles, MCP services, and encrypted account connectors — Google Workspace, Microsoft 365, Dropbox, and Notion — read-only by default with approval-gated writes.",
    icon: "plug",
  },
  {
    title: "Media generation",
    description:
      "Generate images, video, music, and speech from chat through swappable media providers, with artifacts and a canvas to collect what agents produce.",
    icon: "spark",
  },
  {
    title: "Sandboxed execution",
    description:
      "Shell and git run inside a configurable command sandbox — sandbox-exec on macOS, Podman or Docker on Linux — with network allow/deny and path-safety guards for secrets.",
    icon: "shield",
  },
];

export const CHANNELS: readonly string[] = [
  "Telegram",
  "Discord",
  "Slack",
  "WhatsApp",
  "Signal",
  "iMessage",
  "Matrix",
  "Mattermost",
  "Microsoft Teams",
  "Feishu / Lark",
  "DingTalk",
  "WeCom",
  "Zulip",
  "LINE",
  "Google Chat",
  "IRC",
  "ntfy",
  "Twitch",
  "Nextcloud",
  "Synology",
  "Zalo",
  "Home Assistant",
  "SMS",
  "Email",
  "Web",
  "Webhook",
];

export const PLATFORMS: readonly Platform[] = [
  {
    name: "Web & Tauri",
    detail: "Dashboard, chat, IDE, terminal, tools, and settings in the browser or a signed desktop app.",
    icon: "desktop",
  },
  {
    name: "Native macOS",
    detail: "A SwiftUI shell packaged as a .app bundle over the same Bun sidecar runtime.",
    icon: "apple",
  },
  {
    name: "Mobile companion",
    detail: "A dark Liquid Glass React Native app for iOS and Android that pairs to any gateway.",
    icon: "mobile",
  },
  {
    name: "CLI, ACP & VS Code",
    detail: "A Bun-based CLI and terminal UI, an Agent Client Protocol server for editors like Zed, and a VS Code extension.",
    icon: "terminal",
  },
];

export interface DownloadClient {
  name: string;
  platform: string;
  format: string;
  icon: string;
  href: string;
  command?: string;
  assetPattern?: RegExp;
}

export interface DownloadGroup {
  label: string;
  icon: string;
  clients: readonly DownloadClient[];
}

export const DOWNLOAD_GROUPS: readonly DownloadGroup[] = [
  {
    label: "Desktop",
    icon: "desktop",
    clients: [
      {
        name: "macOS",
        platform: "Apple Silicon",
        format: ".dmg · arm64",
        icon: "apple",
        href: RELEASES_URL,
        assetPattern: /aarch64\.dmg$/i,
      },
      {
        name: "macOS",
        platform: "Intel",
        format: ".dmg · x64",
        icon: "apple",
        href: RELEASES_URL,
        assetPattern: /_x64\.dmg$/i,
      },
      {
        name: "macOS Native",
        platform: "SwiftUI · Apple Silicon",
        format: "CybaraNative.app · arm64",
        icon: "apple",
        href: RELEASES_URL,
        assetPattern: /CybaraNative-v[\d.]+-arm64\.zip$/i,
      },
      {
        name: "Windows",
        platform: "Installer",
        format: ".exe · x64",
        icon: "windows",
        href: RELEASES_URL,
        assetPattern: /x64-setup\.exe$/i,
      },
      {
        name: "Windows",
        platform: "MSI package",
        format: ".msi · x64",
        icon: "windows",
        href: RELEASES_URL,
        assetPattern: /_x64_en-US\.msi$/i,
      },
      {
        name: "Linux",
        platform: "Debian · Ubuntu",
        format: ".deb · x64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /_amd64\.deb$/i,
      },
      {
        name: "Linux",
        platform: "Debian · Ubuntu · ARM64",
        format: ".deb · arm64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /_arm64\.deb$/i,
      },
      {
        name: "Linux",
        platform: "Fedora · RHEL",
        format: ".rpm · x64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /\.x86_64\.rpm$/i,
      },
      {
        name: "Linux",
        platform: "Fedora · RHEL · ARM64",
        format: ".rpm · arm64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /\.aarch64\.rpm$/i,
      },
      {
        name: "Linux",
        platform: "Universal",
        format: ".AppImage · x64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /(?:amd64|x86_64)\.AppImage$/i,
      },
      {
        name: "Linux",
        platform: "Universal · ARM64",
        format: ".AppImage · arm64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /(?:arm64|aarch64)\.AppImage$/i,
      },
    ],
  },
  {
    label: "Mobile",
    icon: "mobile",
    clients: [
      {
        name: "Android",
        platform: "Sideload APK",
        format: "signed .apk",
        icon: "android",
        href: RELEASES_URL,
        assetPattern: /-android\.apk$/i,
      },
      {
        name: "iOS",
        platform: "iPhone · iPad",
        format: "signed .ipa",
        icon: "apple",
        href: RELEASES_URL,
        assetPattern: /-ios\.ipa$/i,
      },
    ],
  },
  {
    label: "Command line",
    icon: "terminal",
    clients: [
      {
        name: "CLI installer",
        platform: "macOS & Linux",
        format: "SHA256-verified · one line",
        icon: "terminal",
        href: RELEASES_URL,
        command: INSTALL_COMMAND,
      },
      {
        name: "CLI installer",
        platform: "Windows · PowerShell",
        format: "SHA256-verified · one line",
        icon: "windows",
        href: RELEASES_URL,
        command: INSTALL_COMMAND_WINDOWS,
      },
      {
        name: "Windows CLI",
        platform: "x64 binary",
        format: "standalone · .exe",
        icon: "terminal",
        href: RELEASES_URL,
        assetPattern: /-windows-x64-cli\.exe$/i,
      },
      {
        name: "Windows CLI",
        platform: "ARM64 binary",
        format: "standalone · .exe",
        icon: "terminal",
        href: RELEASES_URL,
        assetPattern: /-windows-arm64-cli\.exe$/i,
      },
      {
        name: "Linux CLI",
        platform: "x64 binary",
        format: "standalone · x64",
        icon: "terminal",
        href: RELEASES_URL,
        assetPattern: /-linux-x64-cli$/i,
      },
      {
        name: "Linux CLI",
        platform: "Raspberry Pi · ARM64",
        format: "standalone · arm64",
        icon: "terminal",
        href: RELEASES_URL,
        assetPattern: /-linux-arm64-cli$/i,
      },
      {
        name: "All builds",
        platform: "Binaries & checksums",
        format: "every asset · checksums.txt",
        icon: "package",
        href: RELEASES_URL,
      },
    ],
  },
  {
    label: "Package managers",
    icon: "package",
    clients: [
      {
        name: "Homebrew",
        platform: "macOS & Linux · CLI",
        format: "brew · formula",
        icon: "homebrew",
        href: "https://github.com/metaspartan/homebrew-cybara",
        command: "brew install metaspartan/cybara/cybara",
      },
      {
        name: "Homebrew Cask",
        platform: "macOS · desktop app",
        format: "brew · cask",
        icon: "homebrew",
        href: "https://github.com/metaspartan/homebrew-cybara",
        command: "brew install --cask metaspartan/cybara/cybara",
      },
      {
        name: "npm / npx",
        platform: "Node & Bun · any OS",
        format: "npx · bunx · global",
        icon: "npm",
        href: "https://www.npmjs.com/package/cybara",
        command: "npx cybara",
      },
      {
        name: "Nix",
        platform: "flake · Linux & macOS",
        format: "reproducible",
        icon: "nix",
        href: "https://github.com/metaspartan/cybara",
        command: "nix run github:metaspartan/cybara",
      },
      {
        name: "Docker Hub",
        platform: "amd64 & arm64",
        format: "self-hosted gateway",
        icon: "docker",
        href: "https://hub.docker.com/r/carsenk/cybara",
        command: "docker run -d -p 4269:4269 -v cybara:/data carsenk/cybara:latest",
      },
      {
        name: "GitHub Container Registry",
        platform: "GHCR · amd64 & arm64",
        format: "self-hosted gateway",
        icon: "docker",
        href: "https://github.com/metaspartan/cybara/pkgs/container/cybara",
        command: "docker run -d -p 4269:4269 -v cybara:/data ghcr.io/metaspartan/cybara:latest",
      },
    ],
  },
];

export interface Step {
  title: string;
  description: string;
  icon: string;
}

export const STEPS: readonly Step[] = [
  {
    title: "Install",
    description: "Grab the app for your platform or run the one-line installer — no account required.",
    icon: "download",
  },
  {
    title: "Connect",
    description: "Add your model providers, wallets, and messaging channels from the settings UI.",
    icon: "providers",
  },
  {
    title: "Run",
    description: "Chat, automate browsers, orchestrate multi-agent runs, and ship — with approval gates.",
    icon: "spark",
  },
];

export interface MigrationPoint {
  title: string;
  description: string;
}

export const MIGRATION_SOURCES: readonly string[] = ["OpenClaw", "Hermes"];

export const MIGRATION_POINTS: readonly MigrationPoint[] = [
  {
    title: "Dry-run previews",
    description: "See exactly what will import — counts of skills, memory, and secrets — before anything is written.",
  },
  {
    title: "Skills & memory",
    description: "Bring saved skills and memory files across intact so your agents keep what they learned.",
  },
  {
    title: "Conflict handling",
    description: "Resolve collisions your way with skip, overwrite, or rename on a per-item basis.",
  },
  {
    title: "Opt-in secrets",
    description: "API keys stay where they are unless you explicitly choose to migrate them.",
  },
];

export const MIGRATION_COMMANDS: readonly string[] = [
  "cybara migrate sources",
  "cybara migrate --from openclaw",
  "cybara migrate --apply --preset full",
];

export interface Faq {
  question: string;
  answer: string;
}

export const FAQS: readonly Faq[] = [
  {
    question: "What is Cybara?",
    answer:
      "Cybara is a self-hosted AI agent platform. It pairs a Bun-based agent runtime with a web UI, desktop and mobile apps, a CLI, a broad tool layer, messaging-channel adapters, MCP support, and encrypted wallet controls, so agents can code, automate browsers, run messaging workflows, and execute on-chain operations under operator control.",
  },
  {
    question: "Is Cybara free and open source?",
    answer:
      "Yes. Cybara is free and open source under the MIT license, created by Carsen Klock, and runs entirely on infrastructure you control. Use it commercially, fork it, and self-host it with no required account, telemetry, or cloud service.",
  },
  {
    question: "Which platforms does Cybara run on?",
    answer:
      "Cybara ships desktop apps for macOS, Windows, and Linux, a native SwiftUI macOS app, mobile apps for iOS and Android, and command-line binaries for macOS, Windows, and Linux — plus a VS Code extension and an ACP server for editors — all built from the same Bun runtime and published on GitHub Releases.",
  },
  {
    question: "Which messaging channels are supported?",
    answer:
      "Cybara includes adapters for Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Mattermost, Microsoft Teams, Feishu/Lark, DingTalk, WeCom, Zulip, LINE, Google Chat, IRC, ntfy, Twitch, Nextcloud, Synology, Zalo, Home Assistant, SMS, Email, Web, and Webhook — each gated by pairing, allowlists, and per-channel access policy.",
  },
  {
    question: "How do I migrate from another agent to Cybara?",
    answer:
      "Run cybara migrate --from openclaw or cybara migrate --from hermes. Cybara detects local installs, previews the import as a dry run, brings over skills and memory, resolves conflicts by skip, overwrite, or rename, and imports API keys only if you opt in.",
  },
  {
    question: "Do the apps update automatically?",
    answer:
      "Yes. Desktop apps use a signed updater channel backed by GitHub Releases and install updates in place, and the CLI verifies a published SHA256 checksum on every cybara update.",
  },
  {
    question: "How does Cybara keep operators in control?",
    answer:
      "Sensitive tool calls can require interactive approval with per-session or persistent allowlists, the filesystem supports checkpoint and rollback, wallet operations enforce policy caps and allowlists, and the gateway uses a localhost auth policy with rotatable API keys.",
  },
  {
    question: "Which model providers can I use?",
    answer:
      "Cybara connects to 50+ providers — OpenAI, Anthropic, Google Gemini, xAI, Meta, DeepSeek, Qwen, Moonshot/Kimi, Z.ai/GLM, MiniMax, Groq, OpenRouter, Azure OpenAI, AWS Bedrock, Vertex AI, and local runtimes like Ollama, vLLM, LM Studio, and llama.cpp. You bring your own keys; Cybara pools multiple keys per provider, rotates on rate limits, routes by weight or cost, and enforces spend caps.",
  },
  {
    question: "How does Cybara handle my API keys and data?",
    answer:
      "Everything stays on infrastructure you control. Model keys, wallet keys, memory, and conversations live locally, the wallet is encrypted at rest, and there's no required account, telemetry, or cloud relay. Keys are never printed to logs and never leave your machine unless a tool you approve sends them.",
  },
  {
    question: "Can I drive Cybara from my code editor?",
    answer:
      "Yes. Run cybara acp to expose the agent over the Agent Client Protocol (ACP) and connect Zed or any ACP-compatible editor, so you can code with your own self-hosted runtime. The ACP server can be toggled on or off in settings.",
  },
  {
    question: "What are skills and where do they come from?",
    answer:
      "Skills are reusable SKILL.md procedures agents follow for recurring work. Browse and install them from the ClawHub, Skills.sh, and GitHub registries, author your own, or let agents codify a verified procedure automatically — the loader picks it up in every future session.",
  },
  {
    question: "Does Cybara support MCP servers?",
    answer:
      "In both directions. Install Model Context Protocol servers as agent tools from the official MCP registry, Smithery, or npm — or expose Cybara's own tools to Claude Desktop and other MCP clients.",
  },
  {
    question: "Can agents use a real web browser?",
    answer:
      "Yes. Each session gets an embedded browser the agent drives — opening pages, clicking, scrolling, extracting data, and taking screenshots — and you watch it work live in the chat panel. It works cross-platform, including on Windows. Beyond the browser, a computer-use tool can drive the desktop in the background without taking over your cursor.",
  },
  {
    question: "Can I talk to my agents with voice?",
    answer:
      "Yes. Cybara supports hands-free voice conversations with local Kokoro TTS, OS speech, or cloud voices, plus speech-to-text transcription — including a realtime full-duplex mode where you and the agent can speak naturally.",
  },
  {
    question: "Can agents run on a schedule?",
    answer:
      "Yes. A built-in cron scheduler runs agents and tools on a timetable you set — recurring reports, monitors, and maintenance jobs — with results delivered to the UI or any connected messaging channel.",
  },
  {
    question: "What does Cybara cost?",
    answer:
      "Cybara itself is free and MIT-licensed. You only pay for the model provider usage on your own accounts — Cybara adds no markup, subscription, or per-seat fee, and there's no hosted tier to buy.",
  },
];

export interface ControlPoint {
  title: string;
  description: string;
}

export const CONTROL_POINTS: readonly ControlPoint[] = [
  {
    title: "Self-hosted by default",
    description:
      "Your keys, your data, your machine. Cybara runs on a Bun runtime you own, with a localhost auth policy and rotatable API keys.",
  },
  {
    title: "Approve before it acts",
    description:
      "Every sensitive tool call can require interactive approval, with per-session or persistent allowlists and fail-closed validation on every boundary.",
  },
  {
    title: "Verify, checkpoint, roll back",
    description:
      "Filesystem snapshots and rollback, structured plan-execute-verify loops, and a centralized error taxonomy keep long runs recoverable.",
  },
];
import type { TranslationKey } from "../../shared/i18n/catalog";
