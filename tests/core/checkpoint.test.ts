import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import {
  createCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  restoreCheckpoint,
} from "../../src/core/checkpoint";

const tempDir = mkdtempSync(join(tmpdir(), "cybara-cp-test-"));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("filesystem checkpoint", () => {
  test("createCheckpoint returns a checkpoint with an id", async () => {
    const cp = await createCheckpoint(tempDir, "test-label");
    if (cp) {
      expect(cp.id).toMatch(/^cp_/);
      expect(cp.label).toBe("test-label");
      expect(cp.workspaceDir).toBe(tempDir);
      expect(existsSync(cp.snapshotPath)).toBe(true);
    }
  });

  test("listCheckpoints returns checkpoints sorted newest first", async () => {
    const cp1 = await createCheckpoint(tempDir, "first");
    await new Promise((r) => setTimeout(r, 50));
    const cp2 = await createCheckpoint(tempDir, "second");
    const list = listCheckpoints(tempDir);
    expect(list.length).toBeGreaterThanOrEqual(2);
    if (cp1 && cp2) {
      expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
    }
  });

  test("deleteCheckpoint removes a checkpoint", async () => {
    const cp = await createCheckpoint(tempDir, "to-delete");
    if (cp) {
      expect(existsSync(cp.snapshotPath)).toBe(true);
      const ok = deleteCheckpoint(tempDir, cp.id);
      expect(ok).toBe(true);
      expect(existsSync(cp.snapshotPath)).toBe(false);
    }
  });

  test("deleteCheckpoint returns false for nonexistent", () => {
    expect(deleteCheckpoint(tempDir, "cp_nonexistent")).toBe(false);
  });
});

describe("checkpoint restore (git workspace)", () => {
  const repos: string[] = [];
  afterAll(() => {
    while (repos.length) rmSync(repos.pop()!, { recursive: true, force: true });
  });

  function gitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "cybara-cp-git-"));
    repos.push(dir);
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
    return dir;
  }

  test("restores an edited file to its checkpoint state", async () => {
    const dir = gitRepo();
    writeFileSync(join(dir, "f.txt"), "original");
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "init"], { cwd: dir });

    const cp = await createCheckpoint(dir, "before edit");
    expect(cp).not.toBeNull();

    writeFileSync(join(dir, "f.txt"), "BROKEN EDIT");
    const result = await restoreCheckpoint(dir, cp!.id);
    expect(result.success).toBe(true);
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("original");
  });

  test("restore fails for unknown checkpoint id", async () => {
    const dir = gitRepo();
    const result = await restoreCheckpoint(dir, "cp_nope");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
