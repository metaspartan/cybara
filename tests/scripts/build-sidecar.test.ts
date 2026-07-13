import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  copyFilePortable,
  copyTransformersRuntime,
  findBundledWindowsPlaywrightRuntime,
  findOnnxRuntimeNativeDir,
  findWindowsPlaywrightBrowserExecutable,
  getHostTargetFor,
  getRuntimeTargetFor,
  getSharpRuntimePackageNames,
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

      expect(findOnnxRuntimeNativeDir(root, { platform: "linux", arch: "x64" })).toBe(currentDir);
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

  test("sharp runtime package selection is scoped to the release target architecture", () => {
    expect(getSharpRuntimePackageNames({ platform: "darwin", arch: "arm64" })).toEqual([
      "@img/sharp-darwin-arm64",
      "@img/sharp-libvips-darwin-arm64",
    ]);
    expect(getSharpRuntimePackageNames({ platform: "darwin", arch: "x64" })).toEqual([
      "@img/sharp-darwin-x64",
      "@img/sharp-libvips-darwin-x64",
    ]);
    expect(getSharpRuntimePackageNames({ platform: "linux", arch: "x64" })).toEqual([
      "@img/sharp-linux-x64",
      "@img/sharp-libvips-linux-x64",
    ]);
    expect(getSharpRuntimePackageNames({ platform: "win32", arch: "x64" })).toEqual([
      "@img/sharp-win32-x64",
    ]);
  });

  test("packages sharp dependencies for the host speech runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-sharp-package-test-"));
    try {
      const runtimeTarget = getRuntimeTargetFor(getHostTargetFor(process.platform, process.arch));
      copyTransformersRuntime(dir, runtimeTarget);

      expect(existsSync(join(dir, "detect-libc", "package.json"))).toBe(true);
      expect(existsSync(join(dir, "@img", "colour", "package.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("packages the current Transformers ONNX runtime when Kokoro is also available", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-transformers-package-test-"));
    try {
      const runtimeTarget = getRuntimeTargetFor(getHostTargetFor(process.platform, process.arch));
      const nativeDir = copyTransformersRuntime(dir, runtimeTarget);
      const onnxPackage = JSON.parse(
        readFileSync(join(dir, "onnxruntime-node", "package.json"), "utf8")
      ) as { version: string };
      const sourceOnnxRoot = join(process.cwd(), "node_modules", "onnxruntime-node");
      const sourceOnnxPackage = JSON.parse(
        readFileSync(join(sourceOnnxRoot, "package.json"), "utf8")
      ) as { version: string };
      const sourceNativeDir = findOnnxRuntimeNativeDir(sourceOnnxRoot, runtimeTarget);
      const packagedNativeDir = findOnnxRuntimeNativeDir(
        join(dir, "onnxruntime-node"),
        runtimeTarget
      );

      expect(onnxPackage.version).toBe(sourceOnnxPackage.version);
      expect(packagedNativeDir).not.toBeNull();
      expect(existsSync(join(packagedNativeDir ?? "missing", "onnxruntime_binding.node"))).toBe(
        true
      );
      expect(nativeDir).toBe(sourceNativeDir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  test("verifies the packaged Windows Playwright executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-playwright-package-test-"));
    const executable = join(
      dir,
      "node_modules",
      "playwright-core",
      ".local-browsers",
      "chromium_headless_shell-1234",
      "chrome-headless-shell-win64",
      "headless_shell.exe"
    );

    try {
      mkdirSync(join(executable, ".."), { recursive: true });
      writeFileSync(executable, "browser");
      expect(findWindowsPlaywrightBrowserExecutable(join(dir, "node_modules"))).toBe(executable);
      expect(findBundledWindowsPlaywrightRuntime(dir)).toBe(executable);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null (non-fatal) when no bundled Playwright browser is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-playwright-package-test-"));
    try {
      expect(findBundledWindowsPlaywrightRuntime(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("packages Kokoro with its compatible Transformers and Windows ONNX runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-kokoro-package-test-"));
    try {
      const nativeDir = copyTransformersRuntime(dir, { platform: "win32", arch: "x64" });
      const kokoroPackage = JSON.parse(
        readFileSync(join(dir, "kokoro-js", "package.json"), "utf8")
      ) as { version: string };
      const transformerPackage = JSON.parse(
        readFileSync(
          join(dir, "kokoro-js", "node_modules", "@huggingface", "transformers", "package.json"),
          "utf8"
        )
      ) as { version: string };

      expect(kokoroPackage.version).toBe("1.2.1");
      expect(transformerPackage.version.startsWith("3.")).toBe(true);
      expect(
        existsSync(
          join(
            dir,
            "kokoro-js",
            "node_modules",
            "@huggingface",
            "transformers",
            "node_modules",
            "onnxruntime-node",
            "bin",
            "napi-v3",
            "win32",
            "x64",
            "onnxruntime_binding.node"
          )
        )
      ).toBe(true);
      expect(existsSync(join(dir, "phonemizer", "dist", "phonemizer.js"))).toBe(true);
      const onnxCommonPackage = JSON.parse(
        readFileSync(
          join(
            dir,
            "kokoro-js",
            "node_modules",
            "@huggingface",
            "transformers",
            "node_modules",
            "onnxruntime-node",
            "node_modules",
            "onnxruntime-common",
            "package.json"
          ),
          "utf8"
        )
      ) as { version: string };
      expect(onnxCommonPackage.version).toBe("1.21.0");
      expect(nativeDir?.replace(/\\/g, "/")).toContain("/win32/x64");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("deduplicates packaged speech download progress events", () => {
    const worker = readFileSync(
      join(process.cwd(), "src", "core", "local-speech-worker.mjs"),
      "utf8"
    );
    expect(worker).toContain("progressByRequest.get(id) === progress");
    expect(worker).toContain("progressByRequest.delete(request.id)");
  });

  test("stages the same UI beside every generated sidecar", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "build-sidecar.ts"), "utf8");
    expect(source).toContain("[RELEASE_DIR, TAURI_BIN_DIR, tauriDebugDir]");
    expect(source).toContain('const targetUiDist = join(targetBase, "ui", "dist")');
  });
});
