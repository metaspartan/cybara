import { existsSync } from "fs";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, extname, join, relative } from "path";
import type {
  IdeListFilesResult,
  IdeReplacePreviewFile,
  IdeReplacePreviewResult,
  IdeReplaceResult,
  IdeSearchFileResult,
  IdeSearchMatch,
  IdeSearchResult,
} from "./ide-api";
import { isIdeBinaryExtension as isBinaryExtension } from "./ide-file-policy";
import {
  IDE_HOME_DIR as HOME_DIR,
  isIdePathAllowed as isPathAllowed,
  normalizeIdeInputPath as normalizePath,
} from "./ide-path-policy";

const SEARCH_MAX_FILE_SIZE = 2 * 1024 * 1024;
const SEARCH_DEFAULT_MAX_FILES_SCANNED = 25_000;
const SEARCH_HARD_MAX_FILES_SCANNED = 100_000;

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

function normalizeMaxFilesScanned(value: number | undefined): number {
  if (!Number.isFinite(value)) return SEARCH_DEFAULT_MAX_FILES_SCANNED;
  return Math.max(1, Math.min(Math.floor(value as number), SEARCH_HARD_MAX_FILES_SCANNED));
}

interface SearchFileCollector {
  files: string[];
  filesScanned: number;
  truncated: boolean;
  maxFilesScanned: number;
}

async function collectSearchFiles(dirPath: string, collector: SearchFileCollector): Promise<void> {
  if (collector.truncated) return;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (collector.truncated) return;
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SEARCH_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".cybara") continue;
      await collectSearchFiles(entryPath, collector);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isTextSearchCandidate(entryPath)) continue;
    if (collector.filesScanned >= collector.maxFilesScanned) {
      collector.truncated = true;
      return;
    }
    collector.filesScanned += 1;
    collector.files.push(entryPath);
  }
}

async function collectSearchTarget(
  targetPath: string,
  targetStats: { isDirectory(): boolean; isFile(): boolean },
  collector: SearchFileCollector
): Promise<void> {
  if (targetStats.isDirectory()) {
    await collectSearchFiles(targetPath, collector);
    return;
  }
  if (!targetStats.isFile() || !isTextSearchCandidate(targetPath)) return;
  collector.filesScanned = 1;
  collector.files.push(targetPath);
}

export async function searchWorkspace(
  inputPath: string,
  query: string,
  options?: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    maxResults?: number;
    maxFilesScanned?: number;
  }
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
      filesScanned: 0,
      scanTruncated: false,
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
      filesScanned: 0,
      scanTruncated: false,
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
      filesScanned: 0,
      scanTruncated: false,
      files: [],
      error: "Path does not exist",
    };
  }

  const maxResults = Math.max(1, Math.min(options?.maxResults || 2000, 10000));
  const targetStats = await stat(targetPath);
  const collector: SearchFileCollector = {
    files: [],
    filesScanned: 0,
    truncated: false,
    maxFilesScanned: normalizeMaxFilesScanned(options?.maxFilesScanned),
  };
  await collectSearchTarget(targetPath, targetStats, collector);

  const files: IdeSearchFileResult[] = [];
  let totalMatches = 0;
  let truncated = collector.truncated;

  for (const filePath of collector.files) {
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
    path: targetPath,
    query: trimmedQuery,
    totalMatches,
    truncated,
    filesScanned: collector.filesScanned,
    scanTruncated: collector.truncated,
    files,
  };
}

export function applyReplacements(
  content: string,
  query: string,
  replacement: string,
  options?: { caseSensitive?: boolean; wholeWord?: boolean; useRegex?: boolean }
): { content: string; replacements: number } {
  const patternSource = options?.useRegex ? query : escapeRegExp(query);
  const pattern =
    options?.wholeWord && !options?.useRegex ? `\\b${patternSource}\\b` : patternSource;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, options?.caseSensitive ? "g" : "gi");
  } catch {
    return { content, replacements: 0 }; // invalid regex → no changes
  }
  const matches = content.match(regex);
  const replacements = matches ? matches.length : 0;
  if (replacements === 0) return { content, replacements: 0 };
  const nextContent = options?.useRegex
    ? content.replace(regex, replacement)
    : content.replace(regex, () => replacement);
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
    maxFilesScanned?: number;
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
      truncated: false,
      filesScanned: 0,
      scanTruncated: false,
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
      truncated: searchResult.truncated,
      filesScanned: searchResult.filesScanned,
      scanTruncated: searchResult.scanTruncated,
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
    truncated: searchResult.truncated,
    filesScanned: searchResult.filesScanned,
    scanTruncated: searchResult.scanTruncated,
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
    maxFilesScanned?: number;
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
      filesScanned: 0,
      scanTruncated: false,
      error: "Query cannot be empty",
    };
  }

  const searchResult = await searchWorkspace(targetPath, trimmedQuery, {
    caseSensitive: options?.caseSensitive,
    wholeWord: options?.wholeWord,
    maxResults: 10000,
    maxFilesScanned: options?.maxFilesScanned,
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
      filesScanned: searchResult.filesScanned,
      scanTruncated: searchResult.scanTruncated,
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
    filesScanned: searchResult.filesScanned,
    scanTruncated: searchResult.scanTruncated,
  };
}

export async function listWorkspaceFiles(
  inputPath: string,
  options?: { query?: string; limit?: number; maxFilesScanned?: number }
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
      filesScanned: 0,
      scanTruncated: false,
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
      filesScanned: 0,
      scanTruncated: false,
      files: [],
      error: "Path does not exist",
    };
  }

  const targetStats = await stat(targetPath);
  const collector: SearchFileCollector = {
    files: [],
    filesScanned: 0,
    truncated: false,
    maxFilesScanned: normalizeMaxFilesScanned(options?.maxFilesScanned),
  };
  await collectSearchTarget(targetPath, targetStats, collector);

  const normalizedQuery = query.toLowerCase();
  const limit = Math.max(1, Math.min(options?.limit || 200, 2000));
  const files: Array<{ path: string; relativePath: string }> = [];
  let truncated = collector.truncated;

  for (const filePath of collector.files) {
    const relativePath = targetStats.isDirectory()
      ? relative(targetPath, filePath).replaceAll("\\", "/")
      : basename(filePath);
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
    path: targetPath,
    query,
    totalFiles: files.length,
    truncated,
    filesScanned: collector.filesScanned,
    scanTruncated: collector.truncated,
    files,
  };
}
