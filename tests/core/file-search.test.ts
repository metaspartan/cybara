import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleFileSearch, handleGrep } from "../../src/core/tools/handlers/file";
import { searchFiles } from "../../src/core/tools/file-search";

describe("file search", () => {
  test("defaults to the active chat workspace", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-file-search-workspace-"));
    try {
      mkdirSync(join(directory, "config"));
      writeFileSync(join(directory, "config", "configuration.yaml"), "homeassistant:");

      const result = await handleFileSearch(
        { pattern: "**/configuration.yaml" },
        { agentId: "agent", workspaceDir: directory }
      );

      expect(result.cwd).toBe(directory);
      expect(result.files).toEqual(["config/configuration.yaml"]);
      expect(result.error).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("content search defaults to the active chat workspace", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-grep-workspace-"));
    try {
      writeFileSync(join(directory, "configuration.yaml"), "homeassistant:\n  enabled: true");

      const result = await handleGrep(
        { pattern: "homeassistant", recursive: true },
        { agentId: "agent", workspaceDir: directory }
      );

      expect(result.results.some((entry) => entry.path.endsWith("configuration.yaml"))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("does not follow directory symlinks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-file-search-symlink-"));
    const external = mkdtempSync(join(tmpdir(), "cybara-file-search-external-"));
    try {
      writeFileSync(join(external, "configuration.yaml"), "secret:");
      symlinkSync(external, join(directory, "linked"), "dir");

      const result = await searchFiles({ cwd: directory, pattern: "**/configuration.yaml" });

      expect(result.files).toEqual([]);
      expect(result.error).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  test("skips unreadable directories without failing accessible matches", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-file-search-unreadable-"));
    const unreadable = join(directory, "unreadable");
    try {
      mkdirSync(unreadable);
      writeFileSync(join(unreadable, "configuration.yaml"), "private:");
      writeFileSync(join(directory, "configuration.yaml"), "public:");
      chmodSync(unreadable, 0o000);

      const result = await searchFiles({ cwd: directory, pattern: "**/configuration.yaml" });

      expect(result.files).toEqual(["configuration.yaml"]);
      expect(result.error).toBeUndefined();
    } finally {
      chmodSync(unreadable, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("honors cancellation before starting", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await searchFiles({
      cwd: tmpdir(),
      pattern: "**/*",
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.files).toEqual([]);
  });

  test("bounds broad searches without blocking the caller", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-file-search-bounded-"));
    try {
      for (let group = 0; group < 20; group += 1) {
        const groupDir = join(directory, `group-${group}`);
        mkdirSync(groupDir);
        for (let file = 0; file < 20; file += 1) {
          writeFileSync(join(groupDir, `file-${file}.txt`), "value");
        }
      }

      let ticks = 0;
      const heartbeat = setInterval(() => {
        ticks += 1;
      }, 1);
      const result = await searchFiles({
        cwd: directory,
        pattern: "**/*.txt",
        maxEntries: 50,
        maxResults: 1_000,
      });
      clearInterval(heartbeat);

      expect(result.limitReached).toBe(true);
      expect(result.visitedEntries).toBeGreaterThan(50);
      expect(ticks).toBeGreaterThan(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
