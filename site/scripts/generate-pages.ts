import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const DIST = join(import.meta.dir, "..", "dist");

interface RoutePage {
  path: string;
  title: string;
  description: string;
  canonical: string;
}

const ROUTES: RoutePage[] = [
  {
    path: "download/index.html",
    title: "Download Cybara — macOS, Windows, Linux, iOS, Android & CLI",
    description:
      "Download Cybara, the self-hosted open-source AI agent platform. Signed desktop apps for macOS, Windows, and Linux, native mobile apps for iOS and Android, and a CLI — every asset with a published SHA256 checksum.",
    canonical: "https://cybara.ai/download",
  },
  {
    path: "features/index.html",
    title: "Features — Cybara AI Agent Platform",
    description:
      "Explore Cybara's features: multi-agent orchestration, a 90+ tool library, browser automation, self-improving skills, persistent memory, MCP support, and operator controls — all self-hosted and open source.",
    canonical: "https://cybara.ai/features",
  },
  {
    path: "providers/index.html",
    title: "Model Providers — 60+ LLM Providers | Cybara",
    description:
      "Cybara connects to 60+ model providers — OpenAI, Anthropic, Google Gemini, xAI, Meta Llama, and more — with credential pooling, weighted routing, and per-provider spend caps. Bring your own keys, self-hosted.",
    canonical: "https://cybara.ai/providers",
  },
  {
    path: "channels/index.html",
    title: "Messaging Channels — 25+ Integrations | Cybara",
    description:
      "Run Cybara agents across 25+ messaging channels — Telegram, Discord, Slack, WhatsApp, Signal, iMessage, Matrix, Teams, and more — each gated by pairing, allowlists, and per-channel access policy.",
    canonical: "https://cybara.ai/channels",
  },
  {
    path: "faq/index.html",
    title: "FAQ — Cybara Self-Hosted AI Agent Platform",
    description:
      "Answers about Cybara: what it is, which platforms, providers, and 25+ messaging channels it supports, how it handles your API keys and data, ACP editor integration, MCP, skills, pricing, and operator controls.",
    canonical: "https://cybara.ai/faq",
  },
];

function replaceTag(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function applyHead(html: string, route: RoutePage): string {
  let out = html;
  out = replaceTag(out, /<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`);
  out = replaceTag(
    out,
    /<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/,
    `<meta name="description" content="${route.description}" />`
  );
  out = replaceTag(
    out,
    /<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/>/,
    `<link rel="canonical" href="${route.canonical}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/>/,
    `<meta property="og:url" content="${route.canonical}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/>/,
    `<meta property="og:title" content="${route.title}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/>/,
    `<meta property="og:description" content="${route.description}" />`
  );
  return out;
}

async function main(): Promise<void> {
  const indexHtml = await Bun.file(join(DIST, "index.html")).text();
  for (const route of ROUTES) {
    const target = join(DIST, route.path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, applyHead(indexHtml, route));
    console.log(`[site] generated ${route.path}`);
  }
}

await main();
