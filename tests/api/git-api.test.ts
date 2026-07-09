import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkoutGitBranch,
  getGitBranch,
  getGitBranches,
  getGitDiff,
  getGitStatus,
} from "../../src/api/git-api";

let baseDir = "";
let repoDir = "";
let plainDir = "";

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "cybara-git-api-"));
  repoDir = join(baseDir, "repo");
  plainDir = join(baseDir, "plain");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(plainDir, { recursive: true });

  git(["init", "-q", "-b", "main"], repoDir);
  git(["config", "user.email", "test@example.com"], repoDir);
  git(["config", "user.name", "Test"], repoDir);
  writeFileSync(join(repoDir, "committed.txt"), "first\n");
  git(["add", "-A"], repoDir);
  git(["commit", "-q", "-m", "initial"], repoDir);

  writeFileSync(join(repoDir, "committed.txt"), "first\nmodified\n");
  writeFileSync(join(repoDir, "staged.txt"), "staged content\n");
  git(["add", "staged.txt"], repoDir);
  writeFileSync(join(repoDir, "untracked.txt"), "new file\n");
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("getGitStatus", () => {
  test("bounds git subprocess duration", () => {
    const source = readFileSync(join(process.cwd(), "src", "api", "git-api.ts"), "utf8");
    expect(source).toContain("GIT_COMMAND_TIMEOUT_MS");
    expect(source).toContain("proc.kill()");
    expect(source).toContain('stderr: timedOut ? "Git command timed out"');
  });

  test("reports repo root, branch, and file buckets", async () => {
    const status = await getGitStatus(repoDir);
    expect(status.isRepo).toBe(true);
    expect(status.root?.endsWith("repo")).toBe(true);
    expect(status.branch).toBe("main");
    expect(status.staged).toContain("staged.txt");
    expect(status.modified).toContain("committed.txt");
    expect(status.untracked).toContain("untracked.txt");
  });

  test("non-git directory reports isRepo false without throwing", async () => {
    const status = await getGitStatus(plainDir);
    expect(status.isRepo).toBe(false);
    expect(status.staged).toEqual([]);
    expect(status.modified).toEqual([]);
    expect(status.untracked).toEqual([]);
  });

  test("missing directory degrades cleanly", async () => {
    const status = await getGitStatus(join(baseDir, "does-not-exist"));
    expect(status.isRepo).toBe(false);
  });

  test("lightweight option still identifies the repo (branch omitted for speed)", async () => {
    const status = await getGitStatus(repoDir, { lightweight: true });
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBeUndefined();
    expect(status.staged).toContain("staged.txt");
  });
});

describe("getGitDiff", () => {
  test("unstaged diff for a modified file contains the new line", async () => {
    const diff = await getGitDiff(join(repoDir, "committed.txt"), false);
    expect(diff.success).toBe(true);
    expect(diff.diff).toContain("+modified");
  });

  test("staged diff for a staged file contains its content", async () => {
    const diff = await getGitDiff(join(repoDir, "staged.txt"), true);
    expect(diff.success).toBe(true);
    expect(diff.diff).toContain("+staged content");
  });

  test("file outside any repo returns an error result, not a throw", async () => {
    writeFileSync(join(plainDir, "loose.txt"), "x\n");
    const diff = await getGitDiff(join(plainDir, "loose.txt"), false);
    expect(diff.success).toBe(false);
    expect(typeof diff.error).toBe("string");
  });
});

describe("getGitBranch", () => {
  test("returns the branch for a repo path", async () => {
    expect(await getGitBranch(repoDir)).toBe("main");
  });

  test("returns null outside a repo", async () => {
    expect(await getGitBranch(plainDir)).toBeNull();
  });
});

describe("git branch list and checkout", () => {
  test("lists local branches with the current branch first", async () => {
    git(["branch", "feature/test-branch"], repoDir);
    const branches = await getGitBranches(repoDir);
    expect(branches.success).toBe(true);
    expect(branches.current).toBe("main");
    expect(branches.branches[0]).toEqual({ name: "main", current: true });
    expect(branches.branches.map((branch) => branch.name)).toContain("feature/test-branch");
  });

  test("switches existing branches and creates a new branch without force", async () => {
    const tempRepo = join(baseDir, "checkout-repo");
    mkdirSync(tempRepo, { recursive: true });
    git(["init", "-q", "-b", "main"], tempRepo);
    git(["config", "user.email", "test@example.com"], tempRepo);
    git(["config", "user.name", "Test"], tempRepo);
    writeFileSync(join(tempRepo, "file.txt"), "content\n");
    git(["add", "-A"], tempRepo);
    git(["commit", "-q", "-m", "initial"], tempRepo);
    git(["branch", "existing"], tempRepo);

    expect(await checkoutGitBranch(tempRepo, "existing")).toMatchObject({
      success: true,
      branch: "existing",
    });
    expect(await checkoutGitBranch(tempRepo, "new/local", { create: true })).toMatchObject({
      success: true,
      branch: "new/local",
    });
    expect(await checkoutGitBranch(tempRepo, "bad branch name")).toMatchObject({
      success: false,
      error: "Invalid branch name",
    });
  });
});
