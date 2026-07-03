import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  copyFilePortable,
  findOnnxRuntimeNativeDir,
  getHostTargetFor,
  getRuntimeTargetFor,
  patchedOnnxBindingSource,
} from "../../scripts/build-sidecar";

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

  test("maps sidecar build targets to Node runtime platform names", () => {
    expect(
      getRuntimeTargetFor({
        bunTarget: "bun-windows-x64",
        tauriSuffix: "x86_64-pc-windows-msvc",
      })
    ).toEqual({ platform: "win32", arch: "x64" });
    expect(
      getRuntimeTargetFor({
        bunTarget: "bun-linux-arm64",
        tauriSuffix: "aarch64-unknown-linux-gnu",
      })
    ).toEqual({ platform: "linux", arch: "arm64" });
    expect(
      getRuntimeTargetFor({
        bunTarget: "bun-darwin-x64",
        tauriSuffix: "x86_64-apple-darwin",
      })
    ).toEqual({ platform: "darwin", arch: "x64" });
  });

  test("discovers ONNX Runtime native bindings from the shipped napi directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-onnx-runtime-test-"));
    try {
      const root = join(dir, "onnxruntime-node");
      const oldDir = join(root, "bin", "napi-v3", "linux", "x64");
      const currentDir = join(root, "bin", "napi-v6", "linux", "x64");
      mkdirSync(oldDir, { recursive: true });
      mkdirSync(currentDir, { recursive: true });
      writeFileSync(join(oldDir, "onnxruntime_binding.node"), "old");
      writeFileSync(join(currentDir, "onnxruntime_binding.node"), "current");

      expect(findOnnxRuntimeNativeDir(root, { platform: "linux", arch: "x64" })).toBe(
        currentDir
      );
      expect(findOnnxRuntimeNativeDir(root, { platform: "darwin", arch: "x64" })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("patched ONNX binding resolves dynamic napi directories and packaged resources", () => {
    const source = patchedOnnxBindingSource();

    expect(source).toContain("napi-v\\d+");
    expect(source).toContain("CYBARA_RESOURCE_DIR");
    expect(source).toContain("process.platform");
    expect(source).toContain("process.arch");
    expect(source).not.toContain('path.join("..", "bin", "napi-v3"');
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
