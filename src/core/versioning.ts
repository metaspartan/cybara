import { homedir } from "os";
import { basename, join } from "path";

export const DEFAULT_RELEASE_REPOSITORY = "metaspartan/cybara";

export function normalizeReleaseTag(versionOrTag: string): string {
  return versionOrTag.trim().replace(/^v/i, "");
}

export function computeReleaseVersion(baseVersion: string, commitCount: number): string {
  const match = baseVersion.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Unsupported base version: ${baseVersion}`);
  }
  if (!Number.isFinite(commitCount) || commitCount < 0) {
    throw new Error(`Invalid commit count: ${commitCount}`);
  }

  const [, major, minor] = match;
  return `${major}.${minor}.${Math.floor(commitCount)}`;
}

export function replaceJsonVersion(jsonText: string, version: string): string {
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  parsed.version = version;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function replaceCargoTomlVersion(tomlText: string, version: string): string {
  if (!/^version\s*=\s*".*"$/m.test(tomlText)) {
    throw new Error("Could not find Cargo.toml version entry");
  }
  return tomlText.replace(/^version\s*=\s*".*"$/m, `version = "${version}"`);
}

export function resolveReleaseAssetBasename(
  platformValue: string,
  archValue: string
): string | null {
  const platform = platformValue.toLowerCase();
  const arch = archValue.toLowerCase();

  if (platform === "darwin") {
    if (arch === "arm64" || arch === "aarch64") return "cybara-darwin-arm64";
    if (arch === "x64" || arch === "x86_64") return "cybara-darwin-x64";
    return null;
  }

  if (platform === "linux") {
    if (arch === "arm64" || arch === "aarch64") return "cybara-linux-arm64";
    if (arch === "x64" || arch === "x86_64") return "cybara-linux-x64";
    return null;
  }

  if (platform === "win32" || platform === "windows") {
    // Windows ARM64 not supported — Bun doesn't ship a pre-built aarch64
    // Windows executable. Falls through to null.
    if (arch === "x64" || arch === "x86_64") return "cybara-windows-x64";
    return null;
  }

  return null;
}

export function resolveReleaseBinaryFilename(
  platformValue: string,
  archValue: string
): string | null {
  const base = resolveReleaseAssetBasename(platformValue, archValue);
  if (!base) return null;
  const platform = platformValue.toLowerCase();
  return platform === "win32" || platform === "windows" ? `${base}.exe` : base;
}

export function resolveDefaultInstallPath(platformValue: string, homeDir = homedir()): string {
  const platform = platformValue.toLowerCase();
  if (platform === "win32" || platform === "windows") {
    return join(homeDir, "AppData", "Local", "Programs", "Cybara", "cybara.exe");
  }
  return join(homeDir, ".local", "bin", "cybara");
}

export function resolveSelfUpdateDestination(
  execPath: string,
  platformValue: string,
  homeDir = homedir()
): string {
  const executableName = basename(execPath).toLowerCase();
  if (executableName === "cybara" || executableName === "cybara.exe") {
    return execPath;
  }
  return resolveDefaultInstallPath(platformValue, homeDir);
}

export function buildGitHubReleaseApiUrl(repository: string, version?: string): string {
  const normalizedRepository = repository.trim() || DEFAULT_RELEASE_REPOSITORY;
  if (version && normalizeReleaseTag(version) !== "latest") {
    return `https://api.github.com/repos/${normalizedRepository}/releases/tags/v${normalizeReleaseTag(version)}`;
  }
  return `https://api.github.com/repos/${normalizedRepository}/releases/latest`;
}

export function buildGitHubUpdaterEndpoint(repository: string): string {
  const normalizedRepository = repository.trim() || DEFAULT_RELEASE_REPOSITORY;
  return `https://github.com/${normalizedRepository}/releases/latest/download/latest.json`;
}

export function buildGitHubReleasesPageUrl(repository: string): string {
  const normalizedRepository = repository.trim() || DEFAULT_RELEASE_REPOSITORY;
  return `https://github.com/${normalizedRepository}/releases`;
}

/**
 * Build the GitHub download URL for the SHA256 sidecar of a release asset.
 * Sidecars are published by release.yml as `<asset>.sha256` and mirror the
 * binary's per-tag download path so the self-updater can verify integrity.
 */
export function buildReleaseChecksumUrl(
  repository: string,
  assetName: string,
  tagName?: string
): string {
  const normalizedRepository = repository.trim() || DEFAULT_RELEASE_REPOSITORY;
  const normalizedTag = tagName ? normalizeReleaseTag(tagName) : "latest";
  const tagSegment = normalizedTag === "latest" ? "latest" : `tags/v${normalizedTag}`;
  return `https://github.com/${normalizedRepository}/releases/download/${tagSegment}/${assetName}.sha256`;
}

/**
 * Compare two semver-ish versions (e.g. "1.0.203" vs "1.0.204").
 * Returns a positive number if `left` is newer, negative if `right` is newer,
 * and 0 if equal. Non-numeric / malformed segments are compared lexically.
 */
export function compareVersions(left: string, right: string): number {
  const strip = (value: string) => value.trim().replace(/^v/i, "").split(/[+-]/)[0];
  const leftParts = strip(left).split(".");
  const rightParts = strip(right).split(".");
  const maxLen = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLen; index += 1) {
    const leftSegment = leftParts[index] ?? "0";
    const rightSegment = rightParts[index] ?? "0";
    const leftNumber = Number(leftSegment);
    const rightNumber = Number(rightSegment);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
    } else {
      const lexical = leftSegment.localeCompare(rightSegment);
      if (lexical !== 0) return lexical;
    }
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export interface TauriReleaseConfigPatch {
  bundle: {
    createUpdaterArtifacts: boolean;
  };
  plugins: {
    updater: {
      endpoints: string[];
      pubkey: string;
    };
  };
}

export const TAURI_WINDOWS_X64_MSI_FALLBACK_PLATFORMS = [
  "windows-x86_64-msi",
  "windows-x86_64",
] as const;

export const TAURI_WINDOWS_X64_RELEASE_PLATFORMS = [
  "windows-x86_64",
  "windows-x86_64-msi",
  "windows-x86_64-nsis",
] as const;

export interface TauriUpdaterPlatformEntry {
  signature?: unknown;
  url?: unknown;
}

export interface TauriUpdaterManifest {
  version?: unknown;
  platforms?: unknown;
}

export interface TauriUpdaterManifestValidation {
  ok: boolean;
  missingPlatforms: string[];
  invalidPlatforms: string[];
}

export function validateTauriUpdaterManifest(
  manifest: TauriUpdaterManifest,
  requiredPlatforms: readonly string[] = TAURI_WINDOWS_X64_RELEASE_PLATFORMS
): TauriUpdaterManifestValidation {
  const platforms =
    manifest && typeof manifest.platforms === "object" && manifest.platforms !== null
      ? (manifest.platforms as Record<string, TauriUpdaterPlatformEntry>)
      : {};
  const missingPlatforms: string[] = [];
  const invalidPlatforms: string[] = [];

  for (const platform of requiredPlatforms) {
    const entry = platforms[platform];
    if (!entry) {
      missingPlatforms.push(platform);
      continue;
    }

    if (
      typeof entry.signature !== "string" ||
      entry.signature.trim().length === 0 ||
      typeof entry.url !== "string" ||
      entry.url.trim().length === 0
    ) {
      invalidPlatforms.push(platform);
    }
  }

  return {
    ok: missingPlatforms.length === 0 && invalidPlatforms.length === 0,
    missingPlatforms,
    invalidPlatforms,
  };
}

export function buildTauriReleaseConfigPatch(
  repository: string,
  publicKey: string,
  endpointOverride?: string | null
): TauriReleaseConfigPatch {
  const trimmedPublicKey = publicKey.trim();
  if (!trimmedPublicKey) {
    throw new Error("Updater public key is required");
  }

  const trimmedEndpoint = endpointOverride?.trim();
  const endpoint = trimmedEndpoint || buildGitHubUpdaterEndpoint(repository);

  return {
    bundle: {
      createUpdaterArtifacts: true,
    },
    plugins: {
      updater: {
        endpoints: [endpoint],
        pubkey: trimmedPublicKey,
      },
    },
  };
}
