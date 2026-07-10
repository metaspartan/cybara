import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import type { chromium as ChromiumApi } from "playwright";

type Chromium = typeof ChromiumApi;
type RuntimePlatform = NodeJS.Platform;

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
      windowsJoin(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      windowsJoin(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && windowsJoin(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      windowsJoin(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      windowsJoin(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData && windowsJoin(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
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
  for (const candidate of browserExecutableCandidates(platform, env, home)) {
    if (existsSync(candidate)) return candidate;
  }
  for (const command of browserCommandNames(platform)) {
    const executable = Bun.which(command);
    if (executable && existsSync(executable)) return executable;
  }
  return null;
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
  const args = [
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1920,1080",
  ];
  if (
    platform === "linux" &&
    (env.CI === "true" || env.DOCKER === "true" || env.CYBARA_BROWSER_DISABLE_SANDBOX === "true")
  ) {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}
