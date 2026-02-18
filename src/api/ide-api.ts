import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, basename, extname, dirname, resolve, relative, isAbsolute } from "path";
import { homedir } from "os";
import { existsSync, realpathSync } from "fs";

const HOME_DIR = homedir();
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit (industry standard for browser IDEs)

function resolveCanonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const HOME_ROOTS = Array.from(new Set([resolve(HOME_DIR), resolveCanonicalPath(HOME_DIR)]));

function isWithinRoot(rootPath: string, resolvedPath: string): boolean {
  const rel = relative(rootPath, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isWithinHome(resolvedPath: string): boolean {
  return HOME_ROOTS.some((rootPath) => isWithinRoot(rootPath, resolvedPath));
}

function isPathAllowed(targetPath: string): boolean {
  return isWithinHome(resolve(targetPath));
}

function normalizePath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return join(HOME_DIR, inputPath.slice(1));
  }
  return inputPath;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  modifiedAt?: string;
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

function isBinaryExtension(ext: string): boolean {
  const binaryExts = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".svg",
    ".mp3",
    ".mp4",
    ".wav",
    ".webm",
    ".ogg",
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".db",
    ".sqlite",
    ".sqlite3",
  ];
  return binaryExts.includes(ext.toLowerCase());
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

    for (const item of items) {
      // Skip hidden files and common ignored directories
      if (item.name.startsWith(".") && item.name !== ".cybara") continue;
      if (item.name === "node_modules" || item.name === "__pycache__") continue;

      const itemPath = join(targetPath, item.name);
      const canonicalItemPath = resolveCanonicalPath(itemPath);
      if (!isWithinHome(canonicalItemPath)) continue;

      try {
        const itemStats = await stat(itemPath);
        entries.push({
          name: item.name,
          path: itemPath,
          type: item.isDirectory() ? "directory" : "file",
          size: item.isFile() ? itemStats.size : undefined,
          extension: item.isFile() ? extname(item.name) : undefined,
          modifiedAt: itemStats.mtime.toISOString(),
        });
      } catch {
        void 0;
      }
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
