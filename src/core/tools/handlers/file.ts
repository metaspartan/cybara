import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  promises as fs,
} from "fs";
import { join, dirname, isAbsolute, sep } from "path";
import { glob } from "tinyglobby";
import { homeDir } from "../../paths";
import { trackMetric } from "../../metrics";
import type { ToolContext } from "../index";
import { assertWritablePath, assertReadablePath } from "../path-policy";

const workspace = homeDir;

/** Case-insensitive + small-edit similarity for path-typo suggestions. */
function pathSegmentSimilarity(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA === lowerB) return 1;
  // Bounded Levenshtein ratio (short segments only).
  const m = lowerA.length;
  const n = lowerB.length;
  if (m === 0 || n === 0) return 0;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = lowerA[i - 1] === lowerB[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  const distance = prev[n];
  return 1 - distance / Math.max(m, n);
}

/**
 * When a path doesn't exist, walk down from its deepest existing ancestor and,
 * at the first missing segment, find the closest real entry (a case or typo
 * fix like "Github"->"GitHub" or "Gybara"->"GitHub"). Returns a corrected path
 * suggestion so the model self-corrects instead of retrying the same typo.
 */
function suggestNearbyPath(target: string): string | undefined {
  try {
    if (!isAbsolute(target)) return undefined;
    const segments = target.split(sep).filter(Boolean);
    let current: string = sep;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const next = join(current, segment);
      if (existsSync(next)) {
        current = next;
        continue;
      }
      // First missing segment: look for the closest sibling entry.
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        return undefined;
      }
      let best: { name: string; score: number } | undefined;
      for (const name of entries) {
        const score = pathSegmentSimilarity(segment, name);
        if (score >= 0.6 && (!best || score > best.score)) {
          best = { name, score };
        }
      }
      if (!best) return undefined;
      const corrected = [current, best.name, ...segments.slice(i + 1)]
        .join(sep)
        .replace(/\/+/g, sep);
      // Only suggest when the corrected prefix actually exists on disk.
      return existsSync(join(current, best.name)) ? corrected : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function fileNotFoundError(path: string): Error {
  const suggestion = suggestNearbyPath(path);
  if (suggestion && suggestion !== path) {
    return new Error(`File not found: ${path}. Did you mean: ${suggestion}?`);
  }
  return new Error(`File not found: ${path}`);
}

type FileChangeType = "created" | "updated" | "deleted";

interface FileChangeMeta {
  path: string;
  type: FileChangeType;
  addedLines: number;
  removedLines: number;
  diff: string;
}

function expandTilde(path: string | undefined): string | undefined {
  if (!path) return path;
  if (path.startsWith("~")) {
    return path.replace(/^~/, homeDir);
  }
  return path;
}

function resolveSearchResultPath(searchDir: string, resultPath: string): string {
  return isAbsolute(resultPath) ? resultPath : join(searchDir, resultPath);
}

function isReadableSearchResult(searchDir: string, resultPath: string): boolean {
  try {
    assertReadablePath(resolveSearchResultPath(searchDir, resultPath));
    return true;
  } catch {
    return false;
  }
}

function splitLines(content: string): string[] {
  if (!content) return [];
  return content.split(/\r?\n/);
}

function computeLineDelta(
  before: string,
  after: string
): { addedLines: number; removedLines: number } {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  if (beforeLines.length === 0) {
    return { addedLines: afterLines.length, removedLines: 0 };
  }
  if (afterLines.length === 0) {
    return { addedLines: 0, removedLines: beforeLines.length };
  }

  const matrixBudget = beforeLines.length * afterLines.length;
  if (matrixBudget > 160_000) {
    const delta = afterLines.length - beforeLines.length;
    return {
      addedLines: Math.max(0, delta),
      removedLines: Math.max(0, -delta),
    };
  }

  let prev = new Array<number>(afterLines.length + 1).fill(0);
  for (let i = 1; i <= beforeLines.length; i += 1) {
    const next = new Array<number>(afterLines.length + 1).fill(0);
    for (let j = 1; j <= afterLines.length; j += 1) {
      if (beforeLines[i - 1] === afterLines[j - 1]) {
        next[j] = prev[j - 1] + 1;
      } else {
        next[j] = Math.max(prev[j], next[j - 1]);
      }
    }
    prev = next;
  }

  const lcs = prev[afterLines.length] || 0;
  return {
    addedLines: Math.max(0, afterLines.length - lcs),
    removedLines: Math.max(0, beforeLines.length - lcs),
  };
}

function truncateDiff(diff: string, maxLines = 220): string {
  const lines = diff.split(/\r?\n/);
  if (lines.length <= maxLines) return diff;
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... [diff truncated, ${omitted} lines omitted]`].join("\n");
}

function buildLineDiffOperations(beforeLines: string[], afterLines: string[]): string[] {
  const matrixBudget = beforeLines.length * afterLines.length;
  if (matrixBudget > 160_000) {
    const operations: string[] = [];
    const maxLength = Math.max(beforeLines.length, afterLines.length);
    for (let index = 0; index < maxLength; index += 1) {
      const beforeLine = beforeLines[index];
      const afterLine = afterLines[index];
      if (beforeLine === afterLine && beforeLine !== undefined) {
        operations.push(` ${beforeLine}`);
        continue;
      }
      if (beforeLine !== undefined) {
        operations.push(`-${beforeLine}`);
      }
      if (afterLine !== undefined) {
        operations.push(`+${afterLine}`);
      }
    }
    return operations;
  }

  const lcsMatrix = Array.from({ length: beforeLines.length + 1 }, () =>
    new Array<number>(afterLines.length + 1).fill(0)
  );

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lcsMatrix[beforeIndex][afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? lcsMatrix[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(
              lcsMatrix[beforeIndex + 1][afterIndex],
              lcsMatrix[beforeIndex][afterIndex + 1]
            );
    }
  }

  const operations: string[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      operations.push(` ${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (lcsMatrix[beforeIndex + 1][afterIndex] >= lcsMatrix[beforeIndex][afterIndex + 1]) {
      operations.push(`-${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
    } else {
      operations.push(`+${afterLines[afterIndex]}`);
      afterIndex += 1;
    }
  }

  while (beforeIndex < beforeLines.length) {
    operations.push(`-${beforeLines[beforeIndex]}`);
    beforeIndex += 1;
  }

  while (afterIndex < afterLines.length) {
    operations.push(`+${afterLines[afterIndex]}`);
    afterIndex += 1;
  }

  return operations;
}

export function buildUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const operations = buildLineDiffOperations(beforeLines, afterLines);
  const hasChanges = operations.some((line) => line.startsWith("+") || line.startsWith("-"));
  if (!hasChanges) {
    return "(No changes)";
  }
  const header = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  return truncateDiff([...header, ...operations].join("\n"));
}

export async function handleRead(
  args: Record<string, unknown>
): Promise<{ content: string; path: string }> {
  const rawPath =
    typeof args.path === "string"
      ? args.path
      : typeof args.file === "string"
        ? args.file
        : undefined;
  const path = expandTilde(rawPath);
  if (!path) {
    throw new Error(
      'Validation error: path is required. Provide a file path (for example: {"path":"src/index.ts"}).'
    );
  }
  // Block reads of sensitive credential/key files (SSH keys, .env, cloud creds,
  // etc.) so an agent/prompt-injection can't read and exfiltrate them. Validate
  // only — keep using the original (non-normalized) path for the actual read so
  // case-sensitive filesystems and the returned path are preserved.
  assertReadablePath(path);
  if (!existsSync(path)) {
    throw fileNotFoundError(path);
  }

  const content = readFileSync(path, "utf-8");
  let lines = content.split("\n");

  const offset = args.offset as number | undefined;
  const limit = args.limit as number | undefined;

  if (offset) {
    lines = lines.slice(offset - 1);
  }
  if (limit) {
    lines = lines.slice(0, limit);
  }

  trackMetric("file_operation", "read", 1, { path });
  trackMetric("file_read", path, 1);

  return {
    content: lines.join("\n"),
    path,
  };
}

export async function handleWrite(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; path: string; change: FileChangeMeta }> {
  const rawPath = typeof args.path === "string" ? args.path : undefined;
  const path = assertWritablePath(expandTilde(rawPath), {
    workspaceRoot: context?.workspaceDir,
    extraDenyPrefixes: context?.denyWritePrefixes,
    confineToWorkspace: context?.confineToWorkspace,
  });
  if (!rawPath) {
    throw new Error(
      'Validation error: path is required. Provide a file path (for example: {"path":"src/index.ts"}).'
    );
  }
  const content = args.content as string;
  const existed = existsSync(path);
  const before = existed ? readFileSync(path, "utf-8") : "";

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, content, "utf-8");
  const { addedLines, removedLines } = computeLineDelta(before, content);

  trackMetric("file_operation", "write", 1, { path, bytes: content.length });
  trackMetric("file_write", path, 1);

  return {
    success: true,
    path,
    change: {
      path,
      type: existed ? "updated" : "created",
      addedLines,
      removedLines,
      diff: buildUnifiedDiff(path, before, content),
    },
  };
}

export async function handleEdit(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; path: string; change: FileChangeMeta }> {
  const rawPath = typeof args.path === "string" ? args.path : undefined;
  const path = assertWritablePath(expandTilde(rawPath), {
    workspaceRoot: context?.workspaceDir,
    extraDenyPrefixes: context?.denyWritePrefixes,
    confineToWorkspace: context?.confineToWorkspace,
  });
  if (!rawPath) {
    throw new Error(
      'Validation error: path is required. Provide a file path (for example: {"path":"src/index.ts"}).'
    );
  }
  const oldText = args.oldText as string;
  const newText = args.newText as string;

  if (!existsSync(path)) {
    throw fileNotFoundError(path);
  }

  const content = readFileSync(path, "utf-8");
  if (!content.includes(oldText)) {
    throw new Error(`Text not found in file: ${oldText}`);
  }

  const newContent = content.replace(oldText, newText);
  writeFileSync(path, newContent, "utf-8");
  const { addedLines, removedLines } = computeLineDelta(content, newContent);

  trackMetric("file_operation", "edit", 1, { path });
  trackMetric("file_edit", path, 1);

  return {
    success: true,
    path,
    change: {
      path,
      type: "updated",
      addedLines,
      removedLines,
      diff: buildUnifiedDiff(path, content, newContent),
    },
  };
}

export async function handleFileSearch(
  args: Record<string, unknown>
): Promise<{ files: string[]; pattern: string; cwd: string; error?: string }> {
  const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
  let cwd = args.cwd as string | undefined;

  if (cwd && cwd.startsWith("~")) {
    cwd = cwd.replace(/^~/, homeDir);
  }

  const searchDir = cwd || workspace;
  const safeSearchDir = assertReadablePath(searchDir);

  if (!pattern) {
    return {
      files: [],
      pattern: "",
      cwd: safeSearchDir,
      error:
        'pattern is required. Provide a glob pattern (for example: "**/*.ts" or "src/**/*.md").',
    };
  }

  if (!existsSync(safeSearchDir)) {
    return {
      files: [],
      pattern,
      cwd: safeSearchDir,
      error: `Directory does not exist: ${safeSearchDir}`,
    };
  }

  try {
    const files = await glob(pattern, {
      cwd: safeSearchDir,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      onlyFiles: true,
    });

    const MAX_RESULTS = 1000;
    const readableFiles = files.filter((file) => isReadableSearchResult(safeSearchDir, file));
    const limitedFiles = readableFiles.slice(0, MAX_RESULTS);

    trackMetric("file_operation", "search", 1, { pattern, resultCount: limitedFiles.length });
    trackMetric("tool_call", "file_search", 1, { pattern, resultCount: limitedFiles.length });

    return {
      files: limitedFiles,
      pattern,
      cwd: safeSearchDir,
      ...(readableFiles.length > MAX_RESULTS
        ? { error: `Results limited to ${MAX_RESULTS} (found ${readableFiles.length} total)` }
        : {}),
    };
  } catch (err) {
    return {
      files: [],
      pattern,
      cwd: safeSearchDir,
      error: `Glob search failed: ${(err as Error).message}`,
    };
  }
}

export async function handleGrep(args: Record<string, unknown>): Promise<{
  results: Array<{ path: string; line: number; content: string }>;
  pattern: string;
  count: number;
  source: string;
}> {
  const pattern = args.pattern as string;
  const path = args.path as string | undefined;
  const fileType = args.type as string | undefined;
  const context = (args.context as number) || 2;
  const maxResults = (args.maxResults as number) || 50;
  const caseSensitive = args.caseSensitive as boolean | undefined;
  const shouldRecursive = args.recursive !== false;

  const searchDir = assertReadablePath(expandTilde(path) || workspace);
  const extensions = fileType ? fileType.split(",").map((t) => t.trim()) : null;

  const results: Array<{ path: string; line: number; content: string }> = [];

  const hasRipgrep = await checkRipgrepAvailable();

  if (hasRipgrep) {
    await searchWithRipgrep(
      searchDir,
      pattern,
      extensions,
      caseSensitive,
      shouldRecursive,
      context,
      results,
      maxResults
    );
  } else {
    await searchDirectory(
      searchDir,
      pattern,
      extensions,
      caseSensitive,
      shouldRecursive,
      context,
      results,
      maxResults
    );
  }

  trackMetric("file_operation", "search", 1, { pattern, resultCount: results.length });
  trackMetric("tool_call", "grep", 1, {
    resultCount: results.length,
    source: hasRipgrep ? "ripgrep" : "javascript",
  });

  return { results, pattern, count: results.length, source: hasRipgrep ? "ripgrep" : "javascript" };
}

async function checkRipgrepAvailable(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const result = Bun.spawnSync(["where", "rg"], { timeout: 5000 });
      return result.exitCode === 0;
    }
    const result = Bun.spawnSync(["sh", "-c", "which rg || command -v rg"], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function searchWithRipgrep(
  dir: string,
  pattern: string,
  extensions: string[] | null,
  caseSensitive: boolean | undefined,
  recursive: boolean,
  context: number,
  results: Array<{ path: string; line: number; content: string }>,
  maxResults: number
): Promise<void> {
  try {
    const args = ["--json", `--max-count=${maxResults}`, `--context=${context}`];

    if (!caseSensitive) {
      args.push("--ignore-case");
    }

    if (!recursive) {
      args.push("--max-depth=1");
    }

    if (extensions && extensions.length > 0) {
      const extPattern = extensions.map((e) => e.replace(/^\./, "")).join("|");
      args.push("-g", `*.{${extPattern}}`);
    }

    args.push(pattern, dir);

    const result = Bun.spawnSync(["rg", ...args], {
      timeout: 30000,
    });

    const output = result.stdout.toString();

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      try {
        const match = JSON.parse(line);
        if (match.type === "match") {
          const matchedPath = match.data.path?.text || match.data.path;
          if (!matchedPath || !isReadableSearchResult(dir, matchedPath)) continue;
          results.push({
            path: matchedPath,
            line: match.data.line_number || 1,
            content: match.data.lines?.text || "",
          });
        }
      } catch {
        void 0;
      }
    }
  } catch (e) {
    console.error("[grep] ripgrep error:", e);
  }
}

async function searchDirectory(
  dir: string,
  pattern: string,
  extensions: string[] | null,
  caseSensitive: boolean | undefined,
  recursive: boolean,
  context: number,
  results: Array<{ path: string; line: number; content: string }>,
  maxResults: number
): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) return;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          recursive &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules" &&
          entry.name !== ".git"
        ) {
          await searchDirectory(
            fullPath,
            pattern,
            extensions,
            caseSensitive,
            recursive,
            context,
            results,
            maxResults
          );
        }
      } else if (entry.isFile()) {
        try {
          assertReadablePath(fullPath);
        } catch {
          continue;
        }
        if (extensions) {
          const ext = "." + entry.name.split(".").pop();
          if (
            !extensions.includes(ext) &&
            !extensions.includes(entry.name.split(".").pop() || "")
          ) {
            continue;
          }
        }

        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const regex = caseSensitive ? new RegExp(pattern, "g") : new RegExp(pattern, "gi");

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const startLine = Math.max(0, i - context);
            const endLine = Math.min(lines.length - 1, i + context);

            for (let j = startLine; j <= endLine; j++) {
              if (results.length >= maxResults) break;
              results.push({
                path: fullPath,
                line: j + 1,
                content: lines[j],
              });
            }
          }
        }
      }
    }
  } catch {
    // Ignore permission errors
  }
}

export async function handleApplyPatch(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  success: boolean;
  applied: Array<{ path: string; hunks: number }>;
  failed: Array<{ path: string; error: string }>;
  changes: FileChangeMeta[];
  summary: {
    filesChanged: number;
    addedLines: number;
    removedLines: number;
  };
}> {
  const patch = args.patch as string;
  const dryRun = (args.dryRun as boolean) || false;

  if (!patch) {
    throw new Error("Patch content is required");
  }

  const policyOptions = {
    workspaceRoot: context?.workspaceDir,
    extraDenyPrefixes: context?.denyWritePrefixes,
    confineToWorkspace: context?.confineToWorkspace,
  };

  const applied: Array<{ path: string; hunks: number }> = [];
  const failed: Array<{ path: string; error: string }> = [];
  const changes: FileChangeMeta[] = [];

  const filePatches = parsePatch(patch);

  for (const filePatch of filePatches) {
    try {
      // Enforce the write path-policy on each file touched by the patch.
      assertWritablePath(expandTilde(filePatch.path), policyOptions);
      const result = await applyFilePatch(filePatch, dryRun);
      if (result.success) {
        applied.push({ path: filePatch.path, hunks: filePatch.hunks.length });
        changes.push(buildPatchChangeMeta(filePatch));
      } else {
        failed.push({ path: filePatch.path, error: result.error || "Unknown error" });
      }
    } catch (error) {
      failed.push({ path: filePatch.path, error: (error as Error).message });
    }
  }

  trackMetric("file_operation", "apply_patch", 1, {
    filesApplied: applied.length,
    filesFailed: failed.length,
    dryRun,
  });

  const summary = {
    filesChanged: changes.length,
    addedLines: changes.reduce((sum, change) => sum + change.addedLines, 0),
    removedLines: changes.reduce((sum, change) => sum + change.removedLines, 0),
  };

  return { success: failed.length === 0, applied, failed, changes, summary };
}

interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface FilePatch {
  path: string;
  oldPath?: string;
  isNew: boolean;
  isDelete: boolean;
  hunks: PatchHunk[];
}

function buildPatchChangeMeta(filePatch: FilePatch): FileChangeMeta {
  let addedLines = 0;
  let removedLines = 0;
  const diffLines: string[] = [];
  const oldPath = filePatch.oldPath || filePatch.path;
  const newPath = filePatch.isDelete ? "/dev/null" : filePatch.path;
  const oldPathForDiff = filePatch.isNew ? "/dev/null" : oldPath;

  diffLines.push(`--- a/${oldPathForDiff}`);
  diffLines.push(`+++ b/${newPath}`);

  for (const hunk of filePatch.hunks) {
    diffLines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        addedLines += 1;
      } else if (line.startsWith("-")) {
        removedLines += 1;
      }
      diffLines.push(line);
    }
  }

  return {
    path: filePatch.path,
    type: filePatch.isNew ? "created" : filePatch.isDelete ? "deleted" : "updated",
    addedLines,
    removedLines,
    diff: truncateDiff(diffLines.join("\n")),
  };
}

function parsePatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  const lines = patch.split("\n");
  let currentFile: FilePatch | null = null;
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("--- ")) {
      const oldPath = line
        .slice(4)
        .replace(/^[ab]\//, "")
        .trim();

      if (i + 1 < lines.length && lines[i + 1].startsWith("+++ ")) {
        const newPath = lines[i + 1]
          .slice(4)
          .replace(/^[ab]\//, "")
          .trim();

        if (currentFile && currentHunk) {
          currentFile.hunks.push(currentHunk);
        }
        if (currentFile) {
          files.push(currentFile);
        }

        currentFile = {
          path: newPath === "/dev/null" ? oldPath : newPath,
          oldPath: oldPath === "/dev/null" ? undefined : oldPath,
          isNew: oldPath === "/dev/null",
          isDelete: newPath === "/dev/null",
          hunks: [],
        };
        currentHunk = null;
        i++; // Skip +++ line
      }
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
      }

      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2] || "1"),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4] || "1"),
          lines: [],
        };
      }
      continue;
    }

    if (
      currentHunk &&
      (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line === "")
    ) {
      currentHunk.lines.push(line);
    }
  }

  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

async function applyFilePatch(
  filePatch: FilePatch,
  dryRun: boolean
): Promise<{ success: boolean; error?: string }> {
  if (filePatch.isDelete) {
    if (!dryRun && existsSync(filePatch.path)) {
      await fs.unlink(filePatch.path);
    }
    return { success: true };
  }

  if (filePatch.isNew) {
    const content = filePatch.hunks
      .flatMap((h) => h.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)))
      .join("\n");

    if (!dryRun) {
      const dir = dirname(filePatch.path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePatch.path, content, "utf-8");
    }
    return { success: true };
  }

  if (!existsSync(filePatch.path)) {
    return { success: false, error: `File not found: ${filePatch.path}` };
  }

  const content = readFileSync(filePatch.path, "utf-8");
  const lines = content.split("\n");

  const sortedHunks = [...filePatch.hunks].sort((a, b) => b.oldStart - a.oldStart);

  for (const hunk of sortedHunks) {
    const startIdx = hunk.oldStart - 1;
    const deleteCount = hunk.oldLines;

    const newLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.startsWith(" ") || line.startsWith("+")) {
        newLines.push(line.slice(1));
      }
    }

    lines.splice(startIdx, deleteCount, ...newLines);
  }

  const newContent = lines.join("\n");

  if (!dryRun) {
    writeFileSync(filePatch.path, newContent, "utf-8");
  }

  return { success: true };
}
