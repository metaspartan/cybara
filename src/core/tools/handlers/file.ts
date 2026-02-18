import { readFileSync, existsSync, writeFileSync, mkdirSync, promises as fs } from "fs";
import { join, dirname } from "path";
import { glob } from "tinyglobby";
import { homeDir } from "../../paths";
import { trackMetric } from "../../metrics";

const workspace = homeDir;

function expandTilde(path: string): string {
  if (path.startsWith("~")) {
    return path.replace(/^~/, homeDir);
  }
  return path;
}

export async function handleRead(
  args: Record<string, unknown>
): Promise<{ content: string; path: string }> {
  const path = expandTilde(args.path as string);
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
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
  args: Record<string, unknown>
): Promise<{ success: boolean; path: string }> {
  const path = expandTilde(args.path as string);
  const content = args.content as string;

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, content, "utf-8");

  trackMetric("file_operation", "write", 1, { path, bytes: content.length });
  trackMetric("file_write", path, 1);

  return { success: true, path };
}

export async function handleEdit(
  args: Record<string, unknown>
): Promise<{ success: boolean; path: string }> {
  const path = expandTilde(args.path as string);
  const oldText = args.oldText as string;
  const newText = args.newText as string;

  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }

  const content = readFileSync(path, "utf-8");
  if (!content.includes(oldText)) {
    throw new Error(`Text not found in file: ${oldText}`);
  }

  const newContent = content.replace(oldText, newText);
  writeFileSync(path, newContent, "utf-8");

  trackMetric("file_operation", "edit", 1, { path });
  trackMetric("file_edit", path, 1);

  return { success: true, path };
}

export async function handleFileSearch(
  args: Record<string, unknown>
): Promise<{ files: string[]; pattern: string; cwd: string; error?: string }> {
  const pattern = args.pattern as string;
  let cwd = args.cwd as string | undefined;

  if (cwd && cwd.startsWith("~")) {
    cwd = cwd.replace(/^~/, homeDir);
  }

  const searchDir = cwd || workspace;

  if (!existsSync(searchDir)) {
    return {
      files: [],
      pattern,
      cwd: searchDir,
      error: `Directory does not exist: ${searchDir}`,
    };
  }

  try {
    const files = await glob(pattern, {
      cwd: searchDir,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      onlyFiles: true,
    });

    const MAX_RESULTS = 1000;
    const limitedFiles = files.slice(0, MAX_RESULTS);

    trackMetric("file_operation", "search", 1, { pattern, resultCount: limitedFiles.length });
    trackMetric("tool_call", "file_search", 1, { pattern, resultCount: limitedFiles.length });

    return {
      files: limitedFiles,
      pattern,
      cwd: searchDir,
      ...(files.length > MAX_RESULTS
        ? { error: `Results limited to ${MAX_RESULTS} (found ${files.length} total)` }
        : {}),
    };
  } catch (err) {
    return {
      files: [],
      pattern,
      cwd: searchDir,
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

  const searchDir = path || workspace;
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
    let cmd = `rg --json --max-count=${maxResults} --context=${context}`;

    if (!caseSensitive) {
      cmd += " --ignore-case";
    }

    if (!recursive) {
      cmd += " --max-depth=1";
    }

    if (extensions && extensions.length > 0) {
      const extPattern = extensions.map((e) => e.replace(/^\./, "")).join("|");
      cmd += ` -g "*.{${extPattern}}"`;
    }

    cmd += ` ${JSON.stringify(pattern)} ${JSON.stringify(dir)}`;

    const result = Bun.spawnSync(["sh", "-c", cmd], {
      timeout: 30000,
    });

    const output = result.stdout.toString();

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      try {
        const match = JSON.parse(line);
        if (match.type === "match") {
          results.push({
            path: match.data.path?.text || match.data.path,
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

export async function handleApplyPatch(args: Record<string, unknown>): Promise<{
  success: boolean;
  applied: Array<{ path: string; hunks: number }>;
  failed: Array<{ path: string; error: string }>;
}> {
  const patch = args.patch as string;
  const dryRun = (args.dryRun as boolean) || false;

  if (!patch) {
    throw new Error("Patch content is required");
  }

  const applied: Array<{ path: string; hunks: number }> = [];
  const failed: Array<{ path: string; error: string }> = [];

  const filePatches = parsePatch(patch);

  for (const filePatch of filePatches) {
    try {
      const result = await applyFilePatch(filePatch, dryRun);
      if (result.success) {
        applied.push({ path: filePatch.path, hunks: filePatch.hunks.length });
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

  return { success: failed.length === 0, applied, failed };
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
