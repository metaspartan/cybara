export interface PageHead {
  title: string;
  description: string;
  canonical: string;
}

export const PAGE_HEADS = {
  landing: {
    title: "Cybara — Self-Hosted Open-Source AI Agent Platform",
    description:
      "Your agents. Your tools. Your runtime. Cybara is a self-hosted, open-source AI agent platform extended by skills, plugins, MCP, ACP, and LSP — agents that code, automate browsers and desktops, message across Telegram, Discord, Slack, and more, and execute on-chain operations, with full operator control.",
    canonical: "https://cybara.ai/",
  },
  features: {
    title: "Features — Cybara AI Agent Platform",
    description:
      "Explore Cybara's features: multi-agent orchestration, real tool execution, browser and computer automation, voice conversations, self-improving skills, persistent memory, MCP support, and operator controls — self-hosted and open source.",
    canonical: "https://cybara.ai/features",
  },
  providers: {
    title: "AI Model Providers — OpenAI, Anthropic, Gemini & More | Cybara",
    description:
      "Cybara connects to 50+ model providers — OpenAI, Anthropic, Google Gemini, xAI, Meta Llama, DeepSeek, and more — with credential pooling, weighted routing, and per-provider spend caps. Bring your own keys, self-hosted.",
    canonical: "https://cybara.ai/providers",
  },
  channels: {
    title: "Messaging Channels — Telegram, Discord, Slack & More | Cybara",
    description:
      "Run Cybara agents on Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Microsoft Teams, and more — every channel gated by pairing, allowlists, and per-channel access policy.",
    canonical: "https://cybara.ai/channels",
  },
  download: {
    title: "Download Cybara — macOS, Windows, Linux, iOS, Android & CLI",
    description:
      "Download Cybara, the self-hosted open-source AI agent platform. Signed desktop apps for macOS, Windows, and Linux, native mobile apps for iOS and Android, and a CLI — every asset with a published SHA256 checksum.",
    canonical: "https://cybara.ai/download",
  },
  privacy: {
    title: "Privacy Policy — Cybara Mobile App",
    description:
      "Privacy policy for the Cybara mobile app. Cybara is self-hosted: the app connects to a gateway you run, collects no personal data, and ships with no analytics, advertising, or tracking SDKs.",
    canonical: "https://cybara.ai/privacy",
  },
  faq: {
    title: "FAQ — Cybara Self-Hosted AI Agent Platform",
    description:
      "Answers about Cybara: what it is, the platforms it runs on, supported model providers and messaging channels, skills, plugins, MCP, ACP, LSP, hooks, multi-agent orchestration, how it handles your API keys and data, pricing, and operator controls.",
    canonical: "https://cybara.ai/faq",
  },
} as const satisfies Record<string, PageHead>;
