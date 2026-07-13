import { serve, file } from "bun";
import { join, resolve, sep, extname } from "path";
import {
  formatDownloadTotal,
  sumReleaseDownloads,
  type GithubDownloadRelease,
} from "./downloadStats";

const root = resolve(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 3399);
const indexPath = join(root, "index.html");
const releasesApi = "https://api.github.com/repos/metaspartan/cybara/releases";
const downloadCacheTtlMs = 30 * 60 * 1000;
let downloadCache: { total: number; at: number } | null = null;

async function fetchDownloadTotal(): Promise<number> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const fetchPage = async (
    page: number
  ): Promise<{ releases: GithubDownloadRelease[]; link: string | null }> => {
    const response = await fetch(`${releasesApi}?per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const batch = (await response.json()) as GithubDownloadRelease[];
    if (!Array.isArray(batch)) throw new Error("GitHub API returned an invalid release list");
    return { releases: batch, link: response.headers.get("link") };
  };
  const first = await fetchPage(1);
  const lastPageMatch = first.link?.match(/[?&]page=(\d+)>; rel="last"/);
  const lastPage = Math.min(50, Math.max(1, Number(lastPageMatch?.[1] ?? 1)));
  const remaining = await Promise.all(
    Array.from({ length: lastPage - 1 }, (_, index) => fetchPage(index + 2))
  );
  const releases = [...first.releases];
  for (const page of remaining) {
    releases.push(...page.releases);
  }
  return sumReleaseDownloads(releases);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".txt", ".xml", ".webmanifest"]);

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
};

function cacheControl(pathname: string): string {
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (pathname === "/index.html" || pathname === "/") return "no-cache";
  return "public, max-age=3600";
}

async function encoded(
  target: string,
  accept: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  if (accept.includes("br")) {
    const br = file(`${target}.br`);
    if (await br.exists()) return new Response(br, { headers: { ...headers, "content-encoding": "br" } });
  }
  if (accept.includes("gzip")) {
    const gz = file(`${target}.gz`);
    if (await gz.exists()) return new Response(gz, { headers: { ...headers, "content-encoding": "gzip" } });
  }
  return null;
}

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/downloads" || url.pathname === "/downloads-badge.json") {
    const now = Date.now();
    if (!downloadCache || now - downloadCache.at > downloadCacheTtlMs) {
      try {
        downloadCache = { total: await fetchDownloadTotal(), at: now };
      } catch {
        if (!downloadCache) return new Response("Download count unavailable", { status: 502 });
      }
    }
    const body =
      url.pathname === "/downloads-badge.json"
        ? {
            schemaVersion: 1,
            label: "installer downloads",
            message: formatDownloadTotal(downloadCache.total),
            color: "blue",
          }
        : {
            total: downloadCache.total,
            includedAssets: [
              "*.dmg",
              "*.msi",
              "*-setup.exe",
              "*.deb",
              "*.rpm",
              "*.AppImage",
              "*Native-Desktop*.zip",
              "*native-macos*.zip",
              "*.apk",
            ],
            estimation: "installer-assets-minus-release-automation-baseline",
            updatedAt: new Date(downloadCache.at).toISOString(),
          };
    return Response.json(body, {
      headers: { ...SECURITY_HEADERS, "cache-control": "public, max-age=1800" },
    });
  }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = resolve(root, `.${requested}`);

  if (target !== root && !target.startsWith(root + sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  const accept = request.headers.get("accept-encoding") ?? "";
  const ext = extname(target);
  const base = file(target);

  if (await base.exists()) {
    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      "content-type": MIME[ext] ?? base.type ?? "application/octet-stream",
      "cache-control": cacheControl(requested),
    };
    if (COMPRESSIBLE.has(ext)) {
      headers["vary"] = "Accept-Encoding";
      const pre = await encoded(target, accept, headers);
      if (pre) return pre;
    }
    return new Response(base, { headers });
  }

  const htmlHeaders: Record<string, string> = {
    ...SECURITY_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    "vary": "Accept-Encoding",
  };
  const preIndex = await encoded(indexPath, accept, htmlHeaders);
  if (preIndex) return preIndex;
  return new Response(file(indexPath), { headers: htmlHeaders });
}

serve({ port, hostname: "0.0.0.0", fetch: respond });

console.log(`Cybara site serving on http://0.0.0.0:${port}`);
