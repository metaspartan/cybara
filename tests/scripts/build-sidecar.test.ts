import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { copyFilePortable, getHostTargetFor } from "../../scripts/build-sidecar";

describe("build-sidecar host target mapping", () => {
  test("maps darwin/arm64", () => {
    expect(getHostTargetFor("darwin", "arm64")).toEqual({
      bunTarget: "bun-darwin-arm64",
      tauriSuffix: "aarch64-apple-darwin",
    });
  });

  test("maps darwin/x64", () => {
    expect(getHostTargetFor("darwin", "x64")).toEqual({
      bunTarget: "bun-darwin-x64",
      tauriSuffix: "x86_64-apple-darwin",
    });
  });

  test("maps linux/x64", () => {
    expect(getHostTargetFor("linux", "x64")).toEqual({
      bunTarget: "bun-linux-x64",
      tauriSuffix: "x86_64-unknown-linux-gnu",
    });
  });

  test("maps linux/arm64", () => {
    expect(getHostTargetFor("linux", "arm64")).toEqual({
      bunTarget: "bun-linux-arm64",
      tauriSuffix: "aarch64-unknown-linux-gnu",
    });
  });

  test("maps win32/x64", () => {
    expect(getHostTargetFor("win32", "x64")).toEqual({
      bunTarget: "bun-windows-x64",
      tauriSuffix: "x86_64-pc-windows-msvc",
    });
  });

  test("maps win32/arm64", () => {
    expect(getHostTargetFor("win32", "arm64")).toEqual({
      bunTarget: "bun-windows-arm64",
      tauriSuffix: "aarch64-pc-windows-msvc",
    });
  });

  test("throws for unsupported platform/arch", () => {
    expect(() => getHostTargetFor("freebsd", "x64")).toThrow("Unsupported platform: freebsd/x64");
  });

  test("copyFilePortable copies sidecar binary in a cross-platform way", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-sidecar-test-"));
    const source = join(dir, "source.bin");
    const target = join(dir, "target.bin");
    const payload = "sidecar-bytes";

    try {
      writeFileSync(source, payload, "utf8");
      await copyFilePortable(source, target);
      expect(readFileSync(target, "utf8")).toBe(payload);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
