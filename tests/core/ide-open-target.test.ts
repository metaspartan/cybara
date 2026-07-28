import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { buildIdeUrl, resolveIdeOpenTarget } from "../../src/core/ide-open-target";

describe("IDE open targets", () => {
  test("resolves workspace directories and file line suffixes", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-ide-target-"));
    try {
      const workspace = join(root, "workspace");
      const file = join(workspace, "main.ts");
      mkdirSync(workspace);
      writeFileSync(file, "export const value = 1;\n");

      expect(resolveIdeOpenTarget(workspace)).toEqual({ workspacePath: workspace });
      expect(resolveIdeOpenTarget("main.ts:17", { baseDir: workspace })).toEqual({
        path: file,
        line: 17,
      });
      expect(resolveIdeOpenTarget(pathToFileURL(file).toString())).toEqual({ path: file });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects missing targets", () => {
    expect(() => resolveIdeOpenTarget("/definitely/missing/cybara-file.ts")).toThrow(
      "IDE target does not exist"
    );
  });

  test("builds the canonical IDE route", () => {
    expect(buildIdeUrl("http://127.0.0.1:4269/", { path: "/workspace/main.ts", line: 8 })).toBe(
      "http://127.0.0.1:4269/ide?path=%2Fworkspace%2Fmain.ts&line=8"
    );
    expect(buildIdeUrl("http://127.0.0.1:4269", { workspacePath: "/workspace" })).toBe(
      "http://127.0.0.1:4269/ide?workspacePath=%2Fworkspace"
    );
  });
});
