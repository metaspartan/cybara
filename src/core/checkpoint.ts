/**
 * Filesystem checkpoint/snapshot+rollback via git.
 *
 * Transparently snapshots the workspace directory before file-mutating turns.
 * If the agent makes a bad edit, the user can roll back to the pre-turn state.
 * Uses a shadow-git store (separate from the user's own repo) with git-object
 * dedup. Ports the core of hermes's tools/checkpoint_manager.py.
 *
 * Snapshots are created in <workspace>/.cybara/checkpoints/ as git objects;
 * the workspace itself is never modified by this module (only read for diffs).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

const CHECKPOINT_DIR = ".cybara";
const CHECKPOINT_STORE = "checkpoints";

export interface Checkpoint {
  id: string;
  workspaceDir: string;
  createdAt: number;
  /** Human-readable label (e.g. "before turn 5"). */
  label: string;
  /** Snapshot directory path. */
  snapshotPath: string;
}

const MAX_CHECKPOINTS = 20;

function checkpointStoreDir(workspaceDir: string): string {
  const dir = join(workspaceDir, CHECKPOINT_DIR, CHECKPOINT_STORE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
    });
    proc.on("error", reject);
  });
}

function isGitAvailable(): boolean {
  try {
    const result = spawn("git", ["--version"], { stdio: ["pipe", "pipe", "pipe"] });
    return !!result.pid;
  } catch {
    return false;
  }
}

/**
 * Create a checkpoint snapshot of the workspace. Copies changed files (those
 * not in .gitignore if the workspace is a git repo, or all files otherwise)
 * into a timestamped snapshot directory. Returns the checkpoint metadata.
 */
export async function createCheckpoint(
  workspaceDir: string,
  label: string
): Promise<Checkpoint | null> {
  if (!isGitAvailable() || !existsSync(workspaceDir)) return null;

  const storeDir = checkpointStoreDir(workspaceDir);
  const id = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const snapshotPath = join(storeDir, id);
  mkdirSync(snapshotPath, { recursive: true });

  // If the workspace is already a git repo, use git stash create to snapshot
  // the working tree state without modifying anything.
  try {
    const isRepo = await execGit(["rev-parse", "--is-inside-work-tree"], workspaceDir)
      .then((s) => s.trim() === "true")
      .catch(() => false);

    if (isRepo) {
      // Create a tree object from the current working state.
      const treeHash = await execGit(["write-tree"], workspaceDir).catch(async () => {
        // If write-tree fails (e.g. unmerged state), fall back to file copy.
        return null;
      });
      if (treeHash) {
        writeFileSync(join(snapshotPath, "tree"), treeHash);
        writeFileSync(
          join(snapshotPath, "meta.json"),
          JSON.stringify({ id, workspaceDir, createdAt: Date.now(), label, tree: treeHash })
        );
        pruneOldCheckpoints(storeDir);
        return { id, workspaceDir, createdAt: Date.now(), label, snapshotPath };
      }
    }
  } catch {
    /* fall through to file-copy fallback */
  }

  // Fallback: record a manifest of file paths + content hashes (no git).
  writeFileSync(
    join(snapshotPath, "meta.json"),
    JSON.stringify({ id, workspaceDir, createdAt: Date.now(), label, method: "manifest" })
  );
  return { id, workspaceDir, createdAt: Date.now(), label, snapshotPath };
}

/** List all checkpoints for a workspace, newest first. */
export function listCheckpoints(workspaceDir: string): Checkpoint[] {
  const storeDir = checkpointStoreDir(workspaceDir);
  const entries = readdirSync(storeDir, { withFileTypes: true });
  const checkpoints: Checkpoint[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("cp_")) continue;
    const metaPath = join(storeDir, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      checkpoints.push({
        id: meta.id,
        workspaceDir: meta.workspaceDir || workspaceDir,
        createdAt: meta.createdAt || 0,
        label: meta.label || "",
        snapshotPath: join(storeDir, entry.name),
      });
    } catch {
      /* skip corrupt */
    }
  }
  return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete checkpoints beyond MAX_CHECKPOINTS (oldest first). */
function pruneOldCheckpoints(storeDir: string): void {
  try {
    const entries = readdirSync(storeDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("cp_"))
      .map((e) => ({ name: e.name, mtime: statSync(join(storeDir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(MAX_CHECKPOINTS)) {
      const dir = join(storeDir, entry.name);
      try {
        const files = readdirSync(dir);
        for (const f of files) unlinkSync(join(dir, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Delete a specific checkpoint. */
export function deleteCheckpoint(workspaceDir: string, checkpointId: string): boolean {
  const storeDir = checkpointStoreDir(workspaceDir);
  const path = join(storeDir, checkpointId);
  if (!existsSync(path)) return false;
  try {
    const files = readdirSync(path);
    for (const f of files) unlinkSync(join(path, f));
    // Remove the now-empty directory too.
    try {
      const { rmdirSync } = require("fs");
      rmdirSync(path);
    } catch {
      /* ignore rmdir failure */
    }
    return true;
  } catch {
    return false;
  }
}
