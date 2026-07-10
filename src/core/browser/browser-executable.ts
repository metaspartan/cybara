import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import type { chromium as ChromiumApi } from "playwright";

type Chromium = typeof ChromiumApi;
type RuntimePlatform = NodeJS.Platform;

export interface BrowserLaunchTarget {
  label: string;
  channel?: "chrome" | "msedge";
  executablePath?: string;
}

export function browserExecutableCandidates(
  platform: RuntimePlatform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string[] {
  const explicit = env.CYBARA_BROWSER_PATH?.trim() || env.CHROME_PATH?.trim();
  const candidates: Array<string | undefined> = explicit ? [explicit] : [];
  if (platform === "win32") {
    const windowsJoin = win32.join;
    const programFiles = env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 =
      env["ProgramFiles(x86)"] || env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA;
    candidates.push(
      windowsJoin(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      windowsJoin(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData && windowsJoin(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      windowsJoin(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      windowsJoin(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && windowsJoin(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      windowsJoin(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      localAppData &&
        windowsJoin(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      windowsJoin(programFiles, "Chromium", "Application", "chrome.exe")
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join(home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/brave-browser",
      "/usr/bin/brave-browser-stable",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable"
    );
  }
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

export function browserChannelNames(platform: RuntimePlatform): Array<"chrome" | "msedge"> {
  return platform === "win32" ? ["msedge", "chrome"] : ["chrome", "msedge"];
}

export function browserExecutableLabel(executablePath: string): string {
  const normalized = executablePath.toLowerCase();
  if (normalized.includes("msedge")) return "Microsoft Edge executable";
  if (normalized.includes("chrome")) return "Google Chrome executable";
  if (normalized.includes("brave")) return "Brave executable";
  return "Chromium executable";
}

function browserChannelForExecutable(executablePath: string): "chrome" | "msedge" | undefined {
  const normalized = executablePath.toLowerCase().replaceAll("\\", "/");
  if (normalized.includes("/microsoft/edge/") || normalized.includes("microsoft edge.app")) {
    return "msedge";
  }
  if (
    normalized.includes("/google/chrome/") ||
    normalized.includes("google chrome.app") ||
    /\/google-chrome(?:-stable)?$/.test(normalized)
  ) {
    return "chrome";
  }
  return undefined;
}

export function buildBrowserLaunchPlan(
  platform: RuntimePlatform,
  explicitExecutable: string | undefined,
  bundledExecutable: string | null,
  systemExecutables: string[]
): BrowserLaunchTarget[] {
  const targets: BrowserLaunchTarget[] = [];
  const seenExecutables = new Set<string>();
  const pathKey = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  const addExecutable = (label: string, executablePath: string) => {
    const key = pathKey(executablePath);
    if (seenExecutables.has(key)) return;
    seenExecutables.add(key);
    targets.push({ label, executablePath });
  };
  const configured = explicitExecutable
    ? systemExecutables.find((candidate) => pathKey(candidate) === pathKey(explicitExecutable))
    : undefined;
  if (configured) addExecutable("configured browser", configured);
  if (bundledExecutable) addExecutable("bundled Chromium", bundledExecutable);
  const detectedChannels = new Set(
    systemExecutables
      .map((executablePath) => browserChannelForExecutable(executablePath))
      .filter((channel): channel is "chrome" | "msedge" => channel !== undefined)
  );
  for (const channel of browserChannelNames(platform)) {
    if (!detectedChannels.has(channel)) continue;
    targets.push({
      label: channel === "msedge" ? "Microsoft Edge" : "Google Chrome",
      channel,
    });
  }
  for (const executablePath of systemExecutables) {
    if (browserChannelForExecutable(executablePath)) continue;
    addExecutable(browserExecutableLabel(executablePath), executablePath);
  }
  return targets;
}

function browserCommandNames(platform: RuntimePlatform): string[] {
  if (platform === "win32") return ["chrome.exe", "msedge.exe", "brave.exe", "chromium.exe"];
  if (platform === "darwin") return [];
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "brave-browser",
    "microsoft-edge",
  ];
}

export function findSystemBrowserExecutable(
  platform: RuntimePlatform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string | null {
  return findSystemBrowserExecutables(platform, env, home)[0] ?? null;
}

export function findSystemBrowserExecutables(
  platform: RuntimePlatform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string[] {
  const found: string[] = [];
  for (const candidate of browserExecutableCandidates(platform, env, home)) {
    if (existsSync(candidate)) found.push(candidate);
  }
  for (const command of browserCommandNames(platform)) {
    const executable = Bun.which(command);
    if (executable && existsSync(executable)) found.push(executable);
  }
  return [...new Set(found)];
}

export function findBundledBrowserExecutable(chromium: Chromium): string | null {
  try {
    const executable = chromium.executablePath();
    return executable && existsSync(executable) ? executable : null;
  } catch {
    return null;
  }
}

export function browserLaunchArgs(
  platform: RuntimePlatform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const args = platform === "linux" ? ["--disable-dev-shm-usage"] : [];
  if (
    platform === "linux" &&
    (env.CI === "true" || env.DOCKER === "true" || env.CYBARA_BROWSER_DISABLE_SANDBOX === "true")
  ) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  if (platform === "win32") {
    args.push(
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-position=-32000,-32000"
    );
  }
  return args;
}
