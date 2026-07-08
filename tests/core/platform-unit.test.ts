import { describe, expect, test } from "bun:test";
import { arch as osArch, platform as osPlatform } from "os";
import { isAbsolute } from "path";
import {
  commandExists,
  getExecutableExtension,
  getHomeDir,
  getPathSeparator,
  getPlatformTarget,
  getShell,
  getWindowsShellCommand,
  getTempDir,
  isLinux,
  isMacOS,
  isWindows,
  normalizePath,
  type PlatformTarget,
} from "../../src/core/platform";

const VALID_TARGETS: PlatformTarget[] = [
  "darwin_arm64",
  "darwin_x64",
  "linux_x64",
  "linux_arm64",
  "win32_x64",
  "win32_arm64",
];

describe("platform detectors", () => {
  test("getPlatformTarget returns a known target or 'unsupported'", () => {
    const target = getPlatformTarget();
    expect([...VALID_TARGETS, "unsupported"]).toContain(target);
  });

  test("getPlatformTarget matches os.platform/os.arch", () => {
    const p = osPlatform();
    const a = osArch();
    const expected =
      p === "darwin" && a === "arm64"
        ? "darwin_arm64"
        : p === "darwin" && a === "x64"
          ? "darwin_x64"
          : p === "linux" && a === "x64"
            ? "linux_x64"
            : p === "linux" && a === "arm64"
              ? "linux_arm64"
              : p === "win32" && a === "x64"
                ? "win32_x64"
                : p === "win32" && a === "arm64"
                  ? "win32_arm64"
                  : "unsupported";
    expect(getPlatformTarget()).toBe(expected);
  });

  test("exactly one of the OS predicates is true", () => {
    const flags = [isWindows(), isMacOS(), isLinux()];
    const trueCount = flags.filter(Boolean).length;
    expect(trueCount).toBeLessThanOrEqual(1);
    if (["win32", "darwin", "linux"].includes(osPlatform())) {
      expect(trueCount).toBe(1);
    }
  });

  test("OS predicates agree with os.platform()", () => {
    expect(isWindows()).toBe(osPlatform() === "win32");
    expect(isMacOS()).toBe(osPlatform() === "darwin");
    expect(isLinux()).toBe(osPlatform() === "linux");
  });

  test("predicates are stable across repeated calls", () => {
    for (let i = 0; i < 100; i++) {
      expect(getPlatformTarget()).toBe(getPlatformTarget());
      expect(isWindows()).toBe(isWindows());
      expect(getShell()).toEqual(getShell());
    }
  });
});

describe("platform shell + path helpers", () => {
  test("getShell returns a 2-tuple appropriate for the OS", () => {
    const shell = getShell();
    expect(shell).toHaveLength(2);
    expect(shell).toEqual(isWindows() ? ["cmd", "/c"] : ["sh", "-c"]);
  });

  test("Windows shell command prefers PowerShell Core when available", () => {
    const shell = getWindowsShellCommand("Write-Output cybara", (cmd) => cmd === "pwsh");
    expect(shell).toEqual([
      "pwsh",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Write-Output cybara",
    ]);
  });

  test("Windows shell command falls back to Windows PowerShell then cmd", () => {
    expect(getWindowsShellCommand("Write-Output cybara", (cmd) => cmd === "powershell")[0]).toBe(
      "powershell"
    );
    expect(getWindowsShellCommand("echo cybara", () => false)).toEqual([
      "cmd.exe",
      "/d",
      "/s",
      "/c",
      "echo cybara",
    ]);
  });

  test("getPathSeparator matches convention", () => {
    expect(getPathSeparator()).toBe(isWindows() ? ";" : ":");
  });

  test("getExecutableExtension matches convention", () => {
    expect(getExecutableExtension()).toBe(isWindows() ? ".exe" : "");
  });

  test("normalizePath is identity on POSIX and backslash on Windows", () => {
    const input = "a/b/c";
    const out = normalizePath(input);
    if (isWindows()) {
      expect(out).toBe("a\\b\\c");
      expect(out.includes("/")).toBe(false);
    } else {
      expect(out).toBe(input);
    }
  });

  test("normalizePath never throws on odd inputs", () => {
    for (const s of ["", "/", "//", "a\\b", "  ", "x".repeat(5000), "日本/語"]) {
      expect(() => normalizePath(s)).not.toThrow();
    }
  });
});

describe("platform directory helpers", () => {
  test("getHomeDir returns a non-empty absolute path", () => {
    const home = getHomeDir();
    expect(typeof home).toBe("string");
    expect(home.length).toBeGreaterThan(0);
    expect(isAbsolute(home)).toBe(true);
  });

  test("getTempDir returns a non-empty absolute path", () => {
    const tmp = getTempDir();
    expect(typeof tmp).toBe("string");
    expect(tmp.length).toBeGreaterThan(0);
    expect(isAbsolute(tmp)).toBe(true);
  });

  test("directory helpers never throw", () => {
    expect(() => getHomeDir()).not.toThrow();
    expect(() => getTempDir()).not.toThrow();
  });
});

describe("platform commandExists", () => {
  test("returns a boolean and never throws", () => {
    expect(typeof commandExists("definitely-not-a-real-command-xyz")).toBe("boolean");
    expect(commandExists("definitely-not-a-real-command-xyz")).toBe(false);
  });

  test("finds a command that exists on this host", () => {
    const known = isWindows() ? "cmd" : "sh";
    expect(commandExists(known)).toBe(true);
  });

  test("garbage / injection-looking names do not throw", () => {
    for (const s of ["", "  ", "; rm -rf /", "a b c", "$(echo hi)", "\n\t"]) {
      expect(() => commandExists(s)).not.toThrow();
    }
  });
});
