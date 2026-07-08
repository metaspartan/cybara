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

export interface NavLink {
  label: string;
  href: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { label: "Features", href: "#features" },
  { label: "Channels", href: "#channels" },
  { label: "Download", href: "#download" },
  { label: "Migrate", href: "#migrate" },
  { label: "Control", href: "#control" },
];

export const GITHUB_URL = "https://github.com/metaspartan/cybara";
export const RELEASES_URL = "https://github.com/metaspartan/cybara/releases/latest";
export const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/metaspartan/cybara/main/install.sh | bash";

export const STATS: readonly Stat[] = [
  { value: "30+", label: "messaging channels" },
  { value: "3", label: "chains: ETH · BTC · SOL" },
  { value: "1", label: "self-hosted runtime" },
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
    name: "CLI & ACP",
    detail: "A Bun-based CLI plus an Agent Client Protocol server so editors can drive an agent.",
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
        name: "Linux",
        platform: "Debian · Ubuntu",
        format: ".deb · x64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /_amd64\.deb$/i,
      },
      {
        name: "Linux",
        platform: "Fedora · RHEL",
        format: ".rpm · x64",
        icon: "linux",
        href: RELEASES_URL,
        assetPattern: /\.rpm$/i,
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
        name: "All builds",
        platform: "Binaries & checksums",
        format: "every asset · checksums.txt",
        icon: "package",
        href: RELEASES_URL,
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
      "Yes. Cybara is open source under the MIT license and runs entirely on infrastructure you control. There is no required account or cloud service.",
  },
  {
    question: "Which platforms does Cybara run on?",
    answer:
      "Cybara ships desktop apps for macOS, Windows, and Linux, a native SwiftUI macOS app, mobile apps for iOS and Android, and a command-line binary for macOS and Linux — all built from the same Bun runtime and published on GitHub Releases.",
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
