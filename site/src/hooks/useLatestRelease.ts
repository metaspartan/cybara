import { useEffect, useState } from "react";
import { RELEASES_URL } from "../content";
import {
  formatDownloadTotal,
  sumReleaseDownloads,
  type GithubDownloadRelease,
} from "../../downloadStats";

const LATEST_RELEASE_API = "https://api.github.com/repos/metaspartan/cybara/releases/latest";

export interface ReleaseAsset {
  name: string;
  url: string;
  size?: number;
  sha256?: string;
}

export interface LatestRelease {
  version: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

interface GithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
    digest?: string | null;
  }>;
}

function parseSha256Digest(digest?: string | null): string | undefined {
  if (typeof digest !== "string") return undefined;
  const match = digest.match(/^sha256:([0-9a-f]{64})$/i);
  return match ? match[1].toLowerCase() : undefined;
}

export interface LatestReleaseState {
  data: LatestRelease | null;
  loading: boolean;
}

export function useLatestRelease(): LatestReleaseState {
  const [data, setData] = useState<LatestRelease | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
        return response.json() as Promise<GithubReleaseResponse>;
      })
      .then((json) => {
        if (!active) return;
        const assets: ReleaseAsset[] = (json.assets ?? [])
          .filter(
            (
              asset
            ): asset is {
              name: string;
              browser_download_url: string;
              size?: number;
              digest?: string | null;
            } =>
              typeof asset.name === "string" && typeof asset.browser_download_url === "string"
          )
          .map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: typeof asset.size === "number" ? asset.size : undefined,
            sha256: parseSha256Digest(asset.digest),
          }));
        setData({
          version: json.tag_name ?? "",
          htmlUrl: json.html_url ?? RELEASES_URL,
          assets,
        });
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return { data, loading };
}

export function resolveAssetUrl(
  release: LatestRelease | null,
  pattern: RegExp | undefined,
  fallback: string
): string {
  if (!release || !pattern) return fallback;
  const match = release.assets.find((asset) => pattern.test(asset.name));
  return match ? match.url : fallback;
}

export function resolveAsset(
  release: LatestRelease | null,
  pattern: RegExp | undefined
): ReleaseAsset | null {
  if (!release || !pattern) return null;
  return release.assets.find((asset) => pattern.test(asset.name)) ?? null;
}

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== "number" || bytes <= 0) return "";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function shortSha(sha256?: string): string {
  if (!sha256) return "";
  return sha256.length > 12 ? `${sha256.slice(0, 12)}…` : sha256;
}

const DOWNLOAD_TOTAL_API = "/api/downloads";
const ALL_RELEASES_API = "https://api.github.com/repos/metaspartan/cybara/releases?per_page=100";
const DOWNLOAD_TOTAL_CACHE_KEY = "cybara.site.downloadTotal.v2";
const DOWNLOAD_TOTAL_CACHE_TTL_MS = 30 * 60 * 1000;

interface DownloadTotalResponse {
  total?: number;
}

async function fetchDownloadTotal(signal: AbortSignal): Promise<number> {
  try {
    const response = await fetch(DOWNLOAD_TOTAL_API, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`Download API returned ${response.status}`);
    const result = (await response.json()) as DownloadTotalResponse;
    if (typeof result.total === "number") return result.total;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  const response = await fetch(ALL_RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const releases = (await response.json()) as GithubDownloadRelease[];
  return sumReleaseDownloads(Array.isArray(releases) ? releases : []);
}

function readCachedDownloadTotal(): number | null {
  try {
    const raw = sessionStorage.getItem(DOWNLOAD_TOTAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { total: number; at: number };
    if (Date.now() - parsed.at > DOWNLOAD_TOTAL_CACHE_TTL_MS) return null;
    return typeof parsed.total === "number" ? parsed.total : null;
  } catch {
    return null;
  }
}

export function useDownloadTotal(): number | null {
  const [total, setTotal] = useState<number | null>(() => readCachedDownloadTotal());

  useEffect(() => {
    if (total !== null) return;
    let active = true;
    const controller = new AbortController();

    fetchDownloadTotal(controller.signal)
      .then((sum) => {
        if (!active) return;
        setTotal(sum);
        try {
          sessionStorage.setItem(
            DOWNLOAD_TOTAL_CACHE_KEY,
            JSON.stringify({ total: sum, at: Date.now() })
          );
        } catch {
          void 0;
        }
      })
      .catch(() => {
        if (active) setTotal(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [total]);

  return total;
}

export { formatDownloadTotal };
