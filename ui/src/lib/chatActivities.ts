export type ActivityPhase = "start" | "result" | "error";

export interface LiveActivityItem {
  id: string;
  phase: ActivityPhase;
  text: string;
  timestamp: number;
  toolName?: string;
}

export interface ToolCallLike {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "executing" | "completed" | "failed" | "success" | "error";
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function summarizeToolResult(call: ToolCallLike, phase: ActivityPhase): string | undefined {
  if (phase !== "result") return undefined;
  if (!isObjectRecord(call.result)) return undefined;

  const key = call.name.toLowerCase();
  if (key === "write" || key === "edit") {
    const change = isObjectRecord(call.result.change) ? call.result.change : undefined;
    const path =
      (typeof change?.path === "string" && change.path.trim()) ||
      (typeof call.result.path === "string" && call.result.path.trim()) ||
      "";
    const added = toFiniteNumber(change?.addedLines);
    const removed = toFiniteNumber(change?.removedLines);

    if (path && added !== undefined && removed !== undefined) {
      return `Edited ${toDisplayPath(path)} +${added} -${removed}`;
    }
    if (path) {
      return `Edited ${toDisplayPath(path)}`;
    }
    if (added !== undefined && removed !== undefined) {
      return `Edited file +${added} -${removed}`;
    }
  }

  if (key === "file_search" || key === "grep") {
    const files = Array.isArray(call.result.files) ? call.result.files : undefined;
    const count = toFiniteNumber(call.result.count) || (files ? files.length : undefined);
    if (count !== undefined) {
      const safeCount = Math.max(0, Math.floor(count));
      return `Explored ${safeCount} file${safeCount === 1 ? "" : "s"}, 1 search`;
    }
  }

  return undefined;
}

function toCanonicalVerb(text: string, phase: ActivityPhase): string {
  const trimmed = text.trim();
  if (!trimmed || phase === "start") return trimmed;

  if (phase === "result") {
    return trimmed
      .replace(/^Exploring\b/i, "Explored")
      .replace(/^Searching\b/i, "Searched")
      .replace(/^Fetching\b/i, "Fetched")
      .replace(/^Running\b/i, "Ran")
      .replace(/^Writing\b/i, "Edited")
      .replace(/^Editing\b/i, "Edited");
  }

  return trimmed
    .replace(/^Exploring\b/i, "Read failed")
    .replace(/^Searching\b/i, "Search failed")
    .replace(/^Fetching\b/i, "Fetch failed")
    .replace(/^Running\b/i, "Command failed")
    .replace(/^Writing\b/i, "Edit failed")
    .replace(/^Editing\b/i, "Edit failed");
}

function activityDedupKey(activity: LiveActivityItem): string {
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  return `${activity.phase}:${toolPrefix}${normalizeText(activity.text).toLowerCase()}`;
}

function canonicalActivityKey(activity: LiveActivityItem): string {
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  return `${toolPrefix}${normalizeText(toCanonicalVerb(activity.text, "result")).toLowerCase()}`;
}

function normalizeToolPhase(status: ToolCallLike["status"]): ActivityPhase {
  if (status === "pending" || status === "executing") return "start";
  if (status === "failed" || status === "error") return "error";
  return "result";
}

export function normalizeActivityTextForPhase(text: string, phase: ActivityPhase): string {
  return toCanonicalVerb(text, phase);
}

export function buildActivitiesFromToolCalls(
  toolCalls: ToolCallLike[] | undefined,
  formatToolIntent: (
    toolName: string,
    args: Record<string, unknown>,
    phase: ActivityPhase,
    fallbackDetail?: string
  ) => string
): LiveActivityItem[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  const startedAt = Date.now();
  const activities: LiveActivityItem[] = [];

  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    const phase = normalizeToolPhase(call.status);
    const args = (call.arguments || call.args || {}) as Record<string, unknown>;
    const text = summarizeToolResult(call, phase) || formatToolIntent(call.name, args, phase);
    const trimmedText = text.trim();
    if (!trimmedText) continue;

    activities.push({
      id: call.id ? `tool-${call.id}` : `tool-${index}-${call.name}`,
      phase,
      text: trimmedText,
      timestamp: startedAt + index,
      toolName: call.name,
    });
  }

  return activities;
}

export function mergeActivityLists(
  primary: LiveActivityItem[],
  secondary: LiveActivityItem[]
): LiveActivityItem[] {
  const allActivities = [...primary, ...secondary];
  const hasCompletionForStart = (activity: LiveActivityItem): boolean => {
    if (activity.phase !== "start") return false;
    const key = canonicalActivityKey(activity);
    const normalizedToolName = activity.toolName?.toLowerCase();
    return allActivities.some(
      (candidate) => {
        if (candidate.phase === "start") return false;
        if (candidate.timestamp < activity.timestamp) return false;
        if (normalizedToolName && candidate.toolName?.toLowerCase() === normalizedToolName) return true;
        return canonicalActivityKey(candidate) === key;
      }
    );
  };

  const seen = new Set<string>();
  const merged: LiveActivityItem[] = [];

  const pushUnique = (activity: LiveActivityItem) => {
    if (hasCompletionForStart(activity)) {
      return;
    }
    const key = activityDedupKey(activity);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(activity);
  };

  for (const activity of primary) {
    pushUnique(activity);
  }
  for (const activity of secondary) {
    pushUnique(activity);
  }

  return merged;
}

export function finalizeCompletedActivities(activities: LiveActivityItem[]): LiveActivityItem[] {
  const finalized: LiveActivityItem[] = activities.map((activity): LiveActivityItem => {
    if (activity.phase !== "start") {
      return activity;
    }
    return {
      ...activity,
      phase: "result",
      text: normalizeActivityTextForPhase(activity.text, "result"),
    };
  });
  return mergeActivityLists([], finalized);
}
