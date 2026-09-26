import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  defaultNativeModuleRuntimeProbe,
  isLibraryValidationFailure,
  LIBRARY_VALIDATION_HINT,
  nativeModuleProbeCacheKey,
  resolveNativeModulesRuntime,
  resetNativeModuleRuntimeCacheForTests,
} from "../../src/core/native-module-runtime";

const sidecarScript = readFileSync(
  fileURLToPath(new URL("../../scripts/codesign-tauri-sidecar-runtime.ts", import.meta.url)),
  "utf8"
);
const entitlements = readFileSync(
  fileURLToPath(new URL("../../src-tauri/sidecar-runtime.entitlements.plist", import.meta.url)),
  "utf8"
);

describe("library validation failure detection", () => {
  test("recognizes hardened-runtime Team ID dlopen failures", () => {
    expect(
      isLibraryValidationFailure(
        "ERR_DLOPEN_FAILED: dlopen(.../sharp-darwin-arm64.node): code signature in <ID> not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs"
      )
    ).toBe(true);
    expect(
      isLibraryValidationFailure(
        "dlopen(.../onnxruntime_binding.node): ... have different Team IDs"
      )
    ).toBe(true);
  });

  test("leaves unrelated load failures unclassified", () => {
    expect(isLibraryValidationFailure("Module not found: sharp")).toBe(false);
    expect(isLibraryValidationFailure("")).toBe(false);
  });
});

describe("native modules runtime resolver", () => {
  test("returns the preferred runtime when it probes clean", async () => {
    resetNativeModuleRuntimeCacheForTests();
    let alternatesProbed = 0;
    const runtimePath = await resolveNativeModulesRuntime(
      () => "/preferred/bun",
      () => {
        alternatesProbed += 1;
        return ["/fallback/bun"];
      },
      "/runtime/dir",
      async (candidate) => ({
        runtimePath: candidate,
        ok: candidate === "/preferred/bun",
        errorText: "",
      })
    );
    expect(runtimePath).toBe("/preferred/bun");
    expect(alternatesProbed).toBe(0);
  });

  test("falls back when the preferred runtime fails library validation", async () => {
    resetNativeModuleRuntimeCacheForTests();
    const probed: string[] = [];
    const runtimePath = await resolveNativeModulesRuntime(
      () => "/Applications/Cybara.app/runtime/bun",
      () => ["/Applications/Cybara.app/runtime/bun", "/Users/x/.bun/bin/bun"],
      "/runtime/dir",
      async (candidate) => {
        probed.push(candidate);
        const ok = candidate === "/Users/x/.bun/bin/bun";
        return {
          runtimePath: candidate,
          ok,
          errorText: ok ? "" : "ERR_DLOPEN_FAILED: different Team IDs",
        };
      }
    );
    expect(runtimePath).toBe("/Users/x/.bun/bin/bun");
    expect(probed[0]).toBe("/Applications/Cybara.app/runtime/bun");
  });

  test("caches probe results per runtime and runtime dir", async () => {
    resetNativeModuleRuntimeCacheForTests();
    let probeCalls = 0;
    const probe = async (runtimePath: string) => {
      probeCalls += 1;
      return { runtimePath, ok: true, errorText: "" };
    };
    const runtimeDir = "/cache/dir";
    await resolveNativeModulesRuntime(
      () => "/a/bun",
      () => ["/a/bun"],
      runtimeDir,
      probe
    );
    await resolveNativeModulesRuntime(
      () => "/a/bun",
      () => ["/a/bun"],
      runtimeDir,
      probe
    );
    expect(probeCalls).toBe(1);
    expect(nativeModuleProbeCacheKey("/a/bun", runtimeDir)).toBe(`/a/bun::${runtimeDir}`);
  });

  test("raises the hardened-runtime remedy when every candidate fails validation", async () => {
    resetNativeModuleRuntimeCacheForTests();
    let caught: Error | null = null;
    try {
      await resolveNativeModulesRuntime(
        () => "/signed/bun",
        () => ["/signed/bun"],
        "/runtime/dir",
        async (runtimePath) => ({
          runtimePath,
          ok: false,
          errorText: "mapping process and mapped file (non-platform) have different Team IDs",
        })
      );
    } catch (error) {
      caught = error instanceof Error ? error : new Error(String(error));
    }
    expect(caught?.message).toContain("No JavaScript runtime could load the native modules");
    expect(caught?.message).toContain("disable-library-validation");
    expect(LIBRARY_VALIDATION_HINT).toContain("CYBARA_NATIVE_MODULES_RUNTIME");
  });

  test("surfaces plain probe errors verbatim when they are not validation failures", async () => {
    resetNativeModuleRuntimeCacheForTests();
    let caught: Error | null = null;
    try {
      await resolveNativeModulesRuntime(
        () => "/broken/bun",
        () => [],
        "/runtime/dir",
        async (runtimePath) => ({ runtimePath, ok: false, errorText: "runtime crashed on boot" })
      );
    } catch (error) {
      caught = error instanceof Error ? error : new Error(String(error));
    }
    expect(caught?.message).toContain("runtime crashed on boot");
    expect(caught?.message).not.toContain("disable-library-validation");
  });
});

describe("managed runtime default probe", () => {
  test("reports failures for missing runtimes without throwing", async () => {
    const result = await defaultNativeModuleRuntimeProbe(
      "/nonexistent/bun-binary",
      "/nonexistent/runtime-dir"
    );
    expect(result.ok).toBe(false);
    expect(result.errorText).toContain("runtime not found");
  });
});

describe("sidecar signing hardening", () => {
  test("sidecar runtime signing applies entitlements that disable library validation", () => {
    expect(sidecarScript).toContain("--entitlements");
    expect(sidecarScript).toContain("sidecar-runtime.entitlements.plist");
    expect(entitlements).toContain("com.apple.security.cs.disable-library-validation");
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
  });
});
