import { describe, expect, test } from "bun:test";
import {
  isPathWithinIdeRootForPlatform,
  normalizeIdePathForPlatform,
  resolveAllowedIdePath,
  resolveIdeUserHome,
} from "../../src/api/ide-path-policy";

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
});
