import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, basename, extname, dirname, resolve, relative, isAbsolute } from "path";
import { homedir } from "os";
import { existsSync, realpathSync } from "fs";
import { getGitStatus } from "./git-api";

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
  error?: string;
}

export interface IdeListFilesResult {
  success: boolean;
  path: string;
  query: string;
  totalFiles: number;
  truncated: boolean;
  files: Array<{ path: string; relativePath: string }>;
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
    const gitStatus = await getGitStatus(targetPath);
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

      const itemPath = join(targetPath, item.name);
      const canonicalItemPath = resolveCanonicalPath(itemPath);
      if (!isWithinHome(canonicalItemPath)) continue;

      try {
        const itemStats = await stat(itemPath);
        const isDirectory = item.isDirectory();
        const repoRelativePath =
          gitRoot !== null ? relative(gitRoot, itemPath).replaceAll("\\", "/") : null;
        entries.push({
          name: item.name,
          path: itemPath,
          type: isDirectory ? "directory" : "file",
          size: item.isFile() ? itemStats.size : undefined,
          extension: item.isFile() ? extname(item.name) : undefined,
          modifiedAt: itemStats.mtime.toISOString(),
          gitModified:
            !!repoRelativePath && pathHasStatus(gitModifiedSet, repoRelativePath, isDirectory),
          gitStaged:
            !!repoRelativePath && pathHasStatus(gitStagedSet, repoRelativePath, isDirectory),
          gitUntracked:
            !!repoRelativePath && pathHasStatus(gitUntrackedSet, repoRelativePath, isDirectory),
          gitIgnored:
            !!repoRelativePath && pathHasStatus(gitIgnoredSet, repoRelativePath, isDirectory),
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

const SEARCH_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  ".idea",
  ".vscode",
  "__pycache__",
]);
const SEARCH_MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

function isTextSearchCandidate(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!ext) return true;
  return !isBinaryExtension(ext);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[A-Za-z0-9_]/.test(char);
}

function isWholeWordMatch(content: string, start: number, end: number): boolean {
  const before = start > 0 ? content[start - 1] : "";
  const after = end < content.length ? content[end] : "";
  return !isWordChar(before) && !isWordChar(after);
}

function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const safeIndex = Math.max(0, Math.min(index, content.length));
  const before = content.slice(0, safeIndex);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const column = safeIndex - lineStart + 1;
  return { line, column };
}

function getLineText(content: string, index: number): string {
  const lineStart = content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nextBreak = content.indexOf("\n", index);
  const lineEnd = nextBreak === -1 ? content.length : nextBreak;
  return content.slice(lineStart, lineEnd).trimEnd();
}

function findMatchesInContent(
  content: string,
  query: string,
  options: { caseSensitive?: boolean; wholeWord?: boolean },
  maxMatches: number
): IdeSearchMatch[] {
  const matches: IdeSearchMatch[] = [];
  if (!query) return matches;

  const searchText = options.caseSensitive ? content : content.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  if (!needle) return matches;

  let index = 0;
  while (matches.length < maxMatches) {
    const found = searchText.indexOf(needle, index);
    if (found === -1) break;
    const end = found + needle.length;
    if (!options.wholeWord || isWholeWordMatch(content, found, end)) {
      const location = getLineAndColumn(content, found);
      matches.push({
        line: location.line,
        column: location.column,
        text: getLineText(content, found),
      });
    }
    index = end > index ? end : index + 1;
  }

  return matches;
}

async function collectSearchFiles(dirPath: string, out: string[]): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SEARCH_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".cybara") continue;
      await collectSearchFiles(entryPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isTextSearchCandidate(entryPath)) continue;
    out.push(entryPath);
  }
}

function resolveWorkspaceSearchRoot(targetPath: string, targetStats: { isDirectory(): boolean }): string {
  return targetStats.isDirectory() ? targetPath : dirname(targetPath);
}

export async function searchWorkspace(
  inputPath: string,
  query: string,
  options?: { caseSensitive?: boolean; wholeWord?: boolean; maxResults?: number }
): Promise<IdeSearchResult> {
  const targetPath = normalizePath(inputPath || HOME_DIR);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      success: true,
      path: targetPath,
      query: "",
      totalMatches: 0,
      truncated: false,
      files: [],
    };
  }

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      query: trimmedQuery,
      totalMatches: 0,
      truncated: false,
      files: [],
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      query: trimmedQuery,
      totalMatches: 0,
      truncated: false,
      files: [],
      error: "Path does not exist",
    };
  }

  const maxResults = Math.max(1, Math.min(options?.maxResults || 2000, 10000));
  const targetStats = await stat(targetPath);
  const filesToSearch: string[] = [];
  const searchFilesStartPath = resolveWorkspaceSearchRoot(targetPath, targetStats);
  await collectSearchFiles(searchFilesStartPath, filesToSearch);

  const files: IdeSearchFileResult[] = [];
  let totalMatches = 0;
  let truncated = false;

  for (const filePath of filesToSearch) {
    if (totalMatches >= maxResults) {
      truncated = true;
      break;
    }

    try {
      const fileStats = await stat(filePath);
      if (fileStats.size > SEARCH_MAX_FILE_SIZE) continue;
      const content = await readFile(filePath, "utf-8");
      const remaining = maxResults - totalMatches;
      const matches = findMatchesInContent(content, trimmedQuery, options || {}, remaining);
      if (matches.length === 0) continue;

      files.push({
        file: filePath,
        matches,
        count: matches.length,
      });
      totalMatches += matches.length;
    } catch {
      void 0;
    }
  }

  files.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

  return {
    success: true,
    path: searchFilesStartPath,
    query: trimmedQuery,
    totalMatches,
    truncated,
    files,
  };
}

function applyReplacements(
  content: string,
  query: string,
  replacement: string,
  options?: { caseSensitive?: boolean; wholeWord?: boolean }
): { content: string; replacements: number } {
  const escaped = escapeRegExp(query);
  const pattern = options?.wholeWord ? `\\b${escaped}\\b` : escaped;
  const regex = new RegExp(pattern, options?.caseSensitive ? "g" : "gi");
  let replacements = 0;
  const nextContent = content.replace(regex, () => {
    replacements += 1;
    return replacement;
  });
  return { content: nextContent, replacements };
}

export async function replaceInWorkspace(
  inputPath: string,
  query: string,
  replacement: string,
  options?: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    files?: string[];
  }
): Promise<IdeReplaceResult> {
  const targetPath = normalizePath(inputPath || HOME_DIR);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      success: false,
      path: targetPath,
      query: "",
      replacement,
      changedFiles: [],
      totalReplacements: 0,
      error: "Query cannot be empty",
    };
  }

  const searchResult = await searchWorkspace(targetPath, trimmedQuery, options);
  if (!searchResult.success) {
    return {
      success: false,
      path: searchResult.path,
      query: trimmedQuery,
      replacement,
      changedFiles: [],
      totalReplacements: 0,
      error: searchResult.error || "Search failed",
    };
  }

  const scopedFiles =
    Array.isArray(options?.files) && options.files.length > 0
      ? new Set(options.files.map((filePath) => normalizePath(filePath)))
      : null;

  const changedFiles: Array<{ file: string; replacements: number }> = [];
  let totalReplacements = 0;

  for (const file of searchResult.files) {
    if (scopedFiles && !scopedFiles.has(normalizePath(file.file))) continue;
    try {
      const content = await readFile(file.file, "utf-8");
      const replaced = applyReplacements(content, trimmedQuery, replacement, options);
      if (replaced.replacements === 0) continue;
      await writeFile(file.file, replaced.content, "utf-8");
      changedFiles.push({ file: file.file, replacements: replaced.replacements });
      totalReplacements += replaced.replacements;
    } catch {
      void 0;
    }
  }

  return {
    success: true,
    path: searchResult.path,
    query: trimmedQuery,
    replacement,
    changedFiles,
    totalReplacements,
  };
}

export async function previewReplaceInWorkspace(
  inputPath: string,
  query: string,
  replacement: string,
  options?: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    files?: string[];
    maxFiles?: number;
  }
): Promise<IdeReplacePreviewResult> {
  const targetPath = normalizePath(inputPath || HOME_DIR);
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      success: false,
      path: targetPath,
      query: "",
      replacement,
      totalReplacements: 0,
      files: [],
      truncated: false,
      error: "Query cannot be empty",
    };
  }

  const searchResult = await searchWorkspace(targetPath, trimmedQuery, {
    caseSensitive: options?.caseSensitive,
    wholeWord: options?.wholeWord,
    maxResults: 10000,
  });
  if (!searchResult.success) {
    return {
      success: false,
      path: searchResult.path,
      query: trimmedQuery,
      replacement,
      totalReplacements: 0,
      files: [],
      truncated: false,
      error: searchResult.error || "Search failed",
    };
  }

  const scopedFiles =
    Array.isArray(options?.files) && options.files.length > 0
      ? new Set(options.files.map((filePath) => normalizePath(filePath)))
      : null;
  const maxFiles = Math.max(1, Math.min(options?.maxFiles || 200, 1000));

  let totalReplacements = 0;
  const previewFiles: IdeReplacePreviewFile[] = [];
  let truncated = searchResult.truncated;

  for (const file of searchResult.files) {
    if (previewFiles.length >= maxFiles) {
      truncated = true;
      break;
    }
    if (scopedFiles && !scopedFiles.has(normalizePath(file.file))) continue;
    try {
      const content = await readFile(file.file, "utf-8");
      const replaced = applyReplacements(content, trimmedQuery, replacement, options);
      if (replaced.replacements === 0) continue;
      totalReplacements += replaced.replacements;
      const preview = file.matches.slice(0, 3).map((match) => ({
        line: match.line,
        before: match.text,
        after: applyReplacements(match.text, trimmedQuery, replacement, options).content,
      }));
      previewFiles.push({
        file: file.file,
        replacements: replaced.replacements,
        preview,
      });
    } catch {
      void 0;
    }
  }

  return {
    success: true,
    path: searchResult.path,
    query: trimmedQuery,
    replacement,
    totalReplacements,
    files: previewFiles,
    truncated,
  };
}

export async function listWorkspaceFiles(
  inputPath: string,
  options?: { query?: string; limit?: number }
): Promise<IdeListFilesResult> {
  const targetPath = normalizePath(inputPath || HOME_DIR);
  const query = (options?.query || "").trim();

  if (!isPathAllowed(targetPath)) {
    return {
      success: false,
      path: targetPath,
      query,
      totalFiles: 0,
      truncated: false,
      files: [],
      error: "Access denied: Path outside home directory",
    };
  }

  if (!existsSync(targetPath)) {
    return {
      success: false,
      path: targetPath,
      query,
      totalFiles: 0,
      truncated: false,
      files: [],
      error: "Path does not exist",
    };
  }

  const targetStats = await stat(targetPath);
  const searchRootPath = resolveWorkspaceSearchRoot(targetPath, targetStats);
  const filesToSearch: string[] = [];
  await collectSearchFiles(searchRootPath, filesToSearch);

  const normalizedQuery = query.toLowerCase();
  const limit = Math.max(1, Math.min(options?.limit || 200, 2000));
  const files: Array<{ path: string; relativePath: string }> = [];
  let truncated = false;

  for (const filePath of filesToSearch) {
    const relativePath = relative(searchRootPath, filePath).replaceAll("\\", "/");
    if (normalizedQuery && !relativePath.toLowerCase().includes(normalizedQuery)) continue;
    files.push({
      path: filePath,
      relativePath,
    });
    if (files.length >= limit) {
      truncated = true;
      break;
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    success: true,
    path: searchRootPath,
    query,
    totalFiles: files.length,
    truncated,
    files,
  };
}
