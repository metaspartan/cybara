import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ensureManagedTransformersRuntime,
  isManagedTransformersRuntimeInstalled,
  managedTransformersEntry,
  managedTransformersRuntimeDir,
} from "../../src/core/memory/transformers-package-runtime";

function createRuntimeFiles(runtimeDir: string): void {
  const transformersEntry = managedTransformersEntry(runtimeDir);
  const onnxEntry = join(runtimeDir, "node_modules", "onnxruntime-node", "package.json");
  mkdirSync(dirname(transformersEntry), { recursive: true });
  mkdirSync(dirname(onnxEntry), { recursive: true });
  writeFileSync(transformersEntry, "export const pipeline = async () => null;\n");
  writeFileSync(onnxEntry, '{"name":"onnxruntime-node"}\n');
}

describe("managed Transformers.js runtime", () => {
  test("installs once into the configured Cybara home", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-transformers-runtime-"));
    let installs = 0;
    try {
      const installer = async (_runtimePath: string, destinationDir: string) => {
        installs += 1;
        createRuntimeFiles(destinationDir);
        return { exitCode: 0, stdout: "installed", stderr: "" };
      };
      const options = { rootDir: home, runtimePath: "/managed/bun", installer };
      const [first, second] = await Promise.all([
        ensureManagedTransformersRuntime(options),
        ensureManagedTransformersRuntime(options),
      ]);

      expect(first).toBe(managedTransformersRuntimeDir(home));
      expect(second).toBe(first);
      expect(installs).toBe(1);
      expect(isManagedTransformersRuntimeInstalled(first)).toBe(true);
      await ensureManagedTransformersRuntime(options);
      expect(installs).toBe(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("does not publish an incomplete install", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-transformers-runtime-"));
    try {
      await expect(
        ensureManagedTransformersRuntime({
          rootDir: home,
          runtimePath: "/managed/bun",
          installer: async () => ({
            exitCode: 0,
            stdout: "installed",
            stderr: "",
          }),
        })
      ).rejects.toThrow("without its runtime files");
      expect(isManagedTransformersRuntimeInstalled(managedTransformersRuntimeDir(home))).toBe(
        false
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("surfaces package manager failures without leaving a lock", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-transformers-runtime-"));
    let attempts = 0;
    try {
      const options = {
        rootDir: home,
        runtimePath: "/managed/bun",
        installer: async () => {
          attempts += 1;
          return { exitCode: 1, stdout: "", stderr: "network unavailable" };
        },
      };
      await expect(ensureManagedTransformersRuntime(options)).rejects.toThrow(
        "network unavailable"
      );
      await expect(ensureManagedTransformersRuntime(options)).rejects.toThrow(
        "network unavailable"
      );
      expect(attempts).toBe(2);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
