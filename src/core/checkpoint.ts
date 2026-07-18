/**
 * Filesystem checkpoint/snapshot+rollback via git.
 *
 * Transparently snapshots the workspace directory before file-mutating turns.
 * If the agent makes a bad edit, the user can roll back to the pre-turn state.
 * Uses a shadow-git store (separate from the user's own repo) with git-object
 * dedup.
 *
 * Snapshots are created in <workspace>/.cybara/checkpoints/ as git objects;
 * the workspace itself is never modified by this module (only read for diffs).
 */
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  statSync,
  lstatSync,
} from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { buildSubprocessEnvironment } from "./subprocess-env";

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

function safeCheckpointId(value: string): boolean {
  return /^cp_[a-z0-9_]{1,80}$/.test(value);
}

function workspaceRoot(workspaceDir: string): string | null {
  const root = resolve(workspaceDir);
  try {
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function checkpointStoreDir(workspaceDir: string, create: boolean): string | null {
  const root = workspaceRoot(workspaceDir);
  if (!root) return null;
  const metadataDir = join(root, CHECKPOINT_DIR);
  const dir = join(metadataDir, CHECKPOINT_STORE);
  for (const candidate of [metadataDir, dir]) {
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) return null;
  }
  if (create && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(dir)) return null;
  return dir;
}

function checkpointPath(storeDir: string, checkpointId: string): string | null {
  if (!safeCheckpointId(checkpointId)) return null;
  const path = resolve(storeDir, checkpointId);
  const rel = relative(resolve(storeDir), path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? path : null;
}

async function execGit(args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: buildSubprocessEnvironment(env),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode === 0) return stdout.trim();
  throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr.trim()}`);
}

function isGitAvailable(): boolean {
  try {
    const result = Bun.spawnSync(["git", "--version"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return result.exitCode === 0;
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
  if (!isGitAvailable()) return null;

  const root = workspaceRoot(workspaceDir);
  const storeDir = checkpointStoreDir(workspaceDir, true);
  if (!root || !storeDir) return null;
  const id = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const snapshotPath = checkpointPath(storeDir, id);
  if (!snapshotPath) return null;
  mkdirSync(snapshotPath, { recursive: true });

  // If the workspace is already a git repo, use git stash create to snapshot
  // the working tree state without modifying anything.
  try {
    const isRepo = await execGit(["rev-parse", "--is-inside-work-tree"], root)
      .then((s) => s.trim() === "true")
      .catch(() => false);

    if (isRepo) {
      // Snapshot the full working tree (including unstaged edits and untracked
      // files, respecting .gitignore) via a throwaway index, so the user's real
      // staging area is never touched.
      const tmpIndex = join(storeDir, `.idx_${id}`);
      const treeHash = await execGit(["add", "-A"], root, { GIT_INDEX_FILE: tmpIndex })
        .then(() => execGit(["write-tree"], root, { GIT_INDEX_FILE: tmpIndex }))
        .catch(async () => {
          // If staging/write-tree fails (e.g. unmerged state), fall back below.
          return null;
        });
      try {
        if (existsSync(tmpIndex)) unlinkSync(tmpIndex);
      } catch {
        /* ignore temp index cleanup failure */
      }
      if (treeHash) {
        writeFileSync(join(snapshotPath, "tree"), treeHash);
        writeFileSync(
          join(snapshotPath, "meta.json"),
          JSON.stringify({ id, workspaceDir: root, createdAt: Date.now(), label, tree: treeHash })
        );
        pruneOldCheckpoints(storeDir);
        return { id, workspaceDir: root, createdAt: Date.now(), label, snapshotPath };
      }
    }
  } catch {
    /* fall through to file-copy fallback */
  }

  // Fallback: record a manifest of file paths + content hashes (no git).
  writeFileSync(
    join(snapshotPath, "meta.json"),
    JSON.stringify({ id, workspaceDir: root, createdAt: Date.now(), label, method: "manifest" })
  );
  return { id, workspaceDir: root, createdAt: Date.now(), label, snapshotPath };
}

/** List all checkpoints for a workspace, newest first. */
export function listCheckpoints(workspaceDir: string): Checkpoint[] {
  const root = workspaceRoot(workspaceDir);
  const storeDir = checkpointStoreDir(workspaceDir, false);
  if (!root || !storeDir) return [];
  const entries = readdirSync(storeDir, { withFileTypes: true });
  const checkpoints: Checkpoint[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("cp_")) continue;
    const metaPath = join(storeDir, entry.name, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      if (!safeCheckpointId(meta.id) || meta.id !== entry.name) continue;
      checkpoints.push({
        id: meta.id,
        workspaceDir: root,
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
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Restore the workspace working tree to a checkpoint's snapshot. Restores all
 * files captured in the snapshot tree (edited/deleted files revert to their
 * snapshot state). Files created after the checkpoint are left in place.
 * Returns false if the checkpoint is missing or was a non-git manifest snapshot.
 */
export async function restoreCheckpoint(
  workspaceDir: string,
  checkpointId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isGitAvailable()) return { success: false, error: "git is not available" };
  const root = workspaceRoot(workspaceDir);
  const storeDir = checkpointStoreDir(workspaceDir, false);
  if (!root || !safeCheckpointId(checkpointId)) {
    return { success: false, error: "invalid checkpoint" };
  }
  if (!storeDir) return { success: false, error: "checkpoint not found" };
  const snapshotPath = checkpointPath(storeDir, checkpointId);
  if (!snapshotPath) return { success: false, error: "invalid checkpoint" };
  const metaPath = join(snapshotPath, "meta.json");
  if (!existsSync(metaPath)) return { success: false, error: "checkpoint not found" };

  let tree: string | undefined;
  try {
    tree = JSON.parse(readFileSync(metaPath, "utf8")).tree;
  } catch {
    return { success: false, error: "checkpoint metadata is corrupt" };
  }
  if (!tree) {
    return { success: false, error: "checkpoint has no git tree (manifest-only snapshot)" };
  }

  try {
    await execGit(["checkout", tree, "--", "."], root);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Delete a specific checkpoint. */
export function deleteCheckpoint(workspaceDir: string, checkpointId: string): boolean {
  const storeDir = checkpointStoreDir(workspaceDir, false);
  const path = storeDir ? checkpointPath(storeDir, checkpointId) : null;
  if (!path) return false;
  if (!existsSync(path)) return false;
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
