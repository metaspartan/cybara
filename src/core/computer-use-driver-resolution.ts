import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { managedCuaDriverDir, packagedCuaDriverCandidates } from "./cua-driver-runtime";

const DEFAULT_CUA_DRIVER_CMD = "cua-driver";
export const CUA_DRIVER_CMD_ENV = "CYBARA_CUA_DRIVER_CMD";

export type CuaDriverCommandSource =
  | "env"
  | "config"
  | "bundled"
  | "managed-runtime"
  | "path"
  | "known-install-dir"
  | "default";

export interface CuaDriverResolution {
  command: string;
  source: CuaDriverCommandSource;
  searchedPaths: string[];
}

function readEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const direct = env[key];
  if (direct !== undefined || platform !== "win32") return direct;
  const wanted = key.toLowerCase();
  const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === wanted);
  return match ? env[match] : undefined;
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitPathEntries(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string[] {
  const raw = readEnvValue(env, "PATH", platform) || "";
  const delimiter = platform === "win32" ? ";" : ":";
  return raw
    .split(delimiter)
    .map((entry) => stripWrappingQuotes(entry))
    .filter(Boolean);
}

function uniqueStrings(values: string[], platform: NodeJS.Platform = process.platform): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = platform === "win32" ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function driverExecutableNames(platform: NodeJS.Platform = process.platform): string[] {
  return platform === "win32"
    ? ["cua-driver.exe", "cua-driver.cmd", "cua-driver.bat", DEFAULT_CUA_DRIVER_CMD]
    : [DEFAULT_CUA_DRIVER_CMD];
}

function candidateExists(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function defaultHomeForPlatform(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (platform === "win32") {
    return (
      readEnvValue(env, "USERPROFILE", platform) ||
      (readEnvValue(env, "HOMEDRIVE", platform) && readEnvValue(env, "HOMEPATH", platform)
        ? `${readEnvValue(env, "HOMEDRIVE", platform)}${readEnvValue(env, "HOMEPATH", platform)}`
        : undefined) ||
      readEnvValue(env, "HOME", platform)
    );
  }
  return readEnvValue(env, "HOME", platform) || readEnvValue(env, "USERPROFILE", platform);
}

function knownDriverInstallDirs(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string[] {
  const configured = [
    readEnvValue(env, "CUA_DRIVER_RS_INSTALL_DIR", platform),
    readEnvValue(env, "CUA_DRIVER_BIN_DIR", platform),
  ].filter((value): value is string => !!value);

  const home = defaultHomeForPlatform(env, platform);
  if (platform === "win32") {
    const localAppData = readEnvValue(env, "LOCALAPPDATA", platform);
    const cuaHome =
      readEnvValue(env, "CUA_DRIVER_RS_HOME", platform) || (home ? join(home, ".cua-driver") : "");
    const legacyCuaHome = home ? join(home, ".cua-driver-rs") : "";
    const dirs = [...configured];
    if (localAppData) {
      dirs.push(
        join(localAppData, "Programs", "Cua", "cua-driver", "bin"),
        join(localAppData, "Programs", "trycua", "cua-driver-rs", "bin")
      );
    }
    for (const packageHome of [cuaHome, legacyCuaHome].filter(Boolean)) {
      const packagesDir = join(packageHome, "packages");
      const currentDir = join(packagesDir, "current");
      dirs.push(currentDir, join(currentDir, "bin"));
      const releasesDir = join(packagesDir, "releases");
      try {
        const releaseDirs = readdirSync(releasesDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(releasesDir, entry.name));
        for (const releaseDir of releaseDirs) {
          dirs.push(releaseDir, join(releaseDir, "bin"));
        }
      } catch {}
    }
    if (home) {
      dirs.push(
        join(home, ".local", "bin"),
        join(home, ".cargo", "bin"),
        join(home, ".bun", "bin")
      );
    }
    return uniqueStrings(dirs, platform);
  }

  const dirs = [...configured];
  if (home) {
    dirs.push(join(home, ".local", "bin"), join(home, ".cargo", "bin"), join(home, ".bun", "bin"));
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  return uniqueStrings(dirs, platform);
}

function findDriverInDirs(
  dirs: string[],
  platform: NodeJS.Platform,
  searchedPaths: string[]
): string | null {
  const names = driverExecutableNames(platform);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      searchedPaths.push(candidate);
      if (candidateExists(candidate)) return candidate;
    }
  }
  return null;
}

function shouldUsePersistedComputerUseConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  configuredCommand: string | undefined
): boolean {
  return configuredCommand === undefined && env === process.env && platform === process.platform;
}

export function resolveCuaDriverCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  configuredCommand?: string
): CuaDriverResolution | null {
  const override = readEnvValue(env, CUA_DRIVER_CMD_ENV, platform);
  if (override?.trim()) {
    return {
      command: stripWrappingQuotes(override),
      source: "env",
      searchedPaths: [],
    };
  }

  const configOverride = shouldUsePersistedComputerUseConfig(env, platform, configuredCommand)
    ? config.getComputerUseSettings().driverCommand
    : configuredCommand;
  if (configOverride?.trim()) {
    return {
      command: stripWrappingQuotes(configOverride),
      source: "config",
      searchedPaths: [],
    };
  }

  const searchedPaths: string[] = [];
  for (const candidate of packagedCuaDriverCandidates(platform, env)) {
    searchedPaths.push(candidate);
    if (candidateExists(candidate)) {
      return { command: candidate, source: "bundled", searchedPaths };
    }
  }

  const pathMatch = findDriverInDirs(splitPathEntries(env, platform), platform, searchedPaths);
  if (pathMatch) {
    return { command: pathMatch, source: "path", searchedPaths };
  }

  const installDirMatch = findDriverInDirs(
    knownDriverInstallDirs(env, platform),
    platform,
    searchedPaths
  );
  if (installDirMatch) {
    return {
      command: installDirMatch,
      source: "known-install-dir",
      searchedPaths,
    };
  }

  const home = defaultHomeForPlatform(env, platform);
  if (home) {
    const executableName = platform === "win32" ? "cua-driver.exe" : "cua-driver";
    const managed = join(managedCuaDriverDir(home), executableName);
    searchedPaths.push(managed);
    if (candidateExists(managed)) {
      return { command: managed, source: "managed-runtime", searchedPaths };
    }
  }

  return null;
}

export function getCuaDriverResolution(): CuaDriverResolution {
  return (
    resolveCuaDriverCommand() || {
      command: DEFAULT_CUA_DRIVER_CMD,
      source: "default",
      searchedPaths: [],
    }
  );
}
