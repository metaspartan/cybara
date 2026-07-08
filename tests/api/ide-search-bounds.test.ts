import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  listWorkspaceFiles,
  previewReplaceInWorkspace,
  replaceInWorkspace,
  searchWorkspace,
} from "../../src/api/ide-api";

let workDir: string | null = null;

function createWorkspace(files: number): string {
  workDir = mkdtempSync(join(homedir(), ".cybara-ide-search-bounds-"));
  for (let index = 0; index < files; index += 1) {
    writeFileSync(join(workDir, `file-${index}.txt`), `needle ${index}\n`, "utf-8");
  }
  return workDir;
}

describe("IDE search scan bounds", () => {
  afterEach(() => {
    if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  });

  test("workspace search reports when the filesystem scan is capped", async () => {
    const root = createWorkspace(6);
    const result = await searchWorkspace(root, "needle", { maxFilesScanned: 3 });

    expect(result.success).toBe(true);
    expect(result.filesScanned).toBe(3);
    expect(result.scanTruncated).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBe(3);
  });

  test("quick-open fallback list reports scan caps separately from result caps", async () => {
    const root = createWorkspace(6);
    const result = await listWorkspaceFiles(root, {
      query: "file",
      limit: 10,
      maxFilesScanned: 2,
    });

    expect(result.success).toBe(true);
    expect(result.filesScanned).toBe(2);
    expect(result.scanTruncated).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalFiles).toBe(2);
  });

  test("replace preview and apply preserve bounded-scan metadata", async () => {
    const root = createWorkspace(5);
    const preview = await previewReplaceInWorkspace(root, "needle", "done", {
      maxFilesScanned: 2,
    });

    expect(preview.success).toBe(true);
    expect(preview.filesScanned).toBe(2);
    expect(preview.scanTruncated).toBe(true);
    expect(preview.truncated).toBe(true);
    expect(preview.totalReplacements).toBe(2);

    const applied = await replaceInWorkspace(root, "needle", "done", {
      maxFilesScanned: 2,
    });

    expect(applied.success).toBe(true);
    expect(applied.filesScanned).toBe(2);
    expect(applied.scanTruncated).toBe(true);
    expect(applied.truncated).toBe(true);
    expect(applied.totalReplacements).toBe(2);
  });
});
