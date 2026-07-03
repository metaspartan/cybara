export type IdePendingLineState = "added" | "removed" | "mixed";

export interface IdePendingDeletedBlock {
  anchorLine: number;
  lines: string[];
}

export interface IdePendingDiffDecorations {
  lineStates: Map<number, IdePendingLineState>;
  deletedBlocks: IdePendingDeletedBlock[];
}

export interface IdeGitDiffLineCounts {
  added: number;
  removed: number;
  truncated: boolean;
}

export interface IdePendingInlinePreviewRow {
  kind: "context" | "added" | "removed";
  lineNumber: number | null;
  text: string;
}

function combineLineStates(
  current: IdePendingLineState | undefined,
  next: IdePendingLineState
): IdePendingLineState {
  if (!current || current === next) return next;
  return "mixed";
}

function normalizeAnchorLine(anchorLine: number, currentLineCount?: number): number {
  const roundedAnchor = Number.isFinite(anchorLine) ? Math.max(1, Math.round(anchorLine)) : 1;
  if (typeof currentLineCount !== "number" || !Number.isFinite(currentLineCount)) {
    return roundedAnchor;
  }
  return Math.min(roundedAnchor, Math.max(1, Math.round(currentLineCount)));
}

export function emptyIdePendingDiffDecorations(): IdePendingDiffDecorations {
  return {
    lineStates: new Map<number, IdePendingLineState>(),
    deletedBlocks: [],
  };
}

export function countGitDiffLineChanges(diffText: string): IdeGitDiffLineCounts {
  if (typeof diffText !== "string" || !diffText.trim() || diffText.includes("(No changes)")) {
    return { added: 0, removed: 0, truncated: false };
  }

  let added = 0;
  let removed = 0;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }

  return {
    added,
    removed,
    truncated: diffText.includes("[diff truncated"),
  };
}

export function parseGitDiffDecorations(
  diffText: string,
  currentLineCount?: number
): IdePendingDiffDecorations {
  const decorations = emptyIdePendingDiffDecorations();
  if (typeof diffText !== "string" || !diffText.trim() || diffText.includes("(No changes)")) {
    return decorations;
  }

  const markLineState = (lineNumber: number, state: IdePendingLineState) => {
    const normalizedLine = normalizeAnchorLine(lineNumber, currentLineCount);
    const currentState = decorations.lineStates.get(normalizedLine);
    decorations.lineStates.set(normalizedLine, combineLineStates(currentState, state));
  };

  let newLine = 0;
  let pendingRemovedAnchor = 0;
  let pendingRemovedLines: string[] = [];

  const flushPendingRemoved = () => {
    if (pendingRemovedLines.length === 0) return;
    const anchorLine = normalizeAnchorLine(pendingRemovedAnchor || newLine || 1, currentLineCount);
    decorations.deletedBlocks.push({
      anchorLine,
      lines: pendingRemovedLines.map((line) => line.replace(/\r/g, "")),
    });
    markLineState(anchorLine, "removed");
    pendingRemovedAnchor = 0;
    pendingRemovedLines = [];
  };

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      flushPendingRemoved();
      const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        newLine = Number(match[1]) || 0;
      }
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      markLineState(newLine || 1, "added");
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (pendingRemovedLines.length === 0) {
        pendingRemovedAnchor = newLine || 1;
      }
      pendingRemovedLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      flushPendingRemoved();
      newLine += 1;
      continue;
    }
    flushPendingRemoved();
  }

  flushPendingRemoved();
  return decorations;
}

export function mergeGitDiffDecorations(
  diffTexts: Array<string | undefined>,
  currentLineCount?: number
): IdePendingDiffDecorations {
  const merged = emptyIdePendingDiffDecorations();

  for (const diffText of diffTexts) {
    if (typeof diffText !== "string") continue;
    const parsed = parseGitDiffDecorations(diffText, currentLineCount);
    for (const [lineNumber, lineState] of parsed.lineStates) {
      const currentState = merged.lineStates.get(lineNumber);
      merged.lineStates.set(lineNumber, combineLineStates(currentState, lineState));
    }
    merged.deletedBlocks.push(...parsed.deletedBlocks);
  }

  merged.deletedBlocks.sort((left, right) => left.anchorLine - right.anchorLine);
  return merged;
}

export function buildPendingInlinePreviewRows(
  diffText: string,
  currentContent: string
): IdePendingInlinePreviewRow[] {
  const currentLines = currentContent.split("\n");
  if (typeof diffText !== "string" || !diffText.trim() || diffText.includes("(No changes)")) {
    return currentLines.map((text, index) => ({
      kind: "context" as const,
      lineNumber: index + 1,
      text,
    }));
  }

  const lines = diffText.split(/\r?\n/);
  const rows: IdePendingInlinePreviewRow[] = [];
  let currentLineNumber = 1;
  let hasHunk = false;

  const pushCurrentLine = (lineNumber: number, fallbackText = "") => {
    rows.push({
      kind: "context",
      lineNumber,
      text: currentLines[lineNumber - 1] ?? fallbackText,
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (!line.startsWith("@@")) {
      continue;
    }

    hasHunk = true;
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    const hunkStart = match ? Math.max(1, Number(match[1]) || 1) : currentLineNumber;

    while (currentLineNumber < hunkStart && currentLineNumber <= currentLines.length) {
      pushCurrentLine(currentLineNumber);
      currentLineNumber += 1;
    }

    for (index += 1; index < lines.length; index += 1) {
      const hunkLine = lines[index] || "";
      if (hunkLine.startsWith("@@")) {
        index -= 1;
        break;
      }
      if (
        hunkLine.startsWith("diff --git ") ||
        hunkLine.startsWith("--- ") ||
        hunkLine.startsWith("+++ ")
      ) {
        break;
      }
      if (hunkLine.startsWith("\\")) {
        continue;
      }
      if (hunkLine.startsWith(" ") || hunkLine === "") {
        rows.push({
          kind: "context",
          lineNumber: currentLineNumber,
          text: hunkLine.startsWith(" ")
            ? hunkLine.slice(1)
            : (currentLines[currentLineNumber - 1] ?? ""),
        });
        currentLineNumber += 1;
        continue;
      }
      if (hunkLine.startsWith("-") && !hunkLine.startsWith("---")) {
        rows.push({
          kind: "removed",
          lineNumber: null,
          text: hunkLine.slice(1),
        });
        continue;
      }
      if (hunkLine.startsWith("+") && !hunkLine.startsWith("+++")) {
        rows.push({
          kind: "added",
          lineNumber: currentLineNumber,
          text: hunkLine.slice(1),
        });
        currentLineNumber += 1;
      }
    }
  }

  if (!hasHunk) {
    return currentLines.map((text, index) => ({
      kind: "context",
      lineNumber: index + 1,
      text,
    }));
  }

  while (currentLineNumber <= currentLines.length) {
    pushCurrentLine(currentLineNumber);
    currentLineNumber += 1;
  }

  return rows;
}
