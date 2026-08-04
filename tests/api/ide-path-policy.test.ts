import { describe, expect, test } from "bun:test";
import {
  isPathWithinIdeRootForPlatform,
  normalizeIdePathForPlatform,
  resolveAllowedIdePath,
  resolveIdeUserHome,
} from "../../src/api/ide-path-policy";
import { checkWritePath } from "../../src/core/tools/path-policy";

describe("IDE path policy", () => {
  test("uses USERPROFILE for the Windows user boundary", () => {
    expect(
      resolveIdeUserHome(
        "win32",
        {
          HOME: "C:\\WINDOWS\\system32",
          USERPROFILE: "C:\\Users\\Carsen",
        },
        "C:\\WINDOWS\\system32"
      )
    ).toBe("C:\\Users\\Carsen");
  });

  test("falls back to HOMEDRIVE and HOMEPATH on Windows", () => {
    expect(
      resolveIdeUserHome(
        "win32",
        {
          HOMEDRIVE: "C:",
          HOMEPATH: "\\Users\\Carsen",
        },
        "C:\\WINDOWS\\system32"
      )
    ).toBe("C:\\Users\\Carsen");
  });

  test("normalizes Windows picker paths and file URLs", () => {
    const home = "C:\\Users\\Carsen";
    expect(normalizeIdePathForPlatform("C:/Users/Carsen/Documents", home, "win32")).toBe(
      "C:\\Users\\Carsen\\Documents"
    );
    expect(normalizeIdePathForPlatform("/C:/Users/Carsen/Documents", home, "win32")).toBe(
      "C:\\Users\\Carsen\\Documents"
    );
    expect(normalizeIdePathForPlatform("\\\\?\\C:\\Users\\Carsen\\Documents", home, "win32")).toBe(
      "C:\\Users\\Carsen\\Documents"
    );
    expect(
      normalizeIdePathForPlatform("file:///C:/Users/Carsen/My%20Project/main.ts", home, "win32")
    ).toBe("C:\\Users\\Carsen\\My Project\\main.ts");
  });

  test("accepts Windows children case-insensitively and rejects escapes", () => {
    const home = "C:\\Users\\Carsen";
    expect(
      isPathWithinIdeRootForPlatform(home, "c:\\users\\carsen\\Documents\\project", "win32")
    ).toBe(true);
    expect(
      isPathWithinIdeRootForPlatform(home, "C:\\Users\\Carsen-other\\Documents", "win32")
    ).toBe(false);
    expect(isPathWithinIdeRootForPlatform(home, "D:\\Projects", "win32")).toBe(false);
    expect(isPathWithinIdeRootForPlatform(home, "C:\\Windows\\System32", "win32")).toBe(false);
  });

  test("rejects empty and null-byte paths", () => {
    expect(resolveAllowedIdePath("")).toBeNull();
    expect(resolveAllowedIdePath(`${process.cwd()}\0suffix`)).toBeNull();
  });

  test("allows dotfiles like .env that the agent tool policy blocks", () => {
    const envPath = `${process.cwd()}/.env`;
    expect(resolveAllowedIdePath(envPath)).toBe(envPath);
    expect(resolveAllowedIdePath(`${process.cwd()}/.env.local`)).toBe(
      `${process.cwd()}/.env.local`
    );
  });

  test("allows absolute paths outside the home directory", () => {
    const hosts = resolveAllowedIdePath("/etc/hosts");
    expect(hosts).not.toBeNull();
    expect(hosts?.endsWith("/etc/hosts")).toBe(true);
    expect(resolveAllowedIdePath("/tmp")).not.toBeNull();
  });

  test("the agent tool policy still refuses credential files", () => {
    const decision = checkWritePath(`${process.cwd()}/.env`);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("sensitive-path");
  });
});
