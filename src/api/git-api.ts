// Git API - Basic git status integration for IDE
import { spawn } from "bun";
import { dirname } from "path";

export interface GitStatus {
    isRepo: boolean;
    branch?: string;
    ahead?: number;
    behind?: number;
    staged: string[];
    modified: string[];
    untracked: string[];
    error?: string;
}

export interface GitDiff {
    success: boolean;
    diff?: string;
    error?: string;
}

// Run git command in directory
async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; success: boolean }> {
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
            stdout: stdout.trim(),
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

// Find git root directory from a path
async function findGitRoot(path: string): Promise<string | null> {
    const result = await runGit(path, ["rev-parse", "--show-toplevel"]);
    return result.success ? result.stdout : null;
}

// Get git status for a directory
export async function getGitStatus(path: string): Promise<GitStatus> {
    // Find git root
    const gitRoot = await findGitRoot(path);

    if (!gitRoot) {
        return {
            isRepo: false,
            staged: [],
            modified: [],
            untracked: [],
        };
    }

    // Get current branch
    const branchResult = await runGit(gitRoot, ["branch", "--show-current"]);
    const branch = branchResult.success ? branchResult.stdout : undefined;

    // Get ahead/behind
    let ahead = 0;
    let behind = 0;
    const trackingResult = await runGit(gitRoot, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    if (trackingResult.success) {
        const [b, a] = trackingResult.stdout.split("\t").map(Number);
        behind = b || 0;
        ahead = a || 0;
    }

    // Get status
    const statusResult = await runGit(gitRoot, ["status", "--porcelain"]);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    if (statusResult.success && statusResult.stdout) {
        for (const line of statusResult.stdout.split("\n")) {
            if (!line) continue;
            const indexStatus = line[0];
            const workTreeStatus = line[1];
            const filePath = line.slice(3);

            // Staged files (index has changes)
            if (indexStatus !== " " && indexStatus !== "?") {
                staged.push(filePath);
            }

            // Modified in working tree
            if (workTreeStatus === "M" || workTreeStatus === "D") {
                modified.push(filePath);
            }

            // Untracked
            if (indexStatus === "?" && workTreeStatus === "?") {
                untracked.push(filePath);
            }
        }
    }

    return {
        isRepo: true,
        branch,
        ahead,
        behind,
        staged,
        modified,
        untracked,
    };
}

// Get diff for a file
export async function getGitDiff(filePath: string, staged: boolean = false): Promise<GitDiff> {
    const dir = dirname(filePath);
    const gitRoot = await findGitRoot(dir);

    if (!gitRoot) {
        return { success: false, error: "Not a git repository" };
    }

    const args = staged
        ? ["diff", "--cached", "--", filePath]
        : ["diff", "--", filePath];

    const result = await runGit(gitRoot, args);

    if (!result.success) {
        return { success: false, error: result.stderr };
    }

    return {
        success: true,
        diff: result.stdout || "(No changes)",
    };
}

// Get current branch name
export async function getGitBranch(path: string): Promise<string | null> {
    const gitRoot = await findGitRoot(path);
    if (!gitRoot) return null;

    const result = await runGit(gitRoot, ["branch", "--show-current"]);
    return result.success ? result.stdout : null;
}
