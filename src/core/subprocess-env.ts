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

function safeEnvironmentName(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    SAFE_ENV_NAMES.has(normalized) ||
    SAFE_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
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
