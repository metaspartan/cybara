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

export interface GitBranchSummary {
  name: string;
  current: boolean;
}

export interface GitBranchList {
  success: boolean;
  root?: string;
  current: string | null;
  branches: GitBranchSummary[];
  error?: string;
}

export interface GitBranchCheckoutResult {
  success: boolean;
  root?: string;
  branch?: string | null;
  error?: string;
}

interface GitStatusOptions {
  lightweight?: boolean;
}

const GIT_ROOT_CACHE_TTL_MS = 5000;
const GIT_STATUS_CACHE_TTL_MS = 2000;
const GIT_BRANCH_CACHE_TTL_MS = 1500;
const GIT_COMMAND_TIMEOUT_MS = 5000;

const gitRootCache = new Map<string, { value: string | null; expiresAt: number }>();
const gitStatusCache = new Map<string, { value: GitStatus; expiresAt: number }>();
const gitStatusInFlight = new Map<string, Promise<GitStatus>>();
const gitBranchListCache = new Map<string, { value: GitBranchList; expiresAt: number }>();

function clearGitCaches(): void {
  gitStatusCache.clear();
  gitStatusInFlight.clear();
  gitBranchListCache.clear();
}

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
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, GIT_COMMAND_TIMEOUT_MS);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).finally(() => clearTimeout(timeoutId));

    return {
      stdout: stdout.trimEnd(),
      stderr: timedOut ? "Git command timed out" : stderr.trim(),
      success: !timedOut && exitCode === 0,
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
      const withoutRename = rawPath.includes(" -> ")
        ? rawPath.slice(rawPath.lastIndexOf(" -> ") + 4)
        : rawPath;
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

function normalizeBranchName(branch: string): string {
  return branch.trim();
}

async function validateBranchName(gitRoot: string, branch: string): Promise<string | null> {
  const normalized = normalizeBranchName(branch);
  if (
    !normalized ||
    normalized.length > 200 ||
    normalized.startsWith("-") ||
    normalized === "HEAD" ||
    normalized.includes("\\") ||
    normalized.includes("//") ||
    normalized.includes("..") ||
    normalized.includes("@{") ||
    normalized.endsWith("/") ||
    normalized.endsWith(".") ||
    normalized.endsWith(".lock") ||
    /[\u0000-\u001f\u007f~^:?*[ \t]/.test(normalized)
  ) {
    return null;
  }

  const result = await runGit(gitRoot, ["check-ref-format", "--branch", normalized]);
  return result.success ? normalized : null;
}

export async function getGitBranches(path: string): Promise<GitBranchList> {
  const gitRoot = await findGitRoot(path);
  if (!gitRoot) {
    return { success: false, current: null, branches: [], error: "Not a git repository" };
  }

  const cached = gitBranchListCache.get(gitRoot);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const branchesResult = await runGit(gitRoot, [
    "for-each-ref",
    "--format=%(HEAD)%09%(refname:short)",
    "refs/heads",
  ]);

  if (!branchesResult.success) {
    return {
      success: false,
      root: gitRoot,
      current: await getGitBranch(gitRoot),
      branches: [],
      error: branchesResult.stderr || "Failed to list git branches",
    };
  }

  const parsed = branchesResult.stdout
    .split("\n")
    .map((line) => {
      const [marker = "", name = ""] = line.split("\t");
      const trimmed = name.trim();
      if (!trimmed) return null;
      return { name: trimmed, current: marker.trim() === "*" };
    })
    .filter((branch): branch is GitBranchSummary => branch !== null);
  const current = parsed.find((branch) => branch.current)?.name || null;
  const branches = parsed.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const response = { success: true, root: gitRoot, current, branches };
  gitBranchListCache.set(gitRoot, {
    value: response,
    expiresAt: Date.now() + GIT_BRANCH_CACHE_TTL_MS,
  });
  return response;
}

export async function checkoutGitBranch(
  path: string,
  branch: string,
  options?: { create?: boolean }
): Promise<GitBranchCheckoutResult> {
  const gitRoot = await findGitRoot(path);
  if (!gitRoot) {
    return { success: false, error: "Not a git repository" };
  }

  const safeBranch = await validateBranchName(gitRoot, branch);
  if (!safeBranch) {
    return { success: false, root: gitRoot, error: "Invalid branch name" };
  }

  const result = await runGit(
    gitRoot,
    options?.create === true ? ["switch", "-c", safeBranch] : ["switch", safeBranch]
  );
  if (!result.success) {
    return {
      success: false,
      root: gitRoot,
      error: result.stderr || `Failed to switch to ${safeBranch}`,
    };
  }

  clearGitCaches();
  return { success: true, root: gitRoot, branch: await getGitBranch(gitRoot) };
}
