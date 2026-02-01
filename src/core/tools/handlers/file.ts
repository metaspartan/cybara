// Tool handlers - file operations
import { readFileSync, existsSync, writeFileSync, mkdirSync, promises as fs } from "fs";
import { join, dirname } from "path";
import { glob } from "tinyglobby";
import { projectRoot } from "../../paths";
import { trackMetric } from "../../metrics";

const workspace = projectRoot;


export async function handleRead(
  args: Record<string, unknown>
): Promise<{ content: string; path: string }> {
  const path = args.path as string;
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

  // Track file read
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
  const path = args.path as string;
  const content = args.content as string;

  // Ensure parent directory exists
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, content, "utf-8");

  // Track file write
  trackMetric("file_operation", "write", 1, { path, bytes: content.length });
  trackMetric("file_write", path, 1);

  return { success: true, path };
}

export async function handleEdit(
  args: Record<string, unknown>
): Promise<{ success: boolean; path: string }> {
  const path = args.path as string;
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

  // Track file edit
  trackMetric("file_operation", "edit", 1, { path });
  trackMetric("file_edit", path, 1);

  return { success: true, path };
}

export async function handleFileSearch(
  args: Record<string, unknown>
): Promise<{ files: string[]; pattern: string }> {
  const pattern = args.pattern as string;
  const cwd = args.cwd as string | undefined;

  // Simple glob implementation
  const searchDir = cwd || workspace;
  const files = await globFiles(searchDir, pattern);

  // Track file search
  trackMetric("file_operation", "search", 1, { pattern, resultCount: files.length });
  trackMetric("tool_call", "file_search", 1, { pattern, resultCount: files.length });

  return { files, pattern };
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

  // Try ripgrep first if available
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
    // Fallback to JavaScript implementation
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

  // Track grep usage
  trackMetric("file_operation", "search", 1, { pattern, resultCount: results.length });
  trackMetric("tool_call", "grep", 1, {
    resultCount: results.length,
    source: hasRipgrep ? "ripgrep" : "javascript",
  });

  return { results, pattern, count: results.length, source: hasRipgrep ? "ripgrep" : "javascript" };
}

async function checkRipgrepAvailable(): Promise<boolean> {
  try {
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
    // Build ripgrep command
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

    // Add pattern and path
    cmd += ` ${JSON.stringify(pattern)} ${JSON.stringify(dir)}`;

    const result = Bun.spawnSync(["sh", "-c", cmd], {
      timeout: 30000,
    });

    const output = result.stdout.toString();

    // Parse JSON output from ripgrep
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
        // Skip non-JSON lines
      }
    }
  } catch (e) {
    // If ripgrep fails, the caller will fall back to JS implementation
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
        // Check extension filter
        if (extensions) {
          const ext = "." + entry.name.split(".").pop();
          if (
            !extensions.includes(ext) &&
            !extensions.includes(entry.name.split(".").pop() || "")
          ) {
            continue;
          }
        }

        // Search in file
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const regex = caseSensitive ? new RegExp(pattern, "g") : new RegExp(pattern, "gi");

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            // Get context lines
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

async function globFiles(dir: string, pattern: string): Promise<string[]> {
  try {
    const matches = await glob(pattern, { cwd: dir });
    return matches;
  } catch {
    return [];
  }
}
