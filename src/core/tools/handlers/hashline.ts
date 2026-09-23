export type HashlineOp = "replace" | "delete" | "insert_after" | "insert_before";

export interface HashlineEdit {
  op: HashlineOp;
  start: string;
  end?: string;
  content?: string;
}

interface ResolvedEdit {
  op: HashlineOp;
  startLine: number;
  endLine: number;
  lines: string[];
}

const ANCHOR_PATTERN = /^\s*(\d+)\s*#\s*([0-9a-z]{3})\s*(?:\|.*)?$/is;
const RELOCATE_WINDOW = 8;
const CONTEXT_LINES = 3;
const MAX_RETURNED_REGION_LINES = 80;

export function lineHash(line: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < line.length; index += 1) {
    hash ^= line.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 46_656).toString(36).padStart(3, "0");
}

export function lineAnchor(lineNumber: number, line: string): string {
  return `${lineNumber}#${lineHash(line)}`;
}

export function splitFileLines(content: string): {
  lines: string[];
  eol: string;
  trailingNewline: boolean;
} {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, content.endsWith("\r\n") ? -2 : -1) : content;
  return {
    lines: body.length === 0 && trailingNewline ? [""] : body.split(/\r?\n/),
    eol,
    trailingNewline,
  };
}

export function formatHashlines(lines: readonly string[], firstLineNumber = 1): string {
  return lines
    .map((line, index) => `${lineAnchor(firstLineNumber + index, line)}|${line}`)
    .join("\n");
}

function contextAround(lines: readonly string[], lineNumber: number): string {
  const from = Math.max(1, lineNumber - CONTEXT_LINES);
  const to = Math.min(lines.length, lineNumber + CONTEXT_LINES);
  return formatHashlines(lines.slice(from - 1, to), from);
}

function uniqueMatch(candidates: number[]): number | undefined {
  return candidates.length === 1 ? candidates[0] : undefined;
}

function relocateByHash(lines: readonly string[], lineNumber: number, hash: string) {
  const from = Math.max(1, lineNumber - RELOCATE_WINDOW);
  const to = Math.min(lines.length, lineNumber + RELOCATE_WINDOW);
  const nearby: number[] = [];
  for (let candidate = from; candidate <= to; candidate += 1) {
    if (lineHash(lines[candidate - 1]) === hash) nearby.push(candidate);
  }
  if (nearby.length === 0) return undefined;
  const closest = Math.min(...nearby.map((candidate) => Math.abs(candidate - lineNumber)));
  return uniqueMatch(nearby.filter((candidate) => Math.abs(candidate - lineNumber) === closest));
}

function locateByContent(lines: readonly string[], text: string) {
  const exact: number[] = [];
  const trimmed: number[] = [];
  const target = text.trim();
  if (target.length === 0) return undefined;
  lines.forEach((line, index) => {
    if (line === text) exact.push(index + 1);
    if (line.trim() === target) trimmed.push(index + 1);
  });
  return uniqueMatch(exact) ?? uniqueMatch(trimmed);
}

function resolveAnchor(anchor: unknown, lines: readonly string[], label: string): number {
  if (typeof anchor !== "string") {
    throw new Error(
      `Validation error: ${label} must be a line anchor such as "12#a1b" copied from read output.`
    );
  }
  const match = ANCHOR_PATTERN.exec(anchor);
  if (!match) {
    const byContent = locateByContent(lines, anchor.replace(/^\s*\d+\s*#\s*[0-9a-z]{0,3}\|/i, ""));
    if (byContent !== undefined) return byContent;
    throw new Error(
      `Validation error: "${anchor}" is not a line anchor. Use the LINE#HASH text before the | on a line of read output.`
    );
  }
  const lineNumber = Number(match[1]);
  const hash = match[2].toLowerCase();
  if (lineNumber >= 1 && lineNumber <= lines.length && lineHash(lines[lineNumber - 1]) === hash) {
    return lineNumber;
  }
  const relocated = relocateByHash(lines, lineNumber, hash);
  if (relocated !== undefined) return relocated;
  if (lineNumber < 1 || lineNumber > lines.length) {
    throw new Error(
      `Stale anchor ${match[1]}#${hash}: the file has ${lines.length} lines. Read the file again to get current anchors.`
    );
  }
  throw new Error(
    `Stale anchor ${match[1]}#${hash}: line ${lineNumber} changed since it was read. Nothing was edited. Current lines:\n${contextAround(lines, lineNumber)}`
  );
}

function contentLines(content: unknown, op: HashlineOp): string[] {
  if (op === "delete") return [];
  if (typeof content !== "string") {
    throw new Error(`Validation error: ${op} needs a content string.`);
  }
  const normalized = content.replace(/\r\n/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed.split("\n");
}

function resolveEdits(edits: unknown, lines: readonly string[]): ResolvedEdit[] {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("Validation error: edits must be a non-empty array.");
  }
  const resolved = edits.map((raw, index): ResolvedEdit => {
    const edit = (raw ?? {}) as Partial<HashlineEdit>;
    const op = edit.op;
    if (op !== "replace" && op !== "delete" && op !== "insert_after" && op !== "insert_before") {
      throw new Error(
        `Validation error: edits[${index}].op must be replace, delete, insert_after, or insert_before.`
      );
    }
    const startLine = resolveAnchor(edit.start, lines, `edits[${index}].start`);
    const endLine =
      op === "replace" || op === "delete"
        ? edit.end === undefined
          ? startLine
          : resolveAnchor(edit.end, lines, `edits[${index}].end`)
        : startLine;
    if (endLine < startLine) {
      throw new Error(`Validation error: edits[${index}] ends before it starts.`);
    }
    return { op, startLine, endLine, lines: contentLines(edit.content, op) };
  });
  const ranges = resolved
    .filter((edit) => edit.op === "replace" || edit.op === "delete")
    .sort((a, b) => a.startLine - b.startLine);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].startLine <= ranges[index - 1].endLine) {
      throw new Error(
        "Validation error: edits overlap. Combine overlapping edits into one replace."
      );
    }
  }
  for (const edit of resolved) {
    if (edit.op !== "insert_after" && edit.op !== "insert_before") continue;
    const gap = edit.op === "insert_after" ? edit.startLine : edit.startLine - 1;
    if (ranges.some((range) => gap > range.startLine - 1 && gap < range.endLine)) {
      throw new Error(
        "Validation error: an insert falls inside a range that is being replaced. Put the new lines in that replace's content instead."
      );
    }
  }
  return resolved;
}

export interface HashlineApplyResult {
  content: string;
  changedRegions: string[];
}

export function applyHashlineEdits(original: string, edits: unknown): HashlineApplyResult {
  const { lines, eol, trailingNewline } = splitFileLines(original);
  const resolved = resolveEdits(edits, lines);
  const insertionOffset = (edit: ResolvedEdit) =>
    edit.op === "insert_after" ? edit.startLine : edit.startLine - 1;
  const isInsert = (edit: ResolvedEdit) =>
    edit.op === "insert_after" || edit.op === "insert_before";
  const position = (edit: ResolvedEdit) =>
    isInsert(edit) ? insertionOffset(edit) : edit.startLine - 1;
  const ordered = [...resolved].sort((a, b) => {
    const byPosition = position(b) - position(a);
    if (byPosition !== 0) return byPosition;
    return Number(isInsert(a)) - Number(isInsert(b));
  });
  const next = [...lines];
  for (const edit of ordered) {
    if (edit.op === "insert_after" || edit.op === "insert_before") {
      next.splice(insertionOffset(edit), 0, ...edit.lines);
    } else {
      next.splice(edit.startLine - 1, edit.endLine - edit.startLine + 1, ...edit.lines);
    }
  }
  const content = next.join(eol) + (trailingNewline ? eol : "");
  const changedRegions = changedRegionAnchors(lines, next);
  return { content, changedRegions };
}

function changedRegionAnchors(before: readonly string[], after: readonly string[]): string[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const from = Math.max(0, prefix - 2);
  const to = Math.min(after.length, after.length - suffix + 2);
  if (to <= from) return [];
  if (to - from > MAX_RETURNED_REGION_LINES) {
    const head = formatHashlines(after.slice(from, from + 20), from + 1);
    const tail = formatHashlines(after.slice(to - 20, to), to - 19);
    return [head, tail];
  }
  return [formatHashlines(after.slice(from, to), from + 1)];
}

export const HASHLINE_READ_DESCRIPTION =
  "Read file contents or list a directory. Text files are returned with an anchor before every line in the form LINE#HASH|content, for example 12#a1b|const total = 0; — pass the LINE#HASH part (before the |) with the edit tool. Reading a supported image attaches its pixels to the next turn for vision-capable models.";

export const HASHLINE_EDIT_DESCRIPTION =
  "Edit a file by line anchors copied from read output (the LINE#HASH text before the | on each line). Each edit is one of: replace (lines start..end, inclusive, with content), delete (lines start..end), insert_after (content after the start line), insert_before (content before the start line). Send several non-overlapping edits in one call. If a file changed since it was read, the anchors no longer match and nothing is written; the error shows the current anchors to retry with. The result returns fresh anchors around each change, so you can keep editing without reading the file again.";

export const hashlineEditInputSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "Path to the file" },
    edits: {
      type: "array",
      description: "Edits to apply together",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["replace", "delete", "insert_after", "insert_before"] },
          start: {
            type: "string",
            description: "LINE#HASH of the first line, copied from read output",
          },
          end: {
            type: "string",
            description: "Anchor of the last line for replace or delete (defaults to start)",
          },
          content: {
            type: "string",
            description: "New lines for replace, insert_after, or insert_before",
          },
        },
        required: ["op", "start"],
      },
    },
  },
  required: ["path", "edits"],
};
