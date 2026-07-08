import { useEffect, useState } from "react";
import { RELEASES_URL } from "../content";

const LATEST_RELEASE_API = "https://api.github.com/repos/metaspartan/cybara/releases/latest";

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface LatestRelease {
  version: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

interface GithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
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
          .filter((asset): asset is { name: string; browser_download_url: string } =>
            typeof asset.name === "string" && typeof asset.browser_download_url === "string"
          )
          .map((asset) => ({ name: asset.name, url: asset.browser_download_url }));
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
