export interface GithubDownloadAsset {
  name?: string;
  download_count?: number;
}

export interface GithubDownloadRelease {
  assets?: GithubDownloadAsset[];
}

const EXCLUDED_DOWNLOAD_ASSETS = new Set(["latest.json"]);

export function isCountedDownloadAsset(asset: GithubDownloadAsset): boolean {
  const name = asset.name?.trim().toLowerCase();
  return !!name && !EXCLUDED_DOWNLOAD_ASSETS.has(name);
}

export function sumReleaseDownloads(releases: GithubDownloadRelease[]): number {
  return releases.reduce(
    (releaseTotal, release) =>
      releaseTotal +
      (release.assets ?? []).reduce(
        (assetTotal, asset) =>
          assetTotal +
          (isCountedDownloadAsset(asset) && Number.isFinite(asset.download_count)
            ? Math.max(0, asset.download_count ?? 0)
            : 0),
        0
      ),
    0
  );
}

export function formatDownloadTotal(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 10_000) return `${Math.round(total / 1000)}k`;
  if (total >= 1_000) return `${(total / 1000).toFixed(1)}k`;
  return `${total}`;
}
