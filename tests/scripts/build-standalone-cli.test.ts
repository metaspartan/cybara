import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createStandaloneAssetsSource,
  createStandaloneEntrySource,
  standaloneCliBuildArgs,
} from "../../scripts/build-standalone-cli";

describe("standalone CLI build", () => {
  test("uses the embedded entrypoint for every released OS and architecture", () => {
    const targets = [
      ["bun-darwin-x64", "cybara-darwin-x64"],
      ["bun-darwin-arm64", "cybara-darwin-arm64"],
      ["bun-linux-x64", "cybara-linux-x64"],
      ["bun-linux-arm64", "cybara-linux-arm64"],
      ["bun-windows-x64", "cybara-windows-x64.exe"],
      ["bun-windows-arm64", "cybara-windows-arm64.exe"],
    ] as const;

    for (const [target, outfile] of targets) {
      const args = standaloneCliBuildArgs(target, outfile, ".cybara-standalone-entry.ts");
      expect(args).toContain(".cybara-standalone-entry.ts");
      expect(args).toContain(`--target=${target}`);
      expect(args).toContain(`--outfile=${outfile}`);
      expect(args).toContain("@huggingface/transformers");
      expect(args).toContain("kokoro-js");
      expect(args).toContain("onnxruntime-node");
      expect(args).toContain("onnxruntime-web");
      expect(args).not.toContain("tiny-secp256k1");
    }
  });

  test("generates an entrypoint containing the complete production UI", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-standalone-entry-"));
    const uiDir = join(directory, "ui", "dist");
    mkdirSync(join(uiDir, "assets"), { recursive: true });
    writeFileSync(join(uiDir, "index.html"), '<script src="/assets/app.js"></script>');
    writeFileSync(join(uiDir, "assets", "app.js"), "console.log('cybara')");

    try {
      const assetsModule = join(directory, ".cybara-assets.ts");
      const runtimeEntry = join(directory, ".cybara-runtime.js");
      const transformersWorker = join(directory, ".cybara-transformers-worker.mjs");
      const assetsSource = createStandaloneAssetsSource({
        cwd: directory,
        uiDir,
        runtimeEntry,
        transformersWorker,
      });
      expect(assetsSource).toContain('with { type: "file" }');
      expect(assetsSource).toContain('"/assets/app.js"');
      expect(assetsSource).toContain("__CYBARA_EMBEDDED_UI__");
      expect(assetsSource).toContain("__CYBARA_RUNTIME_ASSETS__");
      expect(assetsSource).toContain('import embeddedRuntimeEntry from "./.cybara-runtime.js"');
      expect(assetsSource).toContain("await import(embeddedRuntimeEntry)");

      const source = createStandaloneEntrySource({
        cwd: directory,
        uiDir,
        assetsModule,
        version: "1.2.3",
      });
      expect(source).toContain('command === "--version"');
      expect(source).toContain('"1.2.3"');
      expect(source).toContain('await import("./.cybara-assets.ts")');
      expect(source).not.toContain('with { type: "file" }');

      const sidecarAssetsSource = createStandaloneAssetsSource({
        cwd: directory,
        uiDir,
        runtimeEntry: join(directory, "src", "index.js"),
      });
      expect(sidecarAssetsSource).toContain('from "./src/index.js"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
