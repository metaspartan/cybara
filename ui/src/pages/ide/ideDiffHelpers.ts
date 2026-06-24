/** IDE diff/pending-change helpers — extracted from IDE.tsx. */
import type { CSSProperties } from "react";
import type { ToolCallLike, LiveActivityItem } from "@/lib/chatActivities";
import {
  countGitDiffLineChanges,
  type IdePendingLineState,
  type IdePendingDeletedBlock,
} from "@/lib/idePendingDiffDecorations";
import type {
  IdePendingFileDiff,
  IdeFileChangeSummary,
  IdeFileChangeItem,
  IdeProcessActivity,
} from "./ideTypes";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeIdePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "/");
}

export function getIdePendingFileDecisionKey(messageKey: string, filePath: string): string {
  return `${messageKey}::${normalizeIdePath(filePath)}`;
}

export function isSameIdePath(currentPath: string, candidatePath: string): boolean {
  const current = normalizeIdePath(currentPath);
  const candidate = normalizeIdePath(candidatePath).replace(/^[ab]\//, "");
  if (!current || !candidate) return false;
  if (current === candidate) return true;
  if (current.endsWith(`/${candidate}`)) return true;
  if (candidate.endsWith(`/${current}`)) return true;
  return false;
}

export function countDiffLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export function toFiniteDiffNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function normalizeIdeChangeType(raw: unknown): IdeFileChangeItem["type"] {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (normalized === "created" || normalized === "create" || normalized === "new") return "created";
  if (normalized === "deleted" || normalized === "delete" || normalized === "remove")
    return "deleted";
  return "updated";
}

export function truncateDiffPreview(diff: string, maxLines = 220): string {
  const lines = diff.split(/\r?\n/);
  if (lines.length <= maxLines) return diff;
  const omitted = lines.length - maxLines;
  return [...lines.slice(0, maxLines), `... [diff truncated, ${omitted} lines omitted]`].join("\n");
}

export function shouldHydratePendingFileDiffFromGit(file: IdePendingFileDiff): boolean {
  const diff = typeof file.diff === "string" ? file.diff : "";
  if (!diff.trim()) return true;
  const counts = countGitDiffLineChanges(diff);
  if (counts.truncated) return true;
  if (file.added > 0 && counts.added === 0) return true;
  if (file.removed > 0 && counts.removed === 0) return true;
  return counts.added !== file.added || counts.removed !== file.removed;
}

export function getPendingLineTextClass(
  state: IdePendingLineState | undefined,
  hasError: boolean,
  hasWarning: boolean
): string | null {
  if (hasError || hasWarning) return null;
  if (state === "added") return "text-emerald-300";
  if (state === "removed") return "text-red-300";
  if (state === "mixed") return "text-amber-300";
  return null;
}

export function getPendingLineContainerClass(
  state: IdePendingLineState | undefined,
  hasError: boolean,
  hasWarning: boolean
): string | null {
  if (hasError || hasWarning) return null;
  if (state === "added") return "bg-emerald-500/14";
  if (state === "removed") return "bg-red-500/12";
  return null;
}

export function getPendingLineDecorationStyle(
  state: IdePendingLineState | undefined,
  isActiveLine: boolean
): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (state === "added") {
    style.boxShadow = "inset 3px 0 0 rgba(52, 211, 153, 0.72)";
  } else if (state === "removed") {
    style.boxShadow = "inset 3px 0 0 rgba(248, 113, 113, 0.74)";
  } else if (state === "mixed") {
    style.backgroundImage =
      "linear-gradient(90deg, rgba(248,113,113,0.12) 0%, rgba(248,113,113,0.12) 34%, rgba(52,211,153,0.12) 34%, rgba(52,211,153,0.12) 100%)";
    style.boxShadow = "inset 3px 0 0 rgba(251, 191, 36, 0.74)";
  }
  if (isActiveLine) {
    style.outline = "1px solid rgba(129, 140, 248, 0.45)";
    style.outlineOffset = "-1px";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

export function summarizePendingDeletedBlocks(
  blocks: IdePendingDeletedBlock[] | undefined
): { preview: string; extraLines: number } | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const removedLines: string[] = [];
  for (const block of blocks) {
    removedLines.push(...block.lines);
  }
  if (removedLines.length === 0) return null;
  const trimmedPreview = removedLines.find((line) => line.trim().length > 0)?.trim() || "";
  const previewSource = trimmedPreview || removedLines[0] || "deleted line";
  const preview =
    previewSource.length > 96 ? `${previewSource.slice(0, 93).trimEnd()}...` : previewSource;
  return {
    preview,
    extraLines: Math.max(0, removedLines.length - 1),
  };
}

export function parseIdePatchFileChanges(patch: string): IdeFileChangeItem[] {
  const lines = patch.split(/\r?\n/);
  const changes: IdeFileChangeItem[] = [];
  let current: IdeFileChangeItem | null = null;
  let diffLines: string[] = [];

  const pushCurrent = () => {
    if (!current) return;
    if (diffLines.length > 0) {
      current.diff = truncateDiffPreview(diffLines.join("\n"));
    }
    changes.push(current);
    current = null;
    diffLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("--- ")) {
      pushCurrent();
      const oldPathRaw = line.slice(4).trim();
      const next = lines[index + 1] || "";
      const newPathRaw = next.startsWith("+++ ") ? next.slice(4).trim() : oldPathRaw;
      const oldPath = oldPathRaw.replace(/^[ab]\//, "");
      const newPath = newPathRaw.replace(/^[ab]\//, "");
      const type: IdeFileChangeItem["type"] =
        oldPathRaw === "/dev/null" ? "created" : newPathRaw === "/dev/null" ? "deleted" : "updated";
      const path = type === "deleted" ? oldPath : newPath;
      current = {
        path,
        type,
        added: 0,
        removed: 0,
      };
      diffLines.push(line);
      if (next.startsWith("+++ ")) {
        diffLines.push(next);
        index += 1;
      }
      continue;
    }

    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
      diffLines.push(line);
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
      diffLines.push(line);
      continue;
    }
    if (line.startsWith("@@") || line.startsWith("diff --git ") || line.startsWith(" ")) {
      diffLines.push(line);
    }
  }

  pushCurrent();
  return changes.filter((change) => !!change.path);
}

export function parseIdeChangeRecord(value: unknown): IdeFileChangeItem | null {
  if (!isPlainRecord(value)) return null;
  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (!path) return null;
  const added =
    toFiniteDiffNumber(value.added) ||
    toFiniteDiffNumber(value.addedLines) ||
    toFiniteDiffNumber(value.plus);
  const removed =
    toFiniteDiffNumber(value.removed) ||
    toFiniteDiffNumber(value.removedLines) ||
    toFiniteDiffNumber(value.minus);
  const diff =
    typeof value.diff === "string" && value.diff.trim()
      ? truncateDiffPreview(value.diff)
      : undefined;
  return {
    path,
    type: normalizeIdeChangeType(value.type || value.kind),
    added: Math.max(0, Math.floor(added)),
    removed: Math.max(0, Math.floor(removed)),
    diff,
  };
}

export function isIdeToolCallLike(value: unknown): value is ToolCallLike {
  return isPlainRecord(value) && typeof value.name === "string" && value.name.trim().length > 0;
}

export function getIdeToolCallsInTimelineOrder(toolCalls: ToolCallLike[] | undefined): ToolCallLike[] {
  if (!Array.isArray(toolCalls) || toolCalls.length <= 1) {
    return toolCalls ? [...toolCalls] : [];
  }
  const hasTimeline = toolCalls.some(
    (toolCall) =>
      typeof toolCall.timeline_index === "number" &&
      Number.isFinite(toolCall.timeline_index as number)
  );
  if (!hasTimeline) return [...toolCalls];
  return [...toolCalls].sort((left, right) => {
    const leftRank =
      typeof left.timeline_index === "number" && Number.isFinite(left.timeline_index as number)
        ? (left.timeline_index as number)
        : Number.MAX_SAFE_INTEGER;
    const rightRank =
      typeof right.timeline_index === "number" && Number.isFinite(right.timeline_index as number)
        ? (right.timeline_index as number)
        : Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

export function extractIdeToolFileChanges(toolCall: ToolCallLike): IdeFileChangeItem[] {
  const toolName = typeof toolCall.name === "string" ? toolCall.name.toLowerCase() : "";
  const args = isPlainRecord(toolCall.args)
    ? toolCall.args
    : isPlainRecord(toolCall.arguments)
      ? toolCall.arguments
      : {};
  const result = isPlainRecord(toolCall.result) ? toolCall.result : null;
  const parsedFromResult: IdeFileChangeItem[] = [];

  if (result && Array.isArray(result.changes)) {
    for (const change of result.changes) {
      const parsed = parseIdeChangeRecord(change);
      if (parsed) parsedFromResult.push(parsed);
    }
  }

  if (result && isPlainRecord(result.change)) {
    const parsed = parseIdeChangeRecord({
      path:
        (typeof result.path === "string" && result.path) ||
        (typeof args.path === "string" && args.path) ||
        "",
      ...(result.change as Record<string, unknown>),
    });
    if (parsed) parsedFromResult.push(parsed);
  }

  if (parsedFromResult.length > 0) return parsedFromResult;

  if (toolName === "apply_patch") {
    const patch = typeof args.patch === "string" ? args.patch : "";
    if (!patch.trim()) return [];
    return parseIdePatchFileChanges(patch);
  }

  if (toolName === "write") {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!path || !content) return [];
    const diffLines = [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,0 +1,${countDiffLines(content)} @@`,
      ...content.split(/\r?\n/).map((line) => `+${line}`),
    ];
    return [
      {
        path,
        type: "created",
        added: countDiffLines(content),
        removed: 0,
        diff: truncateDiffPreview(diffLines.join("\n")),
      },
    ];
  }

  if (toolName === "edit") {
    const path = typeof args.path === "string" ? args.path : "";
    const oldText = typeof args.oldText === "string" ? args.oldText : "";
    const newText = typeof args.newText === "string" ? args.newText : "";
    if (!path || (!oldText && !newText)) return [];
    const oldLines = oldText ? oldText.split(/\r?\n/) : [];
    const newLines = newText ? newText.split(/\r?\n/) : [];
    const diffLines = [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ];
    return [
      {
        path,
        type: "updated",
        added: newLines.length,
        removed: oldLines.length,
        diff: truncateDiffPreview(diffLines.join("\n")),
      },
    ];
  }

  return [];
}

export function summarizeIdeFileChanges(changes: IdeFileChangeItem[]): IdeFileChangeSummary | null {
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const byPath = new Map<string, IdeFileChangeItem>();
  for (const change of changes) {
    if (!change?.path) continue;
    const existing = byPath.get(change.path);
    if (!existing) {
      byPath.set(change.path, { ...change });
      continue;
    }
    existing.added += change.added;
    existing.removed += change.removed;
    if (change.diff) existing.diff = change.diff;
    if (change.type === "deleted") existing.type = "deleted";
    if (existing.type !== "deleted" && change.type === "updated") existing.type = "updated";
  }
  const files = Array.from(byPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  if (files.length === 0) return null;
  return {
    files,
    totalAdded: files.reduce((sum, file) => sum + file.added, 0),
    totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

export function mergeIdeFileChangeSummaries(
  ...summaries: Array<IdeFileChangeSummary | null | undefined>
): IdeFileChangeSummary | null {
  const merged: IdeFileChangeItem[] = [];
  for (const summary of summaries) {
    if (!summary || !Array.isArray(summary.files)) continue;
    merged.push(...summary.files);
  }
  return summarizeIdeFileChanges(merged);
}

export function parseIdeChangeFromTextLine(line: string): IdeFileChangeItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(Edited|Updated|Created|Deleted)\s+(.+?)(?:\s+\+(\d+)\s*-\s*(\d+))?(?:\s+\(.*\))?$/i
  );
  if (!match) return null;
  const action = (match[1] || "").toLowerCase();
  const rawPath = (match[2] || "").trim();
  const path = rawPath.replace(/^["'`]|["'`]$/g, "").trim();
  if (!path) return null;

  const addedRaw = match[3] ? Number(match[3]) : NaN;
  const removedRaw = match[4] ? Number(match[4]) : NaN;
  const type: IdeFileChangeItem["type"] =
    action === "created" ? "created" : action === "deleted" ? "deleted" : "updated";
  const added = Number.isFinite(addedRaw)
    ? Math.max(0, Math.floor(addedRaw))
    : type === "created"
      ? 1
      : 0;
  const removed = Number.isFinite(removedRaw)
    ? Math.max(0, Math.floor(removedRaw))
    : type === "deleted"
      ? 1
      : 0;

  return { path, type, added, removed };
}

export function summarizeIdeActivityFileChanges(
  activities?: IdeProcessActivity[]
): IdeFileChangeSummary | null {
  if (!Array.isArray(activities) || activities.length === 0) return null;
  const parsed: IdeFileChangeItem[] = [];
  for (const activity of activities) {
    const line = typeof activity?.text === "string" ? activity.text : "";
    const change = parseIdeChangeFromTextLine(line);
    if (change) parsed.push(change);
  }
  return summarizeIdeFileChanges(parsed);
}

export function summarizeIdeTextFileChanges(text?: string): IdeFileChangeSummary | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const parsed: IdeFileChangeItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const change = parseIdeChangeFromTextLine(line);
    if (change) parsed.push(change);
  }
  return summarizeIdeFileChanges(parsed);
}

export function summarizeIdeMessageFileChanges(
  toolCalls?: ToolCallLike[]
): IdeFileChangeSummary | null {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  const collectedChanges: IdeFileChangeItem[] = [];
  const orderedToolCalls = getIdeToolCallsInTimelineOrder(toolCalls);

  for (const toolCall of orderedToolCalls) {
    collectedChanges.push(...extractIdeToolFileChanges(toolCall));
  }
  return summarizeIdeFileChanges(collectedChanges);
}

export function reverseUnifiedDiff(diff: string, changeType: IdeFileChangeItem["type"]): string | null {
  if (!diff.trim() || diff.includes("[diff truncated")) return null;
  const lines = diff.split(/\r?\n/);
  if (lines.length === 0) return null;
  const oldLineIndex = lines.findIndex((line) => line.startsWith("--- "));
  const newLineIndex = lines.findIndex((line) => line.startsWith("+++ "));
  if (oldLineIndex < 0 || newLineIndex < 0) return null;

  const oldHeader = lines[oldLineIndex].slice(4).trim();
  const newHeader = lines[newLineIndex].slice(4).trim();
  const reversed = [...lines];
  if (changeType === "created") {
    reversed[oldLineIndex] = `--- ${newHeader}`;
    reversed[newLineIndex] = "+++ /dev/null";
  } else if (changeType === "deleted") {
    reversed[oldLineIndex] = "--- /dev/null";
    reversed[newLineIndex] = `+++ ${oldHeader}`;
  } else {
    reversed[oldLineIndex] = `--- ${newHeader}`;
    reversed[newLineIndex] = `+++ ${oldHeader}`;
  }

  for (let index = 0; index < reversed.length; index += 1) {
    const line = reversed[index] || "";
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (match) {
        const oldStart = match[1];
        const oldCount = match[2] || "1";
        const newStart = match[3];
        const newCount = match[4] || "1";
        const suffix = match[5] || "";
        reversed[index] = `@@ -${newStart},${newCount} +${oldStart},${oldCount} @@${suffix}`;
      }
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      reversed[index] = `-${line.slice(1)}`;
      continue;
    }
    if (line.startsWith("-")) {
      reversed[index] = `+${line.slice(1)}`;
    }
  }

  return reversed.join("\n");
}
