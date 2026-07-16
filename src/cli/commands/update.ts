import { createHash } from "crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { getAppVersion, getReleaseRepository } from "../../core/build-info";
import {
  buildGitHubReleaseApiUrl,
  buildReleaseChecksumUrl,
  compareVersions,
  resolveReleaseBinaryFilename,
  resolveSelfUpdateDestination,
} from "../../core/versioning";

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

type GitHubReleaseNamedAsset = GitHubReleaseAsset & { name: string };

interface GitHubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  assets?: GitHubReleaseAsset[];
}

export interface UpdateOptions {
  version?: string;
  checkOnly?: boolean;
  force?: boolean;
}

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number | null;
}

export type UpdateVersionStatus = "unknown" | "available" | "current" | "ahead";

interface ReleaseDownload {
  release: GitHubReleaseResponse;
  assetName: string;
  assetSize: number | null;
  downloadUrl: string;
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const precision = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatDownloadProgress(progress: DownloadProgress): string {
  const downloaded = formatByteSize(progress.downloadedBytes);
  if (!progress.totalBytes || progress.totalBytes <= 0) return `${downloaded} downloaded`;
  const percent = Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100);
  return `${percent.toFixed(1)}% · ${downloaded} / ${formatByteSize(progress.totalBytes)}`;
}

export function resolveUpdateVersionStatus(
  currentVersion: string,
  latestVersion: string
): UpdateVersionStatus {
  if (!latestVersion.trim()) return "unknown";
  const comparison = compareVersions(currentVersion, latestVersion);
  if (comparison < 0) return "available";
  if (comparison > 0) return "ahead";
  return "current";
}

function createDownloadProgressReporter(): (
  progress: DownloadProgress,
  complete?: boolean
) => void {
  let lastRenderedAt = 0;
  let lastRenderedLength = 0;
  let lastBucket = -1;
  let lastRenderedText = "";
  return (progress, complete = false) => {
    const now = Date.now();
    const bucket = progress.totalBytes
      ? Math.floor((progress.downloadedBytes / progress.totalBytes) * 10)
      : Math.floor(progress.downloadedBytes / (5 * 1024 * 1024));
    if (!complete && bucket === lastBucket && now - lastRenderedAt < 250) return;
    lastBucket = bucket;
    lastRenderedAt = now;
    const text = `Downloading: ${formatDownloadProgress(progress)}`;
    if (process.stdout.isTTY) {
      const padding = " ".repeat(Math.max(0, lastRenderedLength - text.length));
      process.stdout.write(`\r${text}${padding}`);
      lastRenderedLength = text.length;
      lastRenderedText = text;
      if (complete) process.stdout.write("\n");
      return;
    }
    if (complete && text === lastRenderedText) return;
    console.log(text);
    lastRenderedText = text;
  };
}

export async function downloadResponseToFile(
  response: Response,
  destinationPath: string,
  totalBytes: number | null,
  onProgress: (progress: DownloadProgress, complete?: boolean) => void
): Promise<number> {
  if (!response.body) throw new Error("The release download returned an empty response body.");
  const reader = response.body.getReader();
  const writer = Bun.file(destinationPath).writer();
  let downloadedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      writer.write(chunk.value);
      downloadedBytes += chunk.value.byteLength;
      onProgress({ downloadedBytes, totalBytes });
    }
    await writer.end();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await Promise.resolve(writer.end()).catch(() => undefined);
    throw error;
  }
  if (totalBytes !== null && downloadedBytes !== totalBytes) {
    throw new Error(
      `The release download size did not match: expected ${formatByteSize(totalBytes)}, received ${formatByteSize(downloadedBytes)}.`
    );
  }
  onProgress({ downloadedBytes, totalBytes: totalBytes ?? downloadedBytes }, true);
  return downloadedBytes;
}

async function fetchGitHubRelease(
  repository: string,
  versionArg?: string
): Promise<ReleaseDownload> {
  const releaseApiUrl = buildGitHubReleaseApiUrl(repository, versionArg);
  const expectedAssetName = resolveReleaseBinaryFilename(process.platform, process.arch);
  if (!expectedAssetName) {
    throw new Error(`No release asset mapping exists for ${process.platform}/${process.arch}.`);
  }
  const releaseResponse = await fetch(releaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cybara-cli",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!releaseResponse.ok) {
    throw new Error(`Failed to fetch release metadata (${releaseResponse.status}).`);
  }
  const release = (await releaseResponse.json()) as GitHubReleaseResponse;
  const hasExe = expectedAssetName.endsWith(".exe");
  const legacyBase = hasExe ? expectedAssetName.slice(0, -4) : expectedAssetName;
  const suffix = `${legacyBase.replace(/^cybara/, "")}-cli`;
  const asset = (release.assets || []).find((candidate): candidate is GitHubReleaseNamedAsset => {
    const candidateName = candidate.name;
    if (!candidateName || candidateName.endsWith(".sha256")) return false;
    const base = candidateName.endsWith(".exe") ? candidateName.slice(0, -4) : candidateName;
    return base.endsWith(suffix);
  });
  if (!asset?.browser_download_url) {
    throw new Error(
      `Release ${release.tag_name || "latest"} does not contain a CLI asset (*${suffix}).`
    );
  }
  return {
    release,
    assetName: asset.name,
    assetSize: typeof asset.size === "number" && asset.size > 0 ? asset.size : null,
    downloadUrl: asset.browser_download_url,
  };
}

function computeFileSha256(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

async function fetchExpectedChecksum(
  repository: string,
  assetName: string,
  tagName?: string
): Promise<string | null> {
  const checksumUrl = buildReleaseChecksumUrl(repository, assetName, tagName);
  try {
    const response = await fetch(checksumUrl, {
      headers: { "User-Agent": "cybara-cli" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const firstToken = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase();
    return firstToken && /^[0-9a-f]{64}$/.test(firstToken) ? firstToken : null;
  } catch {
    return null;
  }
}

export async function rawUpdate(options: UpdateOptions = {}): Promise<void> {
  const { version: versionArg, checkOnly = false, force = false } = options;
  const repository = getReleaseRepository();
  let releaseDownload: ReleaseDownload;
  try {
    releaseDownload = await fetchGitHubRelease(repository, versionArg);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Failed to resolve the release download."
    );
    process.exit(1);
  }
  const { release, assetName, assetSize, downloadUrl } = releaseDownload;
  const currentVersion = getAppVersion();
  const latestTag = release.tag_name?.trim() || "";
  const latestVersion = latestTag.replace(/^v/i, "");
  const versionStatus = resolveUpdateVersionStatus(currentVersion, latestVersion);
  const updateAvailable = versionStatus === "available";
  if (checkOnly) {
    if (!latestVersion) {
      console.log("Could not determine the latest published version.");
      process.exit(1);
    }
    if (updateAvailable) {
      console.log(`Update available: ${currentVersion} -> ${latestVersion}`);
      console.log(release.html_url || `https://github.com/${repository}/releases/latest`);
      process.exit(1);
    }
    if (versionStatus === "ahead") {
      console.log(
        `Current build ${currentVersion} is newer than the latest published release (${latestVersion}).`
      );
    } else {
      console.log(`Already on the latest release (${currentVersion}).`);
    }
    process.exit(0);
  }
  if (latestVersion && !updateAvailable && !force) {
    if (versionStatus === "ahead") {
      console.log(
        `Current build ${currentVersion} is newer than the latest published release (${latestVersion}).`
      );
    } else {
      console.log(`Already on the latest release (${currentVersion}). Use --force to reinstall.`);
    }
    return;
  }
  const destinationPath = resolveSelfUpdateDestination(process.execPath, process.platform);
  const destinationDir = dirname(destinationPath);
  mkdirSync(destinationDir, { recursive: true });
  const extension = process.platform === "win32" ? ".exe" : "";
  const tempPath = join(destinationDir, `.cybara-update-${Date.now()}${extension}`);
  const sizeLabel = assetSize ? ` (${formatByteSize(assetSize)})` : "";
  console.log(`Downloading ${release.tag_name || "latest"} from ${repository}${sizeLabel}...`);
  const downloadResponse = await fetch(downloadUrl, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "cybara-cli",
    },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!downloadResponse.ok) {
    console.error(`Failed to download release asset (${downloadResponse.status}).`);
    process.exit(1);
  }
  const contentLength = Number(downloadResponse.headers.get("content-length"));
  const totalBytes =
    assetSize ?? (Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null);
  try {
    await downloadResponseToFile(
      downloadResponse,
      tempPath,
      totalBytes,
      createDownloadProgressReporter()
    );
  } catch (error) {
    rmSync(tempPath, { force: true });
    if (process.stdout.isTTY) process.stdout.write("\n");
    console.error(error instanceof Error ? error.message : "The release download failed.");
    process.exit(1);
  }
  const expectedChecksum = await fetchExpectedChecksum(repository, assetName, release.tag_name);
  if (expectedChecksum) {
    const actualChecksum = computeFileSha256(tempPath);
    if (actualChecksum !== expectedChecksum) {
      rmSync(tempPath, { force: true });
      console.error("Checksum verification FAILED: the downloaded asset is corrupted or tampered.");
      console.error(`Expected: ${expectedChecksum}`);
      console.error(`Actual:   ${actualChecksum}`);
      console.error("Aborting update. Re-run later or download manually from GitHub Releases.");
      process.exit(1);
    }
    console.log("Checksum verified.");
  } else if (!force) {
    rmSync(tempPath, { force: true });
    console.error("No SHA256 checksum sidecar was found for this release asset.");
    console.error(
      "For your safety, the update was aborted. If you understand the risk, re-run with --force."
    );
    process.exit(1);
  } else {
    console.warn("Warning: no checksum sidecar found; installing unverified (--force).");
  }
  if (process.platform !== "win32") chmodSync(tempPath, 0o755);
  if (process.platform === "win32" && destinationPath === process.execPath) {
    const fallbackPath = join(tmpdir(), `cybara-${release.tag_name || "latest"}${extension}`);
    copyFileSync(tempPath, fallbackPath);
    rmSync(tempPath, { force: true });
    console.log("Windows cannot replace the running executable in place.");
    console.log(`Downloaded the update to: ${fallbackPath}`);
    console.log(`Replace ${process.execPath} with that file after exiting Cybara.`);
    return;
  }
  if (process.platform === "win32") {
    copyFileSync(tempPath, destinationPath);
    rmSync(tempPath, { force: true });
  } else {
    renameSync(tempPath, destinationPath);
  }
  console.log(`Updated Cybara to ${release.tag_name || "latest"}.`);
  console.log(`Binary path: ${destinationPath}`);
  if (destinationPath !== process.execPath) {
    console.log("If this binary is not already on your PATH, add it before the next run.");
  }
}
