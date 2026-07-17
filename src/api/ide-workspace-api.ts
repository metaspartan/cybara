import { existsSync, mkdirSync, readFileSync } from "fs";
import { readdir, stat } from "fs/promises";
import { dirname, join } from "path";
import type { RevealResult, WorkspaceOpenTarget, WorkspaceOpenTargetsResult } from "./ide-api";
import {
  IDE_HOME_DIR as HOME_DIR,
  isIdePathAllowed as isPathAllowed,
  isWithinIdeHome as isWithinHome,
  normalizeIdeInputPath as normalizePath,
  resolveCanonicalPath,
} from "./ide-path-policy";

const WORKSPACE_OPEN_TARGET_CACHE_MS = 60_000;
const commandAvailabilityCache = new Map<string, boolean>();
const commandPathCache = new Map<string, string | null>();
const windowsExecutablePathCache = new Map<string, Promise<string | null>>();
let workspaceOpenTargetsCache: {
  platform: NodeJS.Platform;
  expiresAt: number;
  targets: WorkspaceOpenTarget[];
} | null = null;
let workspaceOpenTargetsPromise: Promise<WorkspaceOpenTarget[]> | null = null;

function commandAvailable(command: string): boolean {
  const cacheKey = `${process.platform}:${command}`;
  const cached = commandAvailabilityCache.get(cacheKey);
  if (typeof cached === "boolean") return cached;
  const available = Bun.which(command) !== null;
  commandAvailabilityCache.set(cacheKey, available);
  return available;
}

type WorkspaceOpenTargetDefinition = {
  id: string;
  label: string;
  kind: WorkspaceOpenTarget["kind"];
  icon: string;
  iconUrl?: string;
  commands?: string[];
  macApps?: string[];
  windowsExecutables?: string[];
  platforms?: NodeJS.Platform[];
};

function windowsPathCommandPath(command: string): string | null {
  if (process.platform !== "win32") return null;
  const cacheKey = `path:${command.toLowerCase()}`;
  if (commandPathCache.has(cacheKey)) return commandPathCache.get(cacheKey) ?? null;
  const resolved = Bun.which(command);
  commandPathCache.set(cacheKey, resolved);
  return resolved;
}

function macAppBundlePath(appName: string): string | null {
  return (
    [
      `/Applications/${appName}.app`,
      join(HOME_DIR, "Applications", `${appName}.app`),
      `/System/Applications/${appName}.app`,
      `/System/Applications/Utilities/${appName}.app`,
      `/System/Library/CoreServices/${appName}.app`,
    ].find(existsSync) ?? null
  );
}

function macAppExists(appName: string): boolean {
  return macAppBundlePath(appName) !== null;
}

function windowsProgramRoots(): string[] {
  return [
    process.env.LOCALAPPDATA,
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
  ].filter((path): path is string => Boolean(path));
}

function windowsDirectExecutableCandidates(executableNames: string[]): string[] {
  const roots = windowsProgramRoots();
  const folders = [
    "Microsoft VS Code",
    "Cursor",
    "cursor",
    "Windsurf",
    "PearAI",
    "Zed",
    "Ghostty",
    "Android Studio",
    "JetBrains",
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    for (const executable of executableNames) {
      candidates.push(join(root, executable));
    }
    for (const folder of folders) {
      for (const executable of executableNames) {
        candidates.push(join(root, folder, executable));
        candidates.push(join(root, folder, "bin", executable));
      }
    }
  }
  return candidates;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function findExecutableUnderKnownVendorRoots(
  executableNames: string[]
): Promise<string | null> {
  const vendorRootCandidates = windowsProgramRoots().flatMap((root) => [
    join(root, "JetBrains"),
    join(root, "Programs"),
    join(root, "Microsoft VS Code"),
    join(root, "Cursor"),
    join(root, "Windsurf"),
    join(root, "Zed"),
  ]);
  const vendorRoots = (
    await Promise.all(
      vendorRootCandidates.map(async (root) => ({ root, exists: await pathExists(root) }))
    )
  ).filter((entry) => entry.exists);

  for (const { root } of vendorRoots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries.slice(0, 80)) {
      for (const executable of executableNames) {
        const direct = join(root, entry, executable);
        if (await pathExists(direct)) return direct;
        const bin = join(root, entry, "bin", executable);
        if (await pathExists(bin)) return bin;
      }
    }
  }
  return null;
}

function windowsExecutableCacheKey(executableNames: string[]): string {
  return executableNames
    .map((name) => name.toLowerCase())
    .sort()
    .join("|");
}

function findWindowsExecutablePath(executableNames: string[]): Promise<string | null> {
  const cacheKey = windowsExecutableCacheKey(executableNames);
  const cached = windowsExecutablePathCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async (): Promise<string | null> => {
    for (const candidate of windowsDirectExecutableCandidates(executableNames)) {
      if (await pathExists(candidate)) return candidate;
    }
    return await findExecutableUnderKnownVendorRoots(executableNames);
  })();
  windowsExecutablePathCache.set(cacheKey, pending);
  return pending;
}

function windowsCommandPath(executableNames: string[]): string | null {
  return (
    executableNames.map(windowsPathCommandPath).find((path): path is string => Boolean(path)) ??
    null
  );
}

async function windowsExecutableAvailable(executableNames: string[]): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (executableNames.some(commandAvailable)) return true;
  return Boolean(await findWindowsExecutablePath(executableNames));
}

async function windowsExecutablePath(executableNames: string[]): Promise<string | null> {
  if (process.platform !== "win32") return null;
  return windowsCommandPath(executableNames) || (await findWindowsExecutablePath(executableNames));
}

const WORKSPACE_OPEN_TARGET_DEFINITIONS: WorkspaceOpenTargetDefinition[] = [
  {
    id: "cybara_ide",
    label: "Cybara IDE",
    kind: "internal",
    icon: "cybara",
    iconUrl: "/cybara.png",
  },
  {
    id: "zed",
    label: "Zed",
    kind: "ide",
    icon: "zed",
    iconUrl: "/app-icons/zed.svg",
    commands: ["zed"],
    macApps: ["Zed"],
    windowsExecutables: ["Zed.exe"],
  },
  {
    id: "code",
    label: "VS Code",
    kind: "ide",
    icon: "code",
    iconUrl: "/app-icons/vscode.svg",
    commands: ["code"],
    macApps: ["Visual Studio Code"],
    windowsExecutables: ["Code.exe"],
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "ide",
    icon: "cursor",
    iconUrl: "/app-icons/cursor.svg",
    commands: ["cursor"],
    macApps: ["Cursor"],
    windowsExecutables: ["Cursor.exe"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "ide",
    icon: "windsurf",
    iconUrl: "/app-icons/windsurf.svg",
    commands: ["windsurf"],
    macApps: ["Windsurf"],
    windowsExecutables: ["Windsurf.exe"],
  },
  {
    id: "pearai",
    label: "PearAI",
    kind: "ide",
    icon: "pearai",
    iconUrl: "/app-icons/pearai.svg",
    commands: ["pearai"],
    macApps: ["PearAI"],
    windowsExecutables: ["PearAI.exe"],
  },
  {
    id: "intellij",
    label: "IntelliJ IDEA",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["idea", "idea64"],
    macApps: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
    windowsExecutables: ["idea64.exe", "idea.exe"],
  },
  {
    id: "webstorm",
    label: "WebStorm",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["webstorm"],
    macApps: ["WebStorm"],
    windowsExecutables: ["webstorm64.exe", "webstorm.exe"],
  },
  {
    id: "pycharm",
    label: "PyCharm",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["pycharm"],
    macApps: ["PyCharm", "PyCharm CE"],
    windowsExecutables: ["pycharm64.exe", "pycharm.exe"],
  },
  {
    id: "goland",
    label: "GoLand",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["goland"],
    macApps: ["GoLand"],
    windowsExecutables: ["goland64.exe", "goland.exe"],
  },
  {
    id: "clion",
    label: "CLion",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["clion"],
    macApps: ["CLion"],
    windowsExecutables: ["clion64.exe", "clion.exe"],
  },
  {
    id: "phpstorm",
    label: "PhpStorm",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["phpstorm"],
    macApps: ["PhpStorm"],
    windowsExecutables: ["phpstorm64.exe", "phpstorm.exe"],
  },
  {
    id: "rubymine",
    label: "RubyMine",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["rubymine"],
    macApps: ["RubyMine"],
    windowsExecutables: ["rubymine64.exe", "rubymine.exe"],
  },
  {
    id: "rider",
    label: "Rider",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["rider"],
    macApps: ["Rider"],
    windowsExecutables: ["rider64.exe", "rider.exe"],
  },
  {
    id: "datagrip",
    label: "DataGrip",
    kind: "ide",
    icon: "jetbrains",
    iconUrl: "/app-icons/jetbrains.svg",
    commands: ["datagrip"],
    macApps: ["DataGrip"],
    windowsExecutables: ["datagrip64.exe", "datagrip.exe"],
  },
  {
    id: "android_studio",
    label: "Android Studio",
    kind: "ide",
    icon: "android-studio",
    iconUrl: "/app-icons/android-studio.svg",
    commands: ["studio", "android-studio"],
    macApps: ["Android Studio"],
    windowsExecutables: ["studio64.exe", "studio.exe"],
  },
  {
    id: "xcode",
    label: "Xcode",
    kind: "ide",
    icon: "xcode",
    iconUrl: "/app-icons/xcode.svg",
    macApps: ["Xcode"],
    platforms: ["darwin"],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    kind: "terminal",
    icon: "terminal",
    iconUrl: "/app-icons/ghostty.svg",
    commands: ["ghostty"],
    macApps: ["Ghostty"],
    windowsExecutables: ["ghostty.exe"],
  },
];

const MAC_SYSTEM_APP_NAMES: Record<string, string[]> = {
  finder: ["Finder"],
  terminal: ["Terminal"],
};

async function definitionAvailable(definition: WorkspaceOpenTargetDefinition): Promise<boolean> {
  if (definition.platforms && !definition.platforms.includes(process.platform)) return false;
  if (definition.kind === "internal") return true;
  if (process.platform === "darwin" && definition.macApps?.some(macAppExists)) return true;
  if (process.platform === "win32" && definition.windowsExecutables) {
    return await windowsExecutableAvailable(definition.windowsExecutables);
  }
  return definition.commands?.some(commandAvailable) ?? false;
}

function targetDefinition(targetId: string): WorkspaceOpenTargetDefinition | undefined {
  return WORKSPACE_OPEN_TARGET_DEFINITIONS.find((definition) => definition.id === targetId);
}

function macAppIconSource(appPath: string): string | null {
  const infoPlist = join(appPath, "Contents", "Info.plist");
  const resourcesDir = join(appPath, "Contents", "Resources");
  const proc = Bun.spawnSync(
    ["plutil", "-extract", "CFBundleIconFile", "raw", "-o", "-", infoPlist],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const rawName = proc.exitCode === 0 ? proc.stdout.toString().trim() : "";
  const candidates = rawName
    ? [`${rawName}.icns`, `${rawName}.png`, `${rawName}.tiff`, rawName]
    : [];
  for (const name of candidates) {
    const path = join(resourcesDir, name);
    if (existsSync(path)) return path;
  }
  const fallback = join(resourcesDir, "AppIcon.icns");
  return existsSync(fallback) ? fallback : null;
}

function cachedMacAppIconDataUrl(targetId: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  const appNames = targetDefinition(targetId)?.macApps ?? MAC_SYSTEM_APP_NAMES[targetId];
  const appPath = appNames?.map(macAppBundlePath).find((path): path is string => Boolean(path));
  if (!appPath) return undefined;
  const iconSource = macAppIconSource(appPath);
  if (!iconSource) return undefined;

  const cacheDir = join(HOME_DIR, ".cybara", "cache", "app-icons");
  const cachePath = join(cacheDir, `${targetId}.png`);
  try {
    mkdirSync(cacheDir, { recursive: true });
    if (!existsSync(cachePath)) {
      const proc = Bun.spawnSync(
        ["sips", "-Z", "64", "-s", "format", "png", iconSource, "--out", cachePath],
        {
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      if ((proc.exitCode ?? 1) !== 0 || !existsSync(cachePath)) return undefined;
    }
    const bytes = readFileSync(cachePath);
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function validateWorkspaceOpenPath(
  inputPath: string
): { success: true; path: string } | RevealResult {
  const targetPath = normalizePath(inputPath);
  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }
  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Path does not exist",
    };
  }
  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }
  return { success: true, path: targetPath };
}

async function availableTargetsForPlatform(): Promise<WorkspaceOpenTarget[]> {
  const now = Date.now();
  if (
    workspaceOpenTargetsCache &&
    workspaceOpenTargetsCache.platform === process.platform &&
    workspaceOpenTargetsCache.expiresAt > now
  ) {
    return workspaceOpenTargetsCache.targets;
  }
  if (workspaceOpenTargetsPromise) return await workspaceOpenTargetsPromise;
  workspaceOpenTargetsPromise = (async (): Promise<WorkspaceOpenTarget[]> => {
    const targets: WorkspaceOpenTarget[] = await Promise.all(
      WORKSPACE_OPEN_TARGET_DEFINITIONS.map(async (definition) => ({
        id: definition.id,
        label: definition.label,
        kind: definition.kind,
        icon: definition.icon,
        iconUrl: definition.iconUrl,
        available: await definitionAvailable(definition),
        detail: definition.id === "cybara_ide" ? "Open in Cybara's workspace IDE" : undefined,
      }))
    );

    if (process.platform === "darwin") {
      targets.push(
        {
          id: "finder",
          label: "Finder",
          kind: "file-manager",
          icon: "finder",
          iconUrl: "/app-icons/finder.svg",
          available: true,
        },
        {
          id: "terminal",
          label: "Terminal",
          kind: "terminal",
          icon: "terminal",
          iconUrl: "/app-icons/terminal.svg",
          available: true,
        }
      );
    } else if (process.platform === "win32") {
      targets.push(
        {
          id: "explorer",
          label: "Explorer",
          kind: "file-manager",
          icon: "folder",
          iconUrl: "/app-icons/explorer.svg",
          available: true,
        },
        {
          id: "terminal",
          label: "Terminal",
          kind: "terminal",
          icon: "terminal",
          iconUrl: "/app-icons/terminal.svg",
          available: true,
        }
      );
    } else {
      targets.push(
        {
          id: "files",
          label: "Files",
          kind: "file-manager",
          icon: "folder",
          iconUrl: "/app-icons/files.svg",
          available: commandAvailable("xdg-open"),
        },
        {
          id: "terminal",
          label: "Terminal",
          kind: "terminal",
          icon: "terminal",
          iconUrl: "/app-icons/terminal.svg",
          available: ["gnome-terminal", "konsole", "xfce4-terminal", "x-terminal-emulator"].some(
            commandAvailable
          ),
        }
      );
    }

    const availableTargets = targets
      .filter((target) => target.available)
      .map((target) => ({
        ...target,
        iconUrl:
          target.id === "cybara_ide"
            ? "/cybara.png"
            : cachedMacAppIconDataUrl(target.id) || target.iconUrl,
      }));
    workspaceOpenTargetsCache = {
      platform: process.platform,
      expiresAt: now + WORKSPACE_OPEN_TARGET_CACHE_MS,
      targets: availableTargets,
    };
    return availableTargets;
  })();
  try {
    return await workspaceOpenTargetsPromise;
  } finally {
    workspaceOpenTargetsPromise = null;
  }
}

function openWithCommand(targetPath: string, command: string, appName?: string): RevealResult {
  const args =
    process.platform === "darwin" && appName && !commandAvailable(command)
      ? ["open", "-a", appName, targetPath]
      : [command, targetPath];
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if ((result.exitCode ?? 1) !== 0) {
    return {
      success: false,
      path: targetPath,
      error: result.stderr.toString().trim() || `Failed to open ${appName || command}`,
    };
  }
  return { success: true, path: targetPath };
}

function openMacApp(targetPath: string, appName: string): RevealResult {
  const result = Bun.spawnSync(["open", "-a", appName, targetPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((result.exitCode ?? 1) !== 0) {
    return {
      success: false,
      path: targetPath,
      error: result.stderr.toString().trim() || `Failed to open ${appName}`,
    };
  }
  return { success: true, path: targetPath };
}

async function openWorkspaceDefinition(
  targetPath: string,
  definition: WorkspaceOpenTargetDefinition
): Promise<RevealResult> {
  if (process.platform === "darwin") {
    const command = definition.commands?.find(commandAvailable);
    if (command) return openWithCommand(targetPath, command);
    const appName = definition.macApps?.find(macAppExists);
    if (appName) return openMacApp(targetPath, appName);
  }

  if (process.platform === "win32") {
    const command = definition.commands?.find(commandAvailable);
    if (command) return openWithCommand(targetPath, command);
    const executable = definition.windowsExecutables
      ? await windowsExecutablePath(definition.windowsExecutables)
      : null;
    if (executable) return openWithCommand(targetPath, executable);
  }

  const command = definition.commands?.find(commandAvailable);
  if (command) return openWithCommand(targetPath, command);

  return {
    success: false,
    path: targetPath,
    error: `${definition.label} is not installed or its launcher is not available`,
  };
}

export async function revealInSystemExplorer(inputPath: string): Promise<RevealResult> {
  const targetPath = normalizePath(inputPath);
  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Path does not exist",
    };
  }

  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  try {
    const targetStats = await stat(targetPath);
    if (process.platform === "darwin") {
      const args = targetStats.isDirectory() ? [targetPath] : ["-R", targetPath];
      const result = Bun.spawnSync(["open", ...args], { stdout: "pipe", stderr: "pipe" });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open Finder",
        };
      }
      return { success: true, path: targetPath };
    }

    if (process.platform === "win32") {
      const args = targetStats.isDirectory() ? [targetPath] : [`/select,${targetPath}`];
      const result = Bun.spawnSync(["explorer", ...args], { stdout: "pipe", stderr: "pipe" });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open Explorer",
        };
      }
      return { success: true, path: targetPath };
    }

    const fallbackTarget = targetStats.isDirectory() ? targetPath : dirname(targetPath);
    const result = Bun.spawnSync(["xdg-open", fallbackTarget], { stdout: "pipe", stderr: "pipe" });
    if ((result.exitCode ?? 1) !== 0) {
      return {
        success: false,
        path: targetPath,
        error: result.stderr.toString().trim() || "Failed to open file manager",
      };
    }
    return { success: true, path: targetPath };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listWorkspaceOpenTargets(
  inputPath: string
): Promise<WorkspaceOpenTargetsResult> {
  const validation = validateWorkspaceOpenPath(inputPath);
  if (!validation.success) {
    return { ...validation, targets: [] };
  }
  return {
    success: true,
    path: validation.path,
    targets: await availableTargetsForPlatform(),
  };
}

export async function openWorkspaceTarget(
  inputPath: string,
  targetId: string
): Promise<RevealResult> {
  const validation = validateWorkspaceOpenPath(inputPath);
  if (!validation.success) return validation;
  const targetPath = validation.path;

  switch (targetId) {
    case "cybara_ide":
      return { success: true, path: targetPath };
    case "finder":
    case "explorer":
    case "files":
      return revealInSystemExplorer(targetPath);
    case "terminal":
      return openInSystemTerminal(targetPath);
    default:
      {
        const definition = targetDefinition(targetId);
        if (definition) {
          return await openWorkspaceDefinition(targetPath, definition);
        }
      }
      return {
        success: false,
        path: targetPath,
        error: `Unsupported open target: ${targetId}`,
      };
  }
}

export async function openInSystemTerminal(inputPath: string): Promise<RevealResult> {
  const targetPath = normalizePath(inputPath);
  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }
  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Path does not exist",
    };
  }

  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  try {
    const stats = await stat(targetPath);
    const workingDir = stats.isDirectory() ? targetPath : dirname(targetPath);

    if (process.platform === "darwin") {
      const result = Bun.spawnSync(["open", "-a", "Terminal", workingDir], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open Terminal",
        };
      }
      return { success: true, path: targetPath };
    }

    if (process.platform === "win32") {
      const result = Bun.spawnSync(["cmd", "/c", "start", "cmd"], {
        cwd: workingDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open terminal",
        };
      }
      return { success: true, path: targetPath };
    }

    const linuxLaunchers: Array<{ cmd: string; args: string[] }> = [
      { cmd: "gnome-terminal", args: ["--working-directory", workingDir] },
      { cmd: "konsole", args: ["--workdir", workingDir] },
      { cmd: "xfce4-terminal", args: ["--working-directory", workingDir] },
      { cmd: "x-terminal-emulator", args: ["--working-directory", workingDir] },
    ];
    for (const launcher of linuxLaunchers) {
      if (!commandAvailable(launcher.cmd)) continue;
      const result = Bun.spawnSync([launcher.cmd, ...launcher.args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((result.exitCode ?? 1) === 0) {
        return { success: true, path: targetPath };
      }
    }

    return {
      success: false,
      path: targetPath,
      error: "No supported terminal launcher found on this system",
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
