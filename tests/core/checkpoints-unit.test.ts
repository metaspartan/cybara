import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createCheckpoint,
  deleteCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
} from "../../src/core/checkpoint";

let baseDir = "";

function gitCmd(args: string[], cwd: string): void {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

function makeGitWorkspace(name: string): string {
  const ws = join(baseDir, name);
  mkdirSync(ws, { recursive: true });
  gitCmd(["init", "-q"], ws);
  writeFileSync(join(ws, ".gitignore"), ".cybara/\n");
  return ws;
}

function stageAll(ws: string): void {
  gitCmd(["add", "-A"], ws);
}

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "cybara-checkpoint-"));
});

afterAll(() => {
  if (baseDir) rmSync(baseDir, { recursive: true, force: true });
});

describe("createCheckpoint + restoreCheckpoint round trip", () => {
  test("restores edited and deleted files, leaves new files in place", async () => {
    const ws = makeGitWorkspace("roundtrip");
    writeFileSync(join(ws, "edited.txt"), "original content\n");
    writeFileSync(join(ws, "deleted.txt"), "doomed content\n");
    stageAll(ws);

    const cp = await createCheckpoint(ws, "before turn 1");
    expect(cp).not.toBeNull();
    expect(cp?.label).toBe("before turn 1");
    expect(cp?.workspaceDir).toBe(ws);
    expect(existsSync(cp?.snapshotPath ?? "")).toBe(true);

    writeFileSync(join(ws, "edited.txt"), "mutated content\n");
    unlinkSync(join(ws, "deleted.txt"));
    writeFileSync(join(ws, "added-later.txt"), "new file\n");

    const result = await restoreCheckpoint(ws, cp!.id);
    expect(result.success).toBe(true);
    expect(readFileSync(join(ws, "edited.txt"), "utf8")).toBe("original content\n");
    expect(readFileSync(join(ws, "deleted.txt"), "utf8")).toBe("doomed content\n");
    expect(readFileSync(join(ws, "added-later.txt"), "utf8")).toBe("new file\n");
  });

  test("rollback is idempotent", async () => {
    const ws = makeGitWorkspace("idempotent");
    writeFileSync(join(ws, "f.txt"), "state-a");
    stageAll(ws);
    const cp = await createCheckpoint(ws, "cp");
    writeFileSync(join(ws, "f.txt"), "state-b");

    const first = await restoreCheckpoint(ws, cp!.id);
    expect(first.success).toBe(true);
    expect(readFileSync(join(ws, "f.txt"), "utf8")).toBe("state-a");

    const second = await restoreCheckpoint(ws, cp!.id);
    expect(second.success).toBe(true);
    expect(readFileSync(join(ws, "f.txt"), "utf8")).toBe("state-a");
  });

  test("multiple checkpoints restore to the right snapshot", async () => {
    const ws = makeGitWorkspace("multi");
    writeFileSync(join(ws, "state.txt"), "version-1");
    stageAll(ws);
    const cp1 = await createCheckpoint(ws, "v1");

    writeFileSync(join(ws, "state.txt"), "version-2");
    writeFileSync(join(ws, "extra.txt"), "only-in-v2");
    stageAll(ws);
    const cp2 = await createCheckpoint(ws, "v2");

    writeFileSync(join(ws, "state.txt"), "version-3-dirty");

    const back1 = await restoreCheckpoint(ws, cp1!.id);
    expect(back1.success).toBe(true);
    expect(readFileSync(join(ws, "state.txt"), "utf8")).toBe("version-1");

    const back2 = await restoreCheckpoint(ws, cp2!.id);
    expect(back2.success).toBe(true);
    expect(readFileSync(join(ws, "state.txt"), "utf8")).toBe("version-2");
    expect(readFileSync(join(ws, "extra.txt"), "utf8")).toBe("only-in-v2");
  });

  test("restores unicode filenames and nested directories exactly", async () => {
    const ws = makeGitWorkspace("unicode");
    mkdirSync(join(ws, "nested", "deep", "deeper"), { recursive: true });
    writeFileSync(join(ws, "日本語 ✓.txt"), "unicode-content-日本語");
    writeFileSync(join(ws, "nested", "deep", "deeper", "café.md"), "# café ünïcødé\n");
    stageAll(ws);
    const cp = await createCheckpoint(ws, "unicode");

    writeFileSync(join(ws, "日本語 ✓.txt"), "clobbered");
    unlinkSync(join(ws, "nested", "deep", "deeper", "café.md"));

    const result = await restoreCheckpoint(ws, cp!.id);
    expect(result.success).toBe(true);
    expect(readFileSync(join(ws, "日本語 ✓.txt"), "utf8")).toBe("unicode-content-日本語");
    expect(readFileSync(join(ws, "nested", "deep", "deeper", "café.md"), "utf8")).toBe(
      "# café ünïcødé\n"
    );
  });

  test("snapshots the full working tree, including unstaged edits", async () => {
    const ws = makeGitWorkspace("index-vs-worktree");
    writeFileSync(join(ws, "f.txt"), "staged-content");
    stageAll(ws);
    writeFileSync(join(ws, "f.txt"), "unstaged-edit-at-checkpoint-time");

    const cp = await createCheckpoint(ws, "cp");
    writeFileSync(join(ws, "f.txt"), "later-mutation");

    const result = await restoreCheckpoint(ws, cp!.id);
    expect(result.success).toBe(true);
    expect(readFileSync(join(ws, "f.txt"), "utf8")).toBe("unstaged-edit-at-checkpoint-time");
  });
});

describe("checkpoint edge cases", () => {
  test("checkpoint of an empty git workspace is created and listable", async () => {
    const ws = join(baseDir, "empty-repo");
    mkdirSync(ws, { recursive: true });
    gitCmd(["init", "-q"], ws);

    const cp = await createCheckpoint(ws, "empty");
    expect(cp).not.toBeNull();

    const listed = listCheckpoints(ws);
    expect(listed.map((c) => c.id)).toContain(cp!.id);

    const result = await restoreCheckpoint(ws, cp!.id);
    expect(typeof result.success).toBe("boolean");
  });

  test("non-git workspace falls back to manifest snapshot that cannot restore", async () => {
    const ws = join(baseDir, "plain-dir");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "f.txt"), "content");

    const cp = await createCheckpoint(ws, "manifest");
    expect(cp).not.toBeNull();
    const meta = JSON.parse(readFileSync(join(cp!.snapshotPath, "meta.json"), "utf8"));
    expect(meta.tree).toBeUndefined();

    const result = await restoreCheckpoint(ws, cp!.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("manifest");
  });

  test("nonexistent workspace returns null", async () => {
    const cp = await createCheckpoint(join(baseDir, "does-not-exist"), "x");
    expect(cp).toBeNull();
  });

  test("restoring an unknown checkpoint id fails cleanly", async () => {
    const ws = makeGitWorkspace("unknown-id");
    const result = await restoreCheckpoint(ws, "cp_nope");
    expect(result.success).toBe(false);
    expect(result.error).toBe("checkpoint not found");
  });

  test("corrupt meta.json is skipped by list and rejected by restore", async () => {
    const ws = makeGitWorkspace("corrupt");
    writeFileSync(join(ws, "f.txt"), "x");
    stageAll(ws);
    const good = await createCheckpoint(ws, "good");

    const badDir = join(ws, ".cybara", "checkpoints", "cp_corrupt");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "meta.json"), "{not json!!!");

    const listed = listCheckpoints(ws);
    expect(listed.map((c) => c.id)).toContain(good!.id);
    expect(listed.map((c) => c.id)).not.toContain("cp_corrupt");

    const result = await restoreCheckpoint(ws, "cp_corrupt");
    expect(result.success).toBe(false);
    expect(result.error).toBe("checkpoint metadata is corrupt");
  });
});

describe("listCheckpoints", () => {
  test("empty workspace store lists nothing", () => {
    const ws = join(baseDir, "list-empty");
    mkdirSync(ws, { recursive: true });
    expect(listCheckpoints(ws)).toEqual([]);
  });

  test("returns newest first with metadata", async () => {
    const ws = makeGitWorkspace("list-order");
    writeFileSync(join(ws, "f.txt"), "x");
    stageAll(ws);

    const cp1 = await createCheckpoint(ws, "first");
    await new Promise<void>((r) => setTimeout(r, 5));
    const cp2 = await createCheckpoint(ws, "second");

    const listed = listCheckpoints(ws);
    expect(listed.length).toBe(2);
    expect(listed[0].id).toBe(cp2!.id);
    expect(listed[1].id).toBe(cp1!.id);
    expect(listed[0].label).toBe("second");
    expect(listed[0].createdAt).toBeGreaterThanOrEqual(listed[1].createdAt);
    expect(listed[0].snapshotPath).toContain(join(".cybara", "checkpoints"));
  });

  test("caps listable checkpoints at 20 after pruning", async () => {
    const ws = makeGitWorkspace("prune");
    writeFileSync(join(ws, "f.txt"), "x");
    stageAll(ws);

    for (let i = 0; i < 25; i++) {
      const cp = await createCheckpoint(ws, `cp-${i}`);
      expect(cp).not.toBeNull();
    }

    const listed = listCheckpoints(ws);
    expect(listed.length).toBeLessThanOrEqual(20);
    expect(listed.length).toBeGreaterThan(0);

    const storeDir = join(ws, ".cybara", "checkpoints");
    const dirs = readdirSync(storeDir).filter((n) => n.startsWith("cp_"));
    expect(dirs.length).toBeLessThanOrEqual(20);
  });
});

describe("deleteCheckpoint", () => {
  test("deletes an existing checkpoint and reports missing ones", async () => {
    const ws = makeGitWorkspace("delete");
    writeFileSync(join(ws, "f.txt"), "x");
    stageAll(ws);
    const cp = await createCheckpoint(ws, "victim");

    expect(deleteCheckpoint(ws, cp!.id)).toBe(true);
    expect(listCheckpoints(ws).map((c) => c.id)).not.toContain(cp!.id);
    expect(existsSync(cp!.snapshotPath)).toBe(false);

    expect(deleteCheckpoint(ws, cp!.id)).toBe(false);
    expect(deleteCheckpoint(ws, "cp_never_existed")).toBe(false);
  });
});
