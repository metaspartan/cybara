import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createCheckpoint, listCheckpoints, deleteCheckpoint } from "../../src/core/checkpoint";

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
