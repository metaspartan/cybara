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
    if (arch === "arm64" || arch === "aarch64") return "cybara-windows-arm64";
    if (arch === "x64" || arch === "x86_64") return "cybara-windows-x64";
    return null;
  }

  return null;
}

export function resolveReleaseBinaryFilename(platformValue: string, archValue: string): string | null {
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
