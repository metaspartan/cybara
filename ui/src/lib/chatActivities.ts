export type ActivityPhase = "start" | "result" | "error";

export interface LiveActivityItem {
  id: string;
  phase: ActivityPhase;
  text: string;
  timestamp: number;
}

export interface ToolCallLike {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  status?: "pending" | "executing" | "completed" | "failed" | "success" | "error";
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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
  return `${activity.phase}:${normalizeText(activity.text).toLowerCase()}`;
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
    const text = formatToolIntent(call.name, args, phase);
    const trimmedText = text.trim();
    if (!trimmedText) continue;

    activities.push({
      id: call.id ? `tool-${call.id}` : `tool-${index}-${call.name}`,
      phase,
      text: trimmedText,
      timestamp: startedAt + index,
    });
  }

  return activities;
}

export function mergeActivityLists(
  primary: LiveActivityItem[],
  secondary: LiveActivityItem[]
): LiveActivityItem[] {
  const seen = new Set<string>();
  const merged: LiveActivityItem[] = [];

  const pushUnique = (activity: LiveActivityItem) => {
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
