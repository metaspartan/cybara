import { existsSync } from "fs";
import { readFile, stat } from "fs/promises";
import { dirname, relative } from "path";
import { getGitStatus } from "./git-api";
import type { IdeBlameLine, IdeBlameResult, IdeUrlResult } from "./ide-api";
import {
  isIdePathAllowed as isPathAllowed,
  isWithinIdeHome as isWithinHome,
  normalizeIdeInputPath as normalizePath,
  resolveCanonicalPath,
} from "./ide-path-policy";

interface BlameCommitMeta {
  author: string;
  authorTime: string;
  summary: string;
}

function parseBlamePorcelain(output: string): IdeBlameLine[] {
  const rows = output.split("\n");
  const lines: IdeBlameLine[] = [];
  const commitMeta = new Map<string, BlameCommitMeta>();
  let index = 0;

  while (index < rows.length) {
    const header = rows[index] || "";
    const headerMatch = header.match(/^(\^?[0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/i);
    if (!headerMatch) {
      index += 1;
      continue;
    }

    const rawCommit = (headerMatch[1] || "").replace(/^\^/, "");
    const lineNumber = Number.parseInt(headerMatch[2] || "", 10);
    let author = "";
    let authorTime = "";
    let summary = "";
    index += 1;

    while (index < rows.length) {
      const row = rows[index] || "";
      if (row.startsWith("\t")) {
        index += 1;
        break;
      }

      if (row.startsWith("author ")) {
        author = row.slice(7).trim();
      } else if (row.startsWith("author-time ")) {
        authorTime = row.slice(12).trim();
      } else if (row.startsWith("summary ")) {
        summary = row.slice(8).trim();
      }
      index += 1;
    }

    if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;

    const cached = commitMeta.get(rawCommit);
    if (author || authorTime || summary) {
      commitMeta.set(rawCommit, { author, authorTime, summary });
    } else if (cached) {
      author = cached.author;
      authorTime = cached.authorTime;
      summary = cached.summary;
    }

    const parsedTime = Number.parseInt(authorTime, 10);
    const isUncommitted = /^0+$/.test(rawCommit);
    lines.push({
      line: lineNumber,
      commit: rawCommit,
      shortCommit: isUncommitted ? "working" : rawCommit.slice(0, 8),
      author: author || "Unknown",
      authorDate: Number.isFinite(parsedTime)
        ? new Date(parsedTime * 1000).toISOString()
        : undefined,
      summary: summary || undefined,
      isUncommitted,
    });
  }

  return lines.sort((a, b) => a.line - b.line);
}

function normalizeGitRemoteToHttpBase(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const normalizePath = (value: string): string => value.replace(/\.git$/i, "").replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      parsed.pathname = normalizePath(parsed.pathname);
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  const sshLike = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (sshLike) {
    const host = sshLike[1] || "";
    const repoPath = normalizePath(sshLike[2] || "");
    return host && repoPath ? `https://${host}/${repoPath}` : null;
  }

  const sshUrl = trimmed.match(/^ssh:\/\/(?:.+@)?([^/]+)\/(.+)$/i);
  if (sshUrl) {
    const host = sshUrl[1] || "";
    const repoPath = normalizePath(sshUrl[2] || "");
    return host && repoPath ? `https://${host}/${repoPath}` : null;
  }

  return null;
}

function buildCommitUrl(remoteBaseUrl: string, commit: string): string {
  if (/bitbucket\.org/i.test(remoteBaseUrl)) {
    return `${remoteBaseUrl}/commits/${commit}`;
  }
  return `${remoteBaseUrl}/commit/${commit}`;
}

function getRepositoryCommitBaseUrl(repoRoot: string): string | null {
  const proc = Bun.spawnSync(["git", "config", "--get", "remote.origin.url"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((proc.exitCode ?? 1) !== 0) return null;
  const remoteUrl = proc.stdout.toString().trim();
  return normalizeGitRemoteToHttpBase(remoteUrl);
}

function encodeRepoPath(pathValue: string): string {
  return pathValue
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildPermalinkUrl(
  remoteBaseUrl: string,
  commit: string,
  repoRelativePath: string,
  line: number
): string {
  const encodedPath = encodeRepoPath(repoRelativePath);
  if (/bitbucket\.org/i.test(remoteBaseUrl)) {
    return `${remoteBaseUrl}/src/${commit}/${encodedPath}#lines-${line}`;
  }
  if (/gitlab\.com/i.test(remoteBaseUrl)) {
    return `${remoteBaseUrl}/-/blob/${commit}/${encodedPath}#L${line}`;
  }
  return `${remoteBaseUrl}/blob/${commit}/${encodedPath}#L${line}`;
}

function buildHistoryUrl(remoteBaseUrl: string, branch: string, repoRelativePath: string): string {
  const encodedPath = encodeRepoPath(repoRelativePath);
  const encodedBranch = encodeURIComponent(branch);
  if (/bitbucket\.org/i.test(remoteBaseUrl)) {
    return `${remoteBaseUrl}/history-node/${encodedBranch}/${encodedPath}`;
  }
  if (/gitlab\.com/i.test(remoteBaseUrl)) {
    return `${remoteBaseUrl}/-/commits/${encodedBranch}/${encodedPath}`;
  }
  return `${remoteBaseUrl}/commits/${encodedBranch}/${encodedPath}`;
}

function getLineCommitHash(
  repoRoot: string,
  repoRelativePath: string,
  line: number
): string | null {
  const safeLine = Math.max(1, Math.floor(line));
  const proc = Bun.spawnSync(
    ["git", "blame", "--line-porcelain", "-L", `${safeLine},${safeLine}`, "--", repoRelativePath],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  if ((proc.exitCode ?? 1) !== 0) return null;
  const firstLine = proc.stdout.toString().split("\n")[0] || "";
  const commit = firstLine.split(" ")[0] || "";
  const normalized = commit.replace(/^\^/, "");
  if (!normalized || /^0+$/.test(normalized)) return null;
  return normalized;
}

function getCommitDescriptions(repoRoot: string, commits: string[]): Map<string, string> {
  const uniqueCommits = Array.from(new Set(commits.filter(Boolean)));
  const descriptions = new Map<string, string>();
  const batchSize = 64;

  for (let i = 0; i < uniqueCommits.length; i += batchSize) {
    const batch = uniqueCommits.slice(i, i + batchSize);
    if (batch.length === 0) continue;
    const proc = Bun.spawnSync(["git", "show", "--no-patch", "--format=%H%x1f%B%x1e", ...batch], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if ((proc.exitCode ?? 1) !== 0) continue;
    const payload = proc.stdout.toString();
    for (const row of payload.split("\x1e")) {
      const trimmed = row.trim();
      if (!trimmed) continue;
      const delimiterIndex = trimmed.indexOf("\x1f");
      if (delimiterIndex <= 0) continue;
      const hash = trimmed.slice(0, delimiterIndex).trim();
      const description = trimmed.slice(delimiterIndex + 1).trim();
      if (hash) {
        descriptions.set(hash, description);
      }
    }
  }

  return descriptions;
}

export async function getFileBlame(
  inputPath: string,
  options?: { maxLines?: number }
): Promise<IdeBlameResult> {
  const targetPath = normalizePath(inputPath);

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      isRepo: false,
      truncated: false,
      lines: [],
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      isRepo: false,
      truncated: false,
      lines: [],
      error: "File does not exist",
    };
  }

  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      isRepo: false,
      truncated: false,
      lines: [],
      error: "Access denied: Path outside home directory",
    };
  }

  try {
    const targetStats = await stat(targetPath);
    if (!targetStats.isFile()) {
      return {
        success: false,
        path: targetPath,
        isRepo: false,
        truncated: false,
        lines: [],
        error: "Path is not a file",
      };
    }

    const gitStatus = await getGitStatus(dirname(targetPath));
    if (!gitStatus.isRepo || !gitStatus.root) {
      return {
        success: true,
        path: targetPath,
        isRepo: false,
        truncated: false,
        lines: [],
      };
    }

    const maxLines = Math.max(1, Math.min(options?.maxLines || 10000, 50000));
    const content = await readFile(targetPath, "utf-8");
    const totalLines = Math.max(1, content.split("\n").length);
    const lineLimit = Math.min(totalLines, maxLines);
    const truncated = totalLines > lineLimit;
    const relativePath = relative(gitStatus.root, targetPath).replaceAll("\\", "/");

    const proc = Bun.spawn(
      ["git", "blame", "--porcelain", "-L", `1,${lineLimit}`, "--", relativePath],
      {
        cwd: gitStatus.root,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      return {
        success: false,
        path: targetPath,
        isRepo: true,
        truncated,
        lines: [],
        error: stderr.trim() || "Failed to run git blame",
      };
    }

    const commitBaseUrl = getRepositoryCommitBaseUrl(gitStatus.root);
    const blameLines = parseBlamePorcelain(stdout);
    const commitDescriptions = getCommitDescriptions(
      gitStatus.root,
      blameLines.filter((line) => !line.isUncommitted && line.commit).map((line) => line.commit)
    );
    const parsedLines = blameLines.map((line) => ({
      ...line,
      commitDescription:
        !line.isUncommitted && line.commit
          ? commitDescriptions.get(line.commit) || line.summary
          : line.summary,
      commitUrl:
        commitBaseUrl && !line.isUncommitted && line.commit
          ? buildCommitUrl(commitBaseUrl, line.commit)
          : undefined,
    }));

    return {
      success: true,
      path: targetPath,
      isRepo: true,
      truncated,
      lines: parsedLines,
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      isRepo: false,
      truncated: false,
      lines: [],
      error: `Failed to read blame: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function getFilePermalink(inputPath: string, line: number): Promise<IdeUrlResult> {
  const targetPath = normalizePath(inputPath);
  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }
  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Path does not exist",
    };
  }

  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  try {
    const targetStats = await stat(targetPath);
    if (!targetStats.isFile()) {
      return {
        success: false,
        path: targetPath,
        error: "Path is not a file",
      };
    }

    const gitStatus = await getGitStatus(dirname(targetPath));
    if (!gitStatus.isRepo || !gitStatus.root) {
      return {
        success: false,
        path: targetPath,
        error: "File is not inside a git repository",
      };
    }

    const remoteBaseUrl = getRepositoryCommitBaseUrl(gitStatus.root);
    if (!remoteBaseUrl) {
      return {
        success: false,
        path: targetPath,
        error: "Remote origin URL is not configured",
      };
    }

    const repoRelativePath = relative(gitStatus.root, targetPath).replaceAll("\\", "/");
    const commit =
      getLineCommitHash(gitStatus.root, repoRelativePath, line) ||
      Bun.spawnSync(["git", "rev-parse", "HEAD"], {
        cwd: gitStatus.root,
        stdout: "pipe",
        stderr: "pipe",
      })
        .stdout.toString()
        .trim();

    if (!commit) {
      return {
        success: false,
        path: targetPath,
        error: "Unable to resolve commit hash",
      };
    }

    return {
      success: true,
      path: targetPath,
      url: buildPermalinkUrl(
        remoteBaseUrl,
        commit,
        repoRelativePath,
        Math.max(1, Math.floor(line))
      ),
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getFileHistoryUrl(inputPath: string): Promise<IdeUrlResult> {
  const targetPath = normalizePath(inputPath);
  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }
  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Path does not exist",
    };
  }

  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  try {
    const targetStats = await stat(targetPath);
    if (!targetStats.isFile()) {
      return {
        success: false,
        path: targetPath,
        error: "Path is not a file",
      };
    }

    const gitStatus = await getGitStatus(dirname(targetPath));
    if (!gitStatus.isRepo || !gitStatus.root) {
      return {
        success: false,
        path: targetPath,
        error: "File is not inside a git repository",
      };
    }

    const remoteBaseUrl = getRepositoryCommitBaseUrl(gitStatus.root);
    if (!remoteBaseUrl) {
      return {
        success: false,
        path: targetPath,
        error: "Remote origin URL is not configured",
      };
    }

    const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: gitStatus.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const branch =
      (branchProc.exitCode ?? 1) === 0 ? branchProc.stdout.toString().trim() || "HEAD" : "HEAD";
    const repoRelativePath = relative(gitStatus.root, targetPath).replaceAll("\\", "/");

    return {
      success: true,
      path: targetPath,
      url: buildHistoryUrl(remoteBaseUrl, branch, repoRelativePath),
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
