import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserChannelNames,
  browserExecutableCandidates,
  browserLaunchArgs,
  buildBrowserLaunchPlan,
} from "../../src/core/browser/browser-executable";
import {
  configureHermeticPlaywrightBrowserPath,
  findHermeticPlaywrightBrowserPath,
  stripWindowsLongPathPrefix,
} from "../../src/core/browser/playwright-loader";

describe("browser executable discovery", () => {
  test("covers user and machine Chrome and Edge installs on Windows", () => {
    const candidates = browserExecutableCandidates(
      "win32",
      {
        ProgramFiles: "C:\\Apps",
        "ProgramFiles(x86)": "C:\\Apps32",
        LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
      },
      "C:\\Users\\Test"
    );

    expect(candidates).toContain("C:\\Apps\\Google\\Chrome\\Application\\chrome.exe");
    expect(candidates).toContain("C:\\Apps\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(candidates).toContain(
      "C:\\Users\\Test\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe"
    );
    expect(candidates[0]).toBe("C:\\Apps\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(browserChannelNames("win32")).toEqual(["msedge", "chrome"]);
  });

  test("covers common native and packaged Linux browser locations", () => {
    const candidates = browserExecutableCandidates("linux", {}, "/home/test");

    expect(candidates).toContain("/usr/bin/google-chrome-stable");
    expect(candidates).toContain("/usr/bin/chromium");
    expect(candidates).toContain("/snap/bin/chromium");
  });

  test("uses one supported channel for an installed Windows browser", () => {
    const plan = buildBrowserLaunchPlan("win32", undefined, null, [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ]);

    expect(plan.map((target) => target.label)).toEqual(["Microsoft Edge"]);
    expect(plan[0]?.channel).toBe("msedge");
  });

  test("keeps unsupported Chromium browsers as executable fallbacks", () => {
    const plan = buildBrowserLaunchPlan("win32", undefined, null, [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ]);

    expect(plan).toEqual([
      { label: "Google Chrome", channel: "chrome" },
      {
        label: "Brave executable",
        executablePath: "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      },
    ]);
  });

  test("honors an explicit browser path first without duplicate fallback entries", () => {
    const configured = "C:\\Browsers\\chrome.exe";
    const plan = buildBrowserLaunchPlan("win32", "c:\\browsers\\CHROME.EXE", null, [configured]);

    expect(plan[0]).toEqual({ label: "configured browser", executablePath: configured });
    expect(plan.filter((target) => target.executablePath === configured)).toHaveLength(1);
  });

  test("puts an explicit Cybara browser path first", () => {
    const candidates = browserExecutableCandidates("linux", {
      CYBARA_BROWSER_PATH: "/opt/cybara/chrome",
    });

    expect(candidates[0]).toBe("/opt/cybara/chrome");
  });

  test("keeps the Chromium sandbox enabled on desktop platforms", () => {
    expect(browserLaunchArgs("win32", {})).not.toContain("--no-sandbox");
    expect(browserLaunchArgs("darwin", {})).not.toContain("--no-sandbox");
    expect(browserLaunchArgs("linux", {})).not.toContain("--no-sandbox");
    expect(browserLaunchArgs("darwin", {})).toEqual([]);
    expect(browserLaunchArgs("linux", {})).toContain("--disable-dev-shm-usage");
  });

  test("suppresses phantom windows and Edge first-run UI on Windows", () => {
    const args = browserLaunchArgs("win32", {});
    expect(args).toContain("--enable-gpu");
    expect(args).not.toContain("--disable-gpu");
    expect(args).not.toContain("--disable-software-rasterizer");
    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
    expect(args).toContain("--window-position=-32000,-32000");
  });

  test("allows an explicit Linux container sandbox override", () => {
    expect(browserLaunchArgs("linux", { CYBARA_BROWSER_DISABLE_SANDBOX: "true" })).toContain(
      "--no-sandbox"
    );
  });
});

describe("stripWindowsLongPathPrefix", () => {
  test("strips the \\\\?\\ long-path prefix from Windows resource dirs", () => {
    expect(stripWindowsLongPathPrefix("\\\\?\\C:\\Program Files\\Cybara\\resources")).toBe(
      "C:\\Program Files\\Cybara\\resources"
    );
  });

  test("rewrites UNC long paths to standard UNC form", () => {
    expect(stripWindowsLongPathPrefix("\\\\?\\UNC\\server\\share\\Cybara")).toBe(
      "\\\\server\\share\\Cybara"
    );
  });

  test("leaves normal paths untouched", () => {
    expect(stripWindowsLongPathPrefix("C:\\Cybara\\resources")).toBe("C:\\Cybara\\resources");
    expect(stripWindowsLongPathPrefix("/Applications/Cybara.app/Contents/Resources")).toBe(
      "/Applications/Cybara.app/Contents/Resources"
    );
  });
});

describe("hermetic Playwright browser discovery", () => {
  test("selects a packaged Playwright browser before loading the runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-playwright-runtime-"));
    const browserRoot = join(root, "node_modules", "playwright-core", ".local-browsers");
    const env: NodeJS.ProcessEnv = {};
    try {
      mkdirSync(join(browserRoot, "chromium_headless_shell-1"), { recursive: true });

      expect(findHermeticPlaywrightBrowserPath([root])).toBe(browserRoot);
      expect(configureHermeticPlaywrightBrowserPath([root], env)).toBe(browserRoot);
      expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not replace an explicitly configured browser cache", () => {
    const env: NodeJS.ProcessEnv = { PLAYWRIGHT_BROWSERS_PATH: "C:\\shared-browsers" };

    expect(configureHermeticPlaywrightBrowserPath([], env)).toBeNull();
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("C:\\shared-browsers");
  });
});
