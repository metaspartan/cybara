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
