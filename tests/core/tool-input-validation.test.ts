import { describe, expect, test } from "bun:test";
import { handleFileSearch, handleGrep, handleRead } from "../../src/core/tools/handlers/file";
import { handleExec } from "../../src/core/tools/handlers/process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

describe("Tool input validation", () => {
  test("exec returns structured validation output when command is missing", async () => {
    const result = await handleExec({});

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("command is required");
  });

  test("file_search returns structured validation output when pattern is missing", async () => {
    const result = await handleFileSearch({});

    expect(result.files).toHaveLength(0);
    expect(result.error).toContain("pattern is required");
  });

  test("read returns explicit validation error when path is missing", async () => {
    await expect(handleRead({})).rejects.toThrow("Validation error: path is required");
  });

  test("read summarizes images without returning binary bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-image-read-"));
    try {
      const path = join(dir, "capture.png");
      const bytes = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bytes);
      bytes.writeUInt32BE(1920, 16);
      bytes.writeUInt32BE(1080, 20);
      writeFileSync(path, bytes);

      const result = await handleRead({ path });

      expect(result.content).toContain("Media type: image/png");
      expect(result.content).toContain("Dimensions: 1920x1080");
      expect(result.content.length).toBeLessThan(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file_search blocks sensitive search roots and filters sensitive matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-file-search-"));
    try {
      writeFileSync(join(dir, ".env"), "SECRET_TOKEN=abc", "utf8");
      writeFileSync(join(dir, "notes.txt"), "hello", "utf8");

      await expect(handleFileSearch({ pattern: "*", cwd: `${homedir()}/.ssh` })).rejects.toThrow(
        "reading this path is blocked"
      );

      const result = await handleFileSearch({ pattern: ".env", cwd: dir });
      expect(result.files).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("grep does not return matches from sensitive files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cybara-grep-"));
    try {
      writeFileSync(join(dir, ".env"), "SECRET_TOKEN=abc", "utf8");
      writeFileSync(join(dir, "notes.txt"), "ordinary content", "utf8");

      const result = await handleGrep({ pattern: "SECRET_TOKEN", path: dir, recursive: false });
      expect(result.results).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
