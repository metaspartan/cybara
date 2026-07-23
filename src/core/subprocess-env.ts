import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, win32 } from "node:path";

const SAFE_ENV_NAMES = new Set([
  "APPDATA",
  "BUN_INSTALL",
  "COLORTERM",
  "COMSPEC",
  "CYBARA_HOME",
  "CYBARA_RESOURCE_DIR",
  "DISPLAY",
  "HOME",
  "LANG",
  "LANGUAGE",
  "LOCALAPPDATA",
  "LOGNAME",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
]);

const SAFE_ENV_PREFIXES = ["LC_"];
const CONTAINER_RUNTIME_ENV_NAMES = [
  "CONTAINER_CONNECTION",
  "CONTAINER_HOST",
  "DOCKER_CERT_PATH",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS_VERIFY",
] as const;

function safeEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    SAFE_ENV_NAMES.has(normalized) ||
    SAFE_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function existingSubdirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function hostExecutableDirectories(
  source: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  executablePath = process.execPath
): string[] {
  const home = source.HOME || source.USERPROFILE || homedir();
  const pathJoin = platform === "win32" ? win32.join : join;
  const pathDirname = platform === "win32" ? win32.dirname : dirname;
  const candidates: Array<string | undefined> = [
    pathDirname(executablePath),
    source.CYBARA_BUN_PATH ? pathDirname(source.CYBARA_BUN_PATH) : undefined,
    source.CYBARA_RESOURCE_DIR ? pathJoin(source.CYBARA_RESOURCE_DIR, "runtime") : undefined,
    source.BUN_INSTALL ? pathJoin(source.BUN_INSTALL, "bin") : undefined,
    pathJoin(home, ".bun", "bin"),
    pathJoin(home, ".local", "bin"),
    pathJoin(home, ".volta", "bin"),
    pathJoin(home, ".asdf", "shims"),
    pathJoin(home, ".local", "share", "mise", "shims"),
  ];

  if (platform === "win32") {
    const localAppData = source.LOCALAPPDATA;
    const programFiles = source.PROGRAMFILES || "C:\\Program Files";
    candidates.push(
      pathJoin(programFiles, "nodejs"),
      source.APPDATA ? pathJoin(source.APPDATA, "npm") : undefined,
      pathJoin(home, "scoop", "shims"),
      localAppData ? pathJoin(localAppData, "Microsoft", "WinGet", "Links") : undefined
    );
  } else {
    candidates.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
    const nvmRoot = pathJoin(home, ".nvm", "versions", "node");
    candidates.push(
      ...existingSubdirectories(nvmRoot).map((directory) => pathJoin(directory, "bin"))
    );
    const fnmRoot = pathJoin(home, ".local", "share", "fnm", "node-versions");
    candidates.push(
      ...existingSubdirectories(fnmRoot).map((directory) =>
        pathJoin(directory, "installation", "bin")
      )
    );
  }

  const managedRuntimeRoot = pathJoin(home, ".cybara", "runtime");
  candidates.push(...existingSubdirectories(managedRuntimeRoot));

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is string => {
    if (!candidate || !existsSync(candidate)) return false;
    const key = platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function environmentPathKey(environment: Readonly<Record<string, string>>): string {
  return Object.keys(environment).find((name) => name.toUpperCase() === "PATH") || "PATH";
}

export function baseSubprocessEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string" && safeEnvironmentName(name)) environment[name] = value;
  }
  return environment;
}

export function sanitizeSubprocessEnvironment(source: unknown): Record<string, string> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string" && safeEnvironmentName(name)) environment[name] = value;
  }
  return environment;
}

export function buildSubprocessEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const environment = baseSubprocessEnvironment(source);
  for (const [name, value] of Object.entries(overrides)) {
    if (name && typeof value === "string") environment[name] = value;
  }
  return environment;
}

export function buildHostSubprocessEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const environment = buildSubprocessEnvironment(overrides, source);
  const pathKey = environmentPathKey(environment);
  const currentEntries = (environment[pathKey] || "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set(
    currentEntries.map((entry) => (process.platform === "win32" ? entry.toLowerCase() : entry))
  );
  for (const directory of hostExecutableDirectories({ ...source, ...environment })) {
    const key = process.platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(key)) continue;
    seen.add(key);
    currentEntries.push(directory);
  }
  environment[pathKey] = currentEntries.join(delimiter);
  return environment;
}

export function buildContainerRuntimeEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
  source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const environment = buildSubprocessEnvironment(overrides, source);
  for (const name of CONTAINER_RUNTIME_ENV_NAMES) {
    const value = source[name];
    if (!(name in overrides) && typeof value === "string") environment[name] = value;
  }
  return environment;
}
