import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createStandaloneEntrySource,
  standaloneCliBuildArgs,
} from "../../scripts/build-standalone-cli";

describe("standalone CLI build", () => {
  test("keeps architecture-specific ML runtimes external", () => {
    const args = standaloneCliBuildArgs("bun-darwin-x64", "cybara-darwin-x64");

    expect(args).toContain("--target=bun-darwin-x64");
    expect(args).toContain("--outfile=cybara-darwin-x64");
    expect(args).toContain("@huggingface/transformers");
    expect(args).toContain("kokoro-js");
    expect(args).toContain("onnxruntime-node");
    expect(args).toContain("onnxruntime-web");
    expect(args).not.toContain("tiny-secp256k1");
  });

  test("generates an entrypoint containing the complete production UI", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-standalone-entry-"));
    const uiDir = join(directory, "ui", "dist");
    mkdirSync(join(uiDir, "assets"), { recursive: true });
    writeFileSync(join(uiDir, "index.html"), '<script src="/assets/app.js"></script>');
    writeFileSync(join(uiDir, "assets", "app.js"), "console.log('cybara')");

    try {
      const source = createStandaloneEntrySource({ cwd: directory, uiDir });
      expect(source).toContain('with { type: "file" }');
      expect(source).toContain('"/assets/app.js"');
      expect(source).toContain("__CYBARA_EMBEDDED_UI__");
      expect(source).toContain('await import("./src/main.ts")');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
