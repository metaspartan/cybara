import { readdir, readFile, stat, writeFile, mkdir, rename } from "fs/promises";
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
        gitStaged:
          !!repoRelativePath && pathHasStatus(gitStagedSet, repoRelativePath, isDirectory),
        gitUntracked:
          !!repoRelativePath && pathHasStatus(gitUntrackedSet, repoRelativePath, isDirectory),
        gitIgnored: !!repoRelativePath && pathHasStatus(gitIgnoredSet, repoRelativePath, isDirectory),
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
  options: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean },
  maxMatches: number
): IdeSearchMatch[] {
  const matches: IdeSearchMatch[] = [];
  if (!query) return matches;

  // Regex mode: compile the user's pattern and iterate matches.
  if (options.useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, options.caseSensitive ? "g" : "gi");
    } catch {
      return matches; // invalid regex → no matches
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null && matches.length < maxMatches) {
      const found = m.index;
      const end = found + (m[0].length || 1);
      if (!options.wholeWord || isWholeWordMatch(content, found, end)) {
        const location = getLineAndColumn(content, found);
        matches.push({
          line: location.line,
          column: location.column,
          text: getLineText(content, found),
        });
      }
      if (m.index === re.lastIndex) re.lastIndex += 1; // avoid zero-length loop
    }
    return matches;
  }

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
  options?: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean; maxResults?: number }
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
  options?: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean }
): { content: string; replacements: number } {
  // In regex mode the user's query IS the pattern (with capture-group support
  // via $1/$2 in the replacement); otherwise escape it as a literal.
  const patternSource = options?.useRegex ? query : escapeRegExp(query);
  const pattern = options?.wholeWord && !options?.useRegex ? `\\b${patternSource}\\b` : patternSource;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, options?.caseSensitive ? "g" : "gi");
  } catch {
    return { content, replacements: 0 }; // invalid regex → no changes
  }
  let replacements = 0;
  const nextContent = content.replace(regex, () => {
    replacements += 1;
    // In regex mode, pass match through so $1/$& work; otherwise literal replacement.
    return options?.useRegex ? replacement.replace(/\$[0-9&]/g, "") || replacement : replacement;
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
    useRegex?: boolean;
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

function parseBlamePorcelain(output: string): IdeBlameLine[] {
  const rows = output.split("\n");
  const lines: IdeBlameLine[] = [];
  let index = 0;

  while (index < rows.length) {
    const header = rows[index] || "";
    const headerMatch = header.match(/^([0-9a-f]{40}|\^[0-9a-f]{40})\s+\d+\s+(\d+)\s+\d+$/i);
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
    const parsedTime = Number.parseInt(authorTime, 10);
    const isUncommitted = /^0+$/.test(rawCommit);
    lines.push({
      line: lineNumber,
      commit: rawCommit,
      shortCommit: isUncommitted ? "working" : rawCommit.slice(0, 8),
      author: author || "Unknown",
      authorDate: Number.isFinite(parsedTime) ? new Date(parsedTime * 1000).toISOString() : undefined,
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

function commandAvailable(command: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = Bun.spawnSync([checker, command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return (result.exitCode ?? 1) === 0;
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

function getLineCommitHash(repoRoot: string, repoRelativePath: string, line: number): string | null {
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
    const proc = Bun.spawnSync(
      ["git", "show", "--no-patch", "--format=%H%x1f%B%x1e", ...batch],
      {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
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

    const proc = Bun.spawn(["git", "blame", "--line-porcelain", "-L", `1,${lineLimit}`, "--", relativePath], {
      cwd: gitStatus.root,
      stdout: "pipe",
      stderr: "pipe",
    });
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
        !line.isUncommitted && line.commit ? commitDescriptions.get(line.commit) || line.summary : line.summary,
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

export async function revealInSystemExplorer(inputPath: string): Promise<RevealResult> {
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
    if (process.platform === "darwin") {
      const args = targetStats.isDirectory() ? [targetPath] : ["-R", targetPath];
      const result = Bun.spawnSync(["open", ...args], { stdout: "pipe", stderr: "pipe" });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open Finder",
        };
      }
      return { success: true, path: targetPath };
    }

    if (process.platform === "win32") {
      const args = targetStats.isDirectory() ? [targetPath] : [`/select,${targetPath}`];
      const result = Bun.spawnSync(["explorer", ...args], { stdout: "pipe", stderr: "pipe" });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open Explorer",
        };
      }
      return { success: true, path: targetPath };
    }

    const fallbackTarget = targetStats.isDirectory() ? targetPath : dirname(targetPath);
    const result = Bun.spawnSync(["xdg-open", fallbackTarget], { stdout: "pipe", stderr: "pipe" });
    if ((result.exitCode ?? 1) !== 0) {
      return {
        success: false,
        path: targetPath,
        error: result.stderr.toString().trim() || "Failed to open file manager",
      };
    }
    return { success: true, path: targetPath };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function openInSystemTerminal(inputPath: string): Promise<RevealResult> {
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
    const stats = await stat(targetPath);
    const workingDir = stats.isDirectory() ? targetPath : dirname(targetPath);

    if (process.platform === "darwin") {
      const result = Bun.spawnSync(["open", "-a", "Terminal", workingDir], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open Terminal",
        };
      }
      return { success: true, path: targetPath };
    }

    if (process.platform === "win32") {
      const command = `cd /d "${workingDir}"`;
      const result = Bun.spawnSync(["cmd", "/c", "start", "cmd", "/k", command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((result.exitCode ?? 1) !== 0) {
        return {
          success: false,
          path: targetPath,
          error: result.stderr.toString().trim() || "Failed to open terminal",
        };
      }
      return { success: true, path: targetPath };
    }

    const linuxLaunchers: Array<{ cmd: string; args: string[] }> = [
      { cmd: "gnome-terminal", args: ["--working-directory", workingDir] },
      { cmd: "konsole", args: ["--workdir", workingDir] },
      { cmd: "xfce4-terminal", args: ["--working-directory", workingDir] },
      { cmd: "x-terminal-emulator", args: ["--working-directory", workingDir] },
    ];
    for (const launcher of linuxLaunchers) {
      if (!commandAvailable(launcher.cmd)) continue;
      const result = Bun.spawnSync([launcher.cmd, ...launcher.args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((result.exitCode ?? 1) === 0) {
        return { success: true, path: targetPath };
      }
    }

    return {
      success: false,
      path: targetPath,
      error: "No supported terminal launcher found on this system",
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error instanceof Error ? error.message : String(error),
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
      }).stdout
        .toString()
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
      url: buildPermalinkUrl(remoteBaseUrl, commit, repoRelativePath, Math.max(1, Math.floor(line))),
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
