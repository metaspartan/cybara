import { spawn } from "bun";
import { dirname } from "path";

export interface GitStatus {
  isRepo: boolean;
  root?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  staged: string[];
  modified: string[];
  untracked: string[];
  ignored: string[];
  error?: string;
}

export interface GitDiff {
  success: boolean;
  diff?: string;
  error?: string;
}

interface GitStatusOptions {
  lightweight?: boolean;
}

const GIT_ROOT_CACHE_TTL_MS = 5000;
const GIT_STATUS_CACHE_TTL_MS = 2000;

const gitRootCache = new Map<string, { value: string | null; expiresAt: number }>();
const gitStatusCache = new Map<string, { value: GitStatus; expiresAt: number }>();
const gitStatusInFlight = new Map<string, Promise<GitStatus>>();

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  try {
    const proc = spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    return {
      // trimEnd only: leading whitespace is significant in `git status
      // --porcelain` output (a worktree-modified file's line begins with a
      // space), so a full trim() would shift the status columns of the first
      // line and truncate its path.
      stdout: stdout.trimEnd(),
      stderr: stderr.trim(),
      success: exitCode === 0,
    };
  } catch (e) {
    return {
      stdout: "",
      stderr: String(e),
      success: false,
    };
  }
}

async function findGitRoot(path: string): Promise<string | null> {
  const cached = gitRootCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const result = await runGit(path, ["rev-parse", "--show-toplevel"]);
  const value = result.success ? result.stdout : null;
  gitRootCache.set(path, { value, expiresAt: Date.now() + GIT_ROOT_CACHE_TTL_MS });
  return value;
}

export async function getGitStatus(path: string, options?: GitStatusOptions): Promise<GitStatus> {
  const lightweight = options?.lightweight === true;
  const gitRoot = await findGitRoot(path);

  if (!gitRoot) {
    return {
      isRepo: false,
      staged: [],
      modified: [],
      untracked: [],
      ignored: [],
    };
  }

  const cacheKey = `${gitRoot}:${lightweight ? "light" : "full"}`;
  const cachedStatus = gitStatusCache.get(cacheKey);
  if (cachedStatus && cachedStatus.expiresAt > Date.now()) {
    return cachedStatus.value;
  }
  const inFlight = gitStatusInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<GitStatus> => {
    let branch: string | undefined;
    let ahead = 0;
    let behind = 0;

    if (!lightweight) {
      const branchResult = await runGit(gitRoot, ["branch", "--show-current"]);
      branch = branchResult.success ? branchResult.stdout : undefined;

      const trackingResult = await runGit(gitRoot, [
        "rev-list",
        "--left-right",
        "--count",
        "@{u}...HEAD",
      ]);
      if (trackingResult.success) {
        const [b, a] = trackingResult.stdout.split("\t").map(Number);
        behind = b || 0;
        ahead = a || 0;
      }
    }

    const statusResult = await runGit(gitRoot, [
      "status",
      "--porcelain",
      "--ignored",
      "--untracked-files=all",
    ]);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    const ignored: string[] = [];

    const normalizeStatusPath = (rawPath: string): string => {
      const withoutRename =
        rawPath.includes(" -> ") ? rawPath.slice(rawPath.lastIndexOf(" -> ") + 4) : rawPath;
      const unquoted =
        withoutRename.startsWith('"') && withoutRename.endsWith('"')
          ? withoutRename.slice(1, -1)
          : withoutRename;
      return unquoted.replaceAll("\\", "/");
    };

    if (statusResult.success && statusResult.stdout) {
      for (const line of statusResult.stdout.split("\n")) {
        if (!line) continue;
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = normalizeStatusPath(line.slice(3));

        if (indexStatus === "!" && workTreeStatus === "!") {
          ignored.push(filePath);
          continue;
        }

        if (indexStatus !== " " && indexStatus !== "?") {
          staged.push(filePath);
        }

        if (workTreeStatus === "M" || workTreeStatus === "D") {
          modified.push(filePath);
        }

        if (indexStatus === "?" && workTreeStatus === "?") {
          untracked.push(filePath);
        }
      }
    }

    const result: GitStatus = {
      isRepo: true,
      root: gitRoot,
      branch,
      ahead,
      behind,
      staged,
      modified,
      untracked,
      ignored,
    };
    gitStatusCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS,
    });
    return result;
  })();

  gitStatusInFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    gitStatusInFlight.delete(cacheKey);
  }
}

export async function getGitDiff(filePath: string, staged: boolean = false): Promise<GitDiff> {
  const dir = dirname(filePath);
  const gitRoot = await findGitRoot(dir);

  if (!gitRoot) {
    return { success: false, error: "Not a git repository" };
  }

  const args = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];

  const result = await runGit(gitRoot, args);

  if (!result.success) {
    return { success: false, error: result.stderr };
  }

  return {
    success: true,
    diff: result.stdout || "(No changes)",
  };
}

export async function getGitBranch(path: string): Promise<string | null> {
  const gitRoot = await findGitRoot(path);
  if (!gitRoot) return null;

  const result = await runGit(gitRoot, ["branch", "--show-current"]);
  return result.success ? result.stdout : null;
}
