import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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

  test("file-scoped search and replacement never include sibling files", async () => {
    const root = createWorkspace(2);
    const selectedFile = join(root, "file-0.txt");
    const siblingFile = join(root, "file-1.txt");

    const search = await searchWorkspace(selectedFile, "needle");
    expect(search.success).toBe(true);
    expect(search.path).toBe(selectedFile);
    expect(search.filesScanned).toBe(1);
    expect(search.files.map((file) => file.file)).toEqual([selectedFile]);

    const listed = await listWorkspaceFiles(selectedFile);
    expect(listed.files).toEqual([{ path: selectedFile, relativePath: "file-0.txt" }]);

    const applied = await replaceInWorkspace(selectedFile, "needle", "done");
    expect(applied.changedFiles).toEqual([{ file: selectedFile, replacements: 1 }]);
    expect(readFileSync(selectedFile, "utf-8")).toContain("done");
    expect(readFileSync(siblingFile, "utf-8")).toContain("needle");
  });
});
