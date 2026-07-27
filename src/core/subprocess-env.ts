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

function environmentValue(
  source: Readonly<Record<string, string | undefined>>,
  name: string
): string | undefined {
  const matchedName = Object.keys(source).find(
    (candidate) => candidate.toUpperCase() === name.toUpperCase()
  );
  return matchedName ? source[matchedName] : undefined;
}

function hostExecutableDirectories(
  source: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
  executablePath = process.execPath,
  directoryExists: (path: string) => boolean = existsSync
): string[] {
  const home =
    environmentValue(source, "HOME") || environmentValue(source, "USERPROFILE") || homedir();
  const pathJoin = platform === "win32" ? win32.join : join;
  const pathDirname = platform === "win32" ? win32.dirname : dirname;
  const cybaraBunPath = environmentValue(source, "CYBARA_BUN_PATH");
  const resourceDir = environmentValue(source, "CYBARA_RESOURCE_DIR");
  const bunInstall = environmentValue(source, "BUN_INSTALL");
  const candidates: Array<string | undefined> = [
    pathDirname(executablePath),
    cybaraBunPath ? pathDirname(cybaraBunPath) : undefined,
    resourceDir ? pathJoin(resourceDir, "runtime") : undefined,
    bunInstall ? pathJoin(bunInstall, "bin") : undefined,
    pathJoin(home, ".bun", "bin"),
    pathJoin(home, ".local", "bin"),
    pathJoin(home, ".volta", "bin"),
    pathJoin(home, ".asdf", "shims"),
    pathJoin(home, ".local", "share", "mise", "shims"),
  ];

  if (platform === "win32") {
    const localAppData = environmentValue(source, "LOCALAPPDATA");
    const appData = environmentValue(source, "APPDATA");
    const programData = environmentValue(source, "PROGRAMDATA") || "C:\\ProgramData";
    const programFiles =
      environmentValue(source, "PROGRAMW6432") ||
      environmentValue(source, "PROGRAMFILES") ||
      "C:\\Program Files";
    const programFilesX86 = environmentValue(source, "PROGRAMFILES(X86)");
    const chocolateyInstall = environmentValue(source, "CHOCOLATEYINSTALL");
    candidates.push(
      pathJoin(programFiles, "nodejs"),
      pathJoin(programFiles, "GitHub CLI"),
      pathJoin(programFiles, "Git", "cmd"),
      programFilesX86 ? pathJoin(programFilesX86, "GitHub CLI") : undefined,
      programFilesX86 ? pathJoin(programFilesX86, "Git", "cmd") : undefined,
      appData ? pathJoin(appData, "npm") : undefined,
      pathJoin(home, "scoop", "shims"),
      pathJoin(home, ".cargo", "bin"),
      pathJoin(home, ".dotnet", "tools"),
      pathJoin(home, "go", "bin"),
      localAppData ? pathJoin(localAppData, "Microsoft", "WinGet", "Links") : undefined,
      localAppData ? pathJoin(localAppData, "Programs", "GitHub CLI") : undefined,
      localAppData ? pathJoin(localAppData, "Programs", "Git", "cmd") : undefined,
      chocolateyInstall ? pathJoin(chocolateyInstall, "bin") : undefined,
      pathJoin(programData, "chocolatey", "bin")
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
    if (!candidate || !directoryExists(candidate)) return false;
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
  source: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    platform?: NodeJS.Platform;
    executablePath?: string;
    directoryExists?: (path: string) => boolean;
  } = {}
): Record<string, string> {
  const platform = options.platform ?? process.platform;
  const pathDelimiter = platform === "win32" ? win32.delimiter : delimiter;
  const environment = buildSubprocessEnvironment(overrides, source);
  const pathKey = environmentPathKey(environment);
  const currentEntries = (environment[pathKey] || "")
    .split(pathDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set(
    currentEntries.map((entry) => (platform === "win32" ? entry.toLowerCase() : entry))
  );
  for (const directory of hostExecutableDirectories(
    { ...source, ...environment },
    platform,
    options.executablePath,
    options.directoryExists
  )) {
    const key = platform === "win32" ? directory.toLowerCase() : directory;
    if (seen.has(key)) continue;
    seen.add(key);
    currentEntries.push(directory);
  }
  environment[pathKey] = currentEntries.join(pathDelimiter);
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
