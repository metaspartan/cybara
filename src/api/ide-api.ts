import { existsSync } from "fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, join, relative } from "path";
import { getGitStatus } from "./git-api";
import { isIdeBinaryExtension as isBinaryExtension } from "./ide-file-policy";
import {
  IDE_HOME_DIR as HOME_DIR,
  isIdePathAllowed as isPathAllowed,
  isWithinIdeHome as isWithinHome,
  normalizeIdeInputPath as normalizePath,
  resolveCanonicalPath,
} from "./ide-path-policy";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  modifiedAt?: string;
  gitModified?: boolean;
  gitStaged?: boolean;
  gitUntracked?: boolean;
  gitIgnored?: boolean;
}

export interface BrowseResult {
  success: boolean;
  path: string;
  parent: string | null;
  entries: FileEntry[];
  error?: string;
}

export interface ReadResult {
  success: boolean;
  path: string;
  content?: string;
  size?: number;
  extension?: string;
  isBinary?: boolean;
  error?: string;
}

export interface IdeSearchMatch {
  line: number;
  column: number;
  text: string;
}

export interface IdeSearchFileResult {
  file: string;
  matches: IdeSearchMatch[];
  count: number;
}

export interface IdeSearchResult {
  success: boolean;
  path: string;
  query: string;
  totalMatches: number;
  truncated: boolean;
  filesScanned?: number;
  scanTruncated?: boolean;
  files: IdeSearchFileResult[];
  error?: string;
}

export interface IdeReplaceResult {
  success: boolean;
  path: string;
  query: string;
  replacement: string;
  changedFiles: Array<{ file: string; replacements: number }>;
  totalReplacements: number;
  truncated?: boolean;
  filesScanned?: number;
  scanTruncated?: boolean;
  error?: string;
}

export interface IdeReplacePreviewFile {
  file: string;
  replacements: number;
  preview: Array<{ line: number; before: string; after: string }>;
}

export interface IdeReplacePreviewResult {
  success: boolean;
  path: string;
  query: string;
  replacement: string;
  totalReplacements: number;
  files: IdeReplacePreviewFile[];
  truncated: boolean;
  filesScanned?: number;
  scanTruncated?: boolean;
  error?: string;
}

export interface IdeListFilesResult {
  success: boolean;
  path: string;
  query: string;
  totalFiles: number;
  truncated: boolean;
  filesScanned?: number;
  scanTruncated?: boolean;
  files: Array<{ path: string; relativePath: string }>;
  error?: string;
}

export interface IdeBlameLine {
  line: number;
  commit: string;
  shortCommit: string;
  author: string;
  authorDate?: string;
  summary?: string;
  commitDescription?: string;
  commitUrl?: string;
  isUncommitted: boolean;
}

export interface IdeBlameResult {
  success: boolean;
  path: string;
  isRepo: boolean;
  truncated: boolean;
  lines: IdeBlameLine[];
  error?: string;
}

export interface RevealResult {
  success: boolean;
  path: string;
  error?: string;
}

export interface IdeUrlResult {
  success: boolean;
  path: string;
  url?: string;
  error?: string;
}

export interface WorkspaceOpenTarget {
  id: string;
  label: string;
  kind: "internal" | "file-manager" | "terminal" | "ide";
  icon: string;
  iconUrl?: string;
  available: boolean;
  detail?: string;
}

export interface WorkspaceOpenTargetsResult {
  success: boolean;
  path: string;
  targets: WorkspaceOpenTarget[];
  error?: string;
}

export async function browseDirectory(inputPath?: string): Promise<BrowseResult> {
  const targetPath = normalizePath(inputPath || HOME_DIR);

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      parent: null,
      entries: [],
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      parent: dirname(targetPath),
      entries: [],
      error: "Path does not exist",
    };
  }

  const canonicalTargetPath = resolveCanonicalPath(targetPath);
  if (!isWithinHome(canonicalTargetPath)) {
    return {
      success: false,
      path: targetPath,
      parent: null,
      entries: [],
      error: "Access denied: Path outside home directory",
    };
  }

  try {
    const stats = await stat(targetPath);
    if (!stats.isDirectory()) {
      return {
        success: false,
        path: targetPath,
        parent: dirname(targetPath),
        entries: [],
        error: "Path is not a directory",
      };
    }

    const items = await readdir(targetPath, { withFileTypes: true });
    const entries: FileEntry[] = [];
    const gitStatus = await getGitStatus(targetPath, { lightweight: true });
    const gitRoot = gitStatus.isRepo && gitStatus.root ? gitStatus.root : null;
    const gitModifiedSet = new Set(gitStatus.modified.map((item) => item.replaceAll("\\", "/")));
    const gitStagedSet = new Set(gitStatus.staged.map((item) => item.replaceAll("\\", "/")));
    const gitUntrackedSet = new Set(gitStatus.untracked.map((item) => item.replaceAll("\\", "/")));
    const gitIgnoredSet = new Set(gitStatus.ignored.map((item) => item.replaceAll("\\", "/")));

    const pathHasStatus = (
      statusSet: Set<string>,
      repoRelativePath: string,
      isDirectory: boolean
    ): boolean => {
      if (statusSet.has(repoRelativePath)) return true;
      if (!isDirectory) return false;
      const prefix = `${repoRelativePath}/`;
      for (const value of statusSet) {
        if (value.startsWith(prefix)) return true;
      }
      return false;
    };

    for (const item of items) {
      // Skip hidden files and common ignored directories
      if (item.name.startsWith(".") && item.name !== ".cybara") continue;
      if (item.name === "node_modules" || item.name === "__pycache__") continue;
      if (item.isSymbolicLink()) continue;

      const itemPath = join(targetPath, item.name);
      const isDirectory = item.isDirectory();
      const repoRelativePath =
        gitRoot !== null ? relative(gitRoot, itemPath).replaceAll("\\", "/") : null;
      entries.push({
        name: item.name,
        path: itemPath,
        type: isDirectory ? "directory" : "file",
        extension: item.isFile() ? extname(item.name) : undefined,
        gitModified:
          !!repoRelativePath && pathHasStatus(gitModifiedSet, repoRelativePath, isDirectory),
        gitStaged: !!repoRelativePath && pathHasStatus(gitStagedSet, repoRelativePath, isDirectory),
        gitUntracked:
          !!repoRelativePath && pathHasStatus(gitUntrackedSet, repoRelativePath, isDirectory),
        gitIgnored:
          !!repoRelativePath && pathHasStatus(gitIgnoredSet, repoRelativePath, isDirectory),
      });
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      success: true,
      path: targetPath,
      parent: targetPath !== HOME_DIR ? dirname(targetPath) : null,
      entries,
    };
  } catch (err) {
    return {
      success: false,
      path: targetPath,
      parent: dirname(targetPath),
      entries: [],
      error: `Failed to read directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function readFileContent(inputPath: string): Promise<ReadResult> {
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
      error: "File does not exist",
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
    const stats = await stat(targetPath);

    if (stats.isDirectory()) {
      return {
        success: false,
        path: targetPath,
        error: "Cannot read directory as file",
      };
    }

    const ext = extname(targetPath);

    if (isBinaryExtension(ext)) {
      return {
        success: true,
        path: targetPath,
        size: stats.size,
        extension: ext,
        isBinary: true,
        content: `[Binary file: ${basename(targetPath)} (${formatBytes(stats.size)})]`,
      };
    }

    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: true,
        path: targetPath,
        size: stats.size,
        extension: ext,
        content: `[File too large: ${formatBytes(stats.size)}. Max: ${formatBytes(MAX_FILE_SIZE)}]`,
      };
    }

    const content = await readFile(targetPath, "utf-8");

    return {
      success: true,
      path: targetPath,
      content,
      size: stats.size,
      extension: ext,
    };
  } catch (err) {
    return {
      success: false,
      path: targetPath,
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface WriteResult {
  success: boolean;
  path: string;
  error?: string;
}

export interface CreateResult {
  success: boolean;
  path: string;
  type: "file" | "directory";
  error?: string;
}

export interface RenameResult {
  success: boolean;
  path: string;
  oldPath: string;
  error?: string;
}

export async function writeFileContent(inputPath: string, content: string): Promise<WriteResult> {
  const targetPath = normalizePath(inputPath);

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  const parentDir = dirname(targetPath);
  if (!existsSync(parentDir)) {
    return {
      success: false,
      path: targetPath,
      error: "Parent directory does not exist",
    };
  }

  const canonicalParentDir = resolveCanonicalPath(parentDir);
  if (!isWithinHome(canonicalParentDir)) {
    return {
      success: false,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  if (existsSync(targetPath)) {
    const canonicalTargetPath = resolveCanonicalPath(targetPath);
    if (!isWithinHome(canonicalTargetPath)) {
      return {
        success: false,
        path: targetPath,
        error: "Access denied: Path outside home directory",
      };
    }
  }

  try {
    await writeFile(targetPath, content, "utf-8");
    return {
      success: true,
      path: targetPath,
    };
  } catch (err) {
    return {
      success: false,
      path: targetPath,
      error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function createItem(
  parentPath: string,
  name: string,
  type: "file" | "directory"
): Promise<CreateResult> {
  const parentDir = normalizePath(parentPath);

  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return {
      success: false,
      path: "",
      type,
      error: "Invalid name: cannot contain path separators",
    };
  }

  const targetPath = join(parentDir, name);

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      type,
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(parentDir)) {
    return {
      success: false,
      path: targetPath,
      type,
      error: "Parent directory does not exist",
    };
  }

  const canonicalParentDir = resolveCanonicalPath(parentDir);
  if (!isWithinHome(canonicalParentDir)) {
    return {
      success: false,
      path: targetPath,
      type,
      error: "Access denied: Path outside home directory",
    };
  }

  if (existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      type,
      error: `${type === "file" ? "File" : "Directory"} already exists`,
    };
  }

  try {
    if (type === "directory") {
      await mkdir(targetPath, { recursive: true });
    } else {
      await writeFile(targetPath, "", "utf-8");
    }

    return {
      success: true,
      path: targetPath,
      type,
    };
  } catch (err) {
    return {
      success: false,
      path: targetPath,
      type,
      error: `Failed to create ${type}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function renameItem(inputPath: string, newName: string): Promise<RenameResult> {
  const targetPath = normalizePath(inputPath);
  const nextName = newName.trim();

  if (!nextName) {
    return {
      success: false,
      oldPath: targetPath,
      path: targetPath,
      error: "Name cannot be empty",
    };
  }

  if (nextName.includes("/") || nextName.includes("\\") || nextName.includes("..")) {
    return {
      success: false,
      oldPath: targetPath,
      path: targetPath,
      error: "Invalid name: cannot contain path separators",
    };
  }

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      oldPath: targetPath,
      path: targetPath,
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      oldPath: targetPath,
      path: targetPath,
      error: "Path does not exist",
    };
  }

  const parentPath = dirname(targetPath);
  const nextPath = join(parentPath, nextName);
  if (!isPathAllowed(nextPath)) {
    return {
      success: false,
      oldPath: targetPath,
      path: nextPath,
      error: "Access denied: Path outside home directory",
    };
  }

  if (existsSync(nextPath)) {
    return {
      success: false,
      oldPath: targetPath,
      path: nextPath,
      error: "A file or directory with that name already exists",
    };
  }

  const canonicalParentDir = resolveCanonicalPath(parentPath);
  if (!isWithinHome(canonicalParentDir)) {
    return {
      success: false,
      oldPath: targetPath,
      path: nextPath,
      error: "Access denied: Path outside home directory",
    };
  }

  if (existsSync(targetPath)) {
    const canonicalTargetPath = resolveCanonicalPath(targetPath);
    if (!isWithinHome(canonicalTargetPath)) {
      return {
        success: false,
        oldPath: targetPath,
        path: nextPath,
        error: "Access denied: Path outside home directory",
      };
    }
  }

  try {
    await rename(targetPath, nextPath);
    return {
      success: true,
      oldPath: targetPath,
      path: nextPath,
    };
  } catch (error) {
    return {
      success: false,
      oldPath: targetPath,
      path: nextPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export * from "./ide-git-api";
export { isIdePathAllowed as isPathAllowed } from "./ide-path-policy";
export * from "./ide-search-api";
export * from "./ide-workspace-api";
