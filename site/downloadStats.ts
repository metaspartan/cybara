export interface GithubDownloadAsset {
  name?: string;
  download_count?: number;
}

export interface GithubDownloadRelease {
  assets?: GithubDownloadAsset[];
}

const EXCLUDED_DOWNLOAD_ASSETS = new Set(["latest.json"]);
const EXCLUDED_DOWNLOAD_SUFFIXES = [".sig", ".sha256", ".sha512", ".md5"];
const CHECKSUM_MANIFEST_PATTERN = /^checksums?\.(?:txt|json)$/i;
const INSTALLER_ASSET_PATTERNS = [
  /\.dmg$/i,
  /\.msi$/i,
  /-setup\.exe$/i,
  /\.deb$/i,
  /\.rpm$/i,
  /\.appimage$/i,
  /(?:swift-native-desktop|native-macos|cybaranative).*\.zip$/i,
  /\.apk$/i,
];

function assetDownloadCount(asset: GithubDownloadAsset): number {
  return Number.isFinite(asset.download_count) ? Math.max(0, asset.download_count ?? 0) : 0;
}

export function isDownloadMetadataAsset(asset: GithubDownloadAsset): boolean {
  const name = asset.name?.trim().toLowerCase();
  return (
    !!name &&
    (EXCLUDED_DOWNLOAD_ASSETS.has(name) ||
      EXCLUDED_DOWNLOAD_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
      CHECKSUM_MANIFEST_PATTERN.test(name))
  );
}

export function isCountedDownloadAsset(asset: GithubDownloadAsset): boolean {
  const name = asset.name?.trim().toLowerCase();
  return (
    !!name &&
    !isDownloadMetadataAsset(asset) &&
    INSTALLER_ASSET_PATTERNS.some((pattern) => pattern.test(name))
  );
}

export function releaseAutomationBaseline(release: GithubDownloadRelease): number {
  return (release.assets ?? []).reduce((baseline, asset) => {
    const name = asset.name?.trim().toLowerCase();
    if (!name || name === "latest.json" || !isDownloadMetadataAsset(asset)) return baseline;
    return Math.max(baseline, assetDownloadCount(asset));
  }, 0);
}

export function sumReleaseDownloads(releases: GithubDownloadRelease[]): number {
  return releases.reduce(
    (releaseTotal, release) => {
      const baseline = releaseAutomationBaseline(release);
      return (
        releaseTotal +
        (release.assets ?? []).reduce(
          (assetTotal, asset) =>
            assetTotal +
            (isCountedDownloadAsset(asset)
              ? Math.max(0, assetDownloadCount(asset) - baseline)
              : 0),
          0
        )
      );
    },
    0
  );
}

export function formatDownloadTotal(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 10_000) return `${Math.round(total / 1000)}k`;
  if (total >= 1_000) return `${(total / 1000).toFixed(1)}k`;
  return `${total}`;
}
