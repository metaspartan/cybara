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

function normalizedAssetName(asset: GithubDownloadAsset): string {
  return asset.name?.trim().toLowerCase() ?? "";
}

export function isDownloadMetadataAsset(asset: GithubDownloadAsset): boolean {
  const name = normalizedAssetName(asset);
  return (
    !!name &&
    (EXCLUDED_DOWNLOAD_ASSETS.has(name) ||
      EXCLUDED_DOWNLOAD_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
      CHECKSUM_MANIFEST_PATTERN.test(name))
  );
}

export function isCountedDownloadAsset(asset: GithubDownloadAsset): boolean {
  const name = normalizedAssetName(asset);
  return (
    !!name &&
    !isDownloadMetadataAsset(asset) &&
    INSTALLER_ASSET_PATTERNS.some((pattern) => pattern.test(name))
  );
}

function companionMetadataNames(name: string): Set<string> {
  const names = new Set([`${name}.sig`, `${name}.sha256`, `${name}.sha512`, `${name}.md5`]);
  if (name.endsWith(".zip")) names.add(name.replace(/\.zip$/i, ".sha256"));
  if (/_aarch64\.dmg$/i.test(name)) names.add("cybara_aarch64.app.tar.gz.sig");
  if (/_x64\.dmg$/i.test(name)) names.add("cybara_x64.app.tar.gz.sig");
  return names;
}

function releaseChecksumManifestCount(assets: GithubDownloadAsset[]): number {
  return assets.reduce((count, asset) => {
    const name = normalizedAssetName(asset);
    return CHECKSUM_MANIFEST_PATTERN.test(name) ? Math.max(count, assetDownloadCount(asset)) : count;
  }, 0);
}

function installerAutomationBaseline(
  asset: GithubDownloadAsset,
  assets: GithubDownloadAsset[]
): number {
  const companionNames = companionMetadataNames(normalizedAssetName(asset));
  let companionCount = 0;
  let hasCompanion = false;
  for (const candidate of assets) {
    if (!companionNames.has(normalizedAssetName(candidate))) continue;
    hasCompanion = true;
    companionCount = Math.max(companionCount, assetDownloadCount(candidate));
  }
  return hasCompanion ? companionCount : releaseChecksumManifestCount(assets);
}

export function sumReleaseDownloads(releases: GithubDownloadRelease[]): number {
  return releases.reduce(
    (releaseTotal, release) => {
      const assets = release.assets ?? [];
      return (
        releaseTotal +
        assets.reduce(
          (assetTotal, asset) =>
            assetTotal +
            (isCountedDownloadAsset(asset)
              ? Math.max(0, assetDownloadCount(asset) - installerAutomationBaseline(asset, assets))
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
