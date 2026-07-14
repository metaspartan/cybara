import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PAGE_HEADS, type PageHead } from "../src/pageMeta";
import {
  CHANNELS,
  FAQS,
  FEATURES,
  PLATFORMS,
  PROVIDERS,
  PROVIDER_NOTE,
  STATS,
} from "../src/content";

const DIST = join(import.meta.dir, "..", "dist");

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function featureList(): string {
  return FEATURES.map(
    (feature) => `<li><strong>${esc(feature.title)}.</strong> ${esc(feature.description)}</li>`
  ).join("");
}

function channelList(): string {
  return CHANNELS.map((channel) => `<li>${esc(channel)}</li>`).join("");
}

function providerList(): string {
  return PROVIDERS.map((provider) => `<li>${esc(provider.name)}</li>`).join("");
}

function platformList(): string {
  return PLATFORMS.map(
    (platform) => `<li><strong>${esc(platform.name)}.</strong> ${esc(platform.detail)}</li>`
  ).join("");
}

function faqList(): string {
  return FAQS.map(
    (faq) => `<section><h3>${esc(faq.question)}</h3><p>${esc(faq.answer)}</p></section>`
  ).join("");
}

function statLine(): string {
  return STATS.map((stat) => `${stat.value} ${stat.label}`).join(" · ");
}

const PAGE_NAV = `<nav><ul><li><a href="/">Home</a></li><li><a href="/features">Features</a></li><li><a href="/providers">Model providers</a></li><li><a href="/channels">Messaging channels</a></li><li><a href="/download">Download</a></li><li><a href="/faq">FAQ</a></li></ul></nav>`;

function landingContent(): string {
  return `<main>
<h1>Cybara — Your agents. Your tools. Your runtime.</h1>
<p>${esc(PAGE_HEADS.landing.description)}</p>
<p>${esc(statLine())}</p>
<h2>Features</h2><ul>${featureList()}</ul>
<h2>Model providers</h2><p>${esc(PROVIDER_NOTE)}</p><ul>${providerList()}</ul>
<h2>Messaging channels</h2><ul>${channelList()}</ul>
<h2>Platforms</h2><ul>${platformList()}</ul>
<h2>Frequently asked questions</h2>${faqList()}
${PAGE_NAV}
</main>`;
}

function featuresContent(): string {
  return `<main>
<h1>Cybara features</h1>
<p>${esc(PAGE_HEADS.features.description)}</p>
<ul>${featureList()}</ul>
${PAGE_NAV}
</main>`;
}

function providersContent(): string {
  return `<main>
<h1>Cybara model providers</h1>
<p>${esc(PAGE_HEADS.providers.description)}</p>
<p>${esc(PROVIDER_NOTE)}</p>
<ul>${providerList()}</ul>
${PAGE_NAV}
</main>`;
}

function channelsContent(): string {
  return `<main>
<h1>Cybara messaging channels</h1>
<p>${esc(PAGE_HEADS.channels.description)}</p>
<ul>${channelList()}</ul>
${PAGE_NAV}
</main>`;
}

function downloadContent(): string {
  return `<main>
<h1>Download Cybara</h1>
<p>${esc(PAGE_HEADS.download.description)}</p>
<p>Install with one line: <code>curl -fsSL https://cybara.ai/install.sh | bash</code> on macOS and Linux, or <code>irm https://cybara.ai/install.ps1 | iex</code> in PowerShell on Windows. Also available via npm (<code>npx cybara</code>), Bun (<code>bunx cybara</code>), Homebrew, Nix, and Docker. All builds are published on GitHub Releases: https://github.com/metaspartan/cybara/releases</p>
${PAGE_NAV}
</main>`;
}

function faqContent(): string {
  return `<main>
<h1>Cybara FAQ</h1>
<p>${esc(PAGE_HEADS.faq.description)}</p>
${faqList()}
${PAGE_NAV}
</main>`;
}

interface RoutePage {
  path: string;
  head: PageHead;
  content: string;
}

const ROUTES: RoutePage[] = [
  { path: "index.html", head: PAGE_HEADS.landing, content: landingContent() },
  { path: "download/index.html", head: PAGE_HEADS.download, content: downloadContent() },
  { path: "features/index.html", head: PAGE_HEADS.features, content: featuresContent() },
  { path: "providers/index.html", head: PAGE_HEADS.providers, content: providersContent() },
  { path: "channels/index.html", head: PAGE_HEADS.channels, content: channelsContent() },
  { path: "faq/index.html", head: PAGE_HEADS.faq, content: faqContent() },
];

function replaceTag(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function applyHead(html: string, route: RoutePage): string {
  const title = esc(route.head.title);
  const description = esc(route.head.description);
  let out = html;
  out = replaceTag(out, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  out = replaceTag(
    out,
    /<meta\s+name="description"\s+content="[\s\S]*?"\s*\/>/,
    `<meta name="description" content="${description}" />`
  );
  out = replaceTag(
    out,
    /<link\s+rel="canonical"\s+href="[\s\S]*?"\s*\/>/,
    `<link rel="canonical" href="${route.head.canonical}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+property="og:url"\s+content="[\s\S]*?"\s*\/>/,
    `<meta property="og:url" content="${route.head.canonical}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+property="og:title"\s+content="[\s\S]*?"\s*\/>/,
    `<meta property="og:title" content="${title}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+property="og:description"\s+content="[\s\S]*?"\s*\/>/,
    `<meta property="og:description" content="${description}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+name="twitter:title"\s+content="[\s\S]*?"\s*\/>/,
    `<meta name="twitter:title" content="${title}" />`
  );
  out = replaceTag(
    out,
    /<meta\s+name="twitter:description"\s+content="[\s\S]*?"\s*\/>/,
    `<meta name="twitter:description" content="${description}" />`
  );
  return out;
}

function applyContent(html: string, route: RoutePage): string {
  return html.replace('<div id="root"></div>', `<div id="root">${route.content}</div>`);
}

async function main(): Promise<void> {
  const indexHtml = await Bun.file(join(DIST, "index.html")).text();
  for (const route of ROUTES) {
    const target = join(DIST, route.path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, applyContent(applyHead(indexHtml, route), route));
    console.log(`[site] generated ${route.path}`);
  }
}

await main();
