import {
  groupSharedActivities,
  type SharedActivityDisplayEntry,
  type SharedActivityGroupKind,
} from "../../../shared/chat-activity-groups";
import {
  formatExpandedToolActivityDetail,
  formatStructuredToolActivityDetail,
} from "../../../shared/tool-activity-detail";

export type ActivityPhase = "start" | "result" | "error" | "blocked";

export interface LiveActivityItem {
  id: string;
  phase: ActivityPhase;
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
  fullText?: string;
}

export interface ToolCallLike {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: "pending" | "executing" | "completed" | "failed" | "success" | "error" | "blocked";
  started_at?: number | string;
  timeline_index?: number;
  duration?: number | string;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasUsableWebToolResult(call: ToolCallLike): boolean {
  if (call.name !== "web_search" && call.name !== "web_fetch") return false;
  if (isObjectRecord(call.result) && typeof call.result.error === "string") return false;
  if (typeof call.result === "string") return call.result.trim().length > 0;
  if (!isObjectRecord(call.result)) return false;
  if (call.name === "web_search") {
    return (
      (Array.isArray(call.result.results) && call.result.results.length > 0) ||
      (typeof call.result.count === "number" && call.result.count > 0)
    );
  }
  return [call.result.content, call.result.text, call.result.markdown, call.result.output].some(
    (value) => typeof value === "string" && value.trim().length > 0
  );
}

export function suppressRecoveredWebFailureActivities(
  activities: LiveActivityItem[],
  toolCalls?: ToolCallLike[]
): LiveActivityItem[] {
  if (!toolCalls?.some(hasUsableWebToolResult)) return activities;
  return activities.filter(
    (activity) =>
      activity.phase !== "error" ||
      (activity.toolName !== "web_search" && activity.toolName !== "web_fetch")
  );
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

function normalizeSandboxProvider(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "apple_sandbox" ||
    normalized === "podman" ||
    normalized === "docker" ||
    normalized === "host"
  ) {
    return normalized;
  }
  return undefined;
}

function resolveToolCallSandboxProvider(call: ToolCallLike): string | undefined {
  if (!isObjectRecord(call.result)) return undefined;
  return normalizeSandboxProvider(call.result.sandboxProvider ?? call.result.sandbox_provider);
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

  if (phase === "blocked") {
    return trimmed
      .replace(/^Exploring\b/i, "Read blocked")
      .replace(/^Searching\b/i, "Search blocked")
      .replace(/^Fetching\b/i, "Fetch blocked")
      .replace(/^Running\b/i, "Command blocked")
      .replace(/^Writing\b/i, "Edit blocked")
      .replace(/^Editing\b/i, "Edit blocked");
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
  if (activity.toolCallId) {
    return `toolCall:${activity.toolCallId}:${activity.phase}`;
  }
  const normalizedId = activity.id.trim();
  if (normalizedId) {
    return `id:${normalizedId}`;
  }
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  const timestamp = Number.isFinite(activity.timestamp) ? Math.floor(activity.timestamp) : 0;
  return `${activity.phase}:${toolPrefix}${normalizeText(activity.text).toLowerCase()}:${timestamp}`;
}

function semanticActivityDedupKey(activity: LiveActivityItem): string {
  if (activity.toolCallId) {
    return `toolCall:${activity.toolCallId}:${activity.phase}`;
  }
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  const normalizedText = normalizeText(
    toCanonicalVerb(activity.text, activity.phase)
  ).toLowerCase();
  const timestampBucket = Number.isFinite(activity.timestamp)
    ? Math.floor(activity.timestamp / 1000)
    : 0;
  return `${activity.phase}:${toolPrefix}${normalizedText}:${timestampBucket}`;
}

function canonicalActivityKey(activity: LiveActivityItem): string {
  const toolPrefix = activity.toolName ? `${activity.toolName.toLowerCase()}:` : "";
  return `${toolPrefix}${normalizeText(toCanonicalVerb(activity.text, "result")).toLowerCase()}`;
}

function normalizeToolPhase(status: ToolCallLike["status"]): ActivityPhase {
  if (status === "pending" || status === "executing") return "start";
  if (status === "blocked") return "blocked";
  if (status === "failed" || status === "error") return "error";
  return "result";
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

const REASONING_MARKUP_TOKEN_PATTERN =
  /<\/?(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning|final)\b[^>]*>|\[\/?(?:thinking|reasoning)\]/gi;

/**
 * Remove reasoning tag tokens (e.g. a bare "</think>" streamed as a thought
 * delta) from activity text. Also cleans activities persisted before the
 * gateway started stripping these at the source.
 */
export function stripReasoningTagTokens(text: string): string {
  return text
    .replace(REASONING_MARKUP_TOKEN_PATTERN, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  ) => string,
  options?: {
    baseTimestampMs?: number;
  }
): LiveActivityItem[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }

  const fallbackBase = Number.isFinite(options?.baseTimestampMs as number)
    ? (options?.baseTimestampMs as number)
    : 0;
  const activities: LiveActivityItem[] = [];

  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    const phase = normalizeToolPhase(call.status);
    const args = (call.arguments || call.args || {}) as Record<string, unknown>;
    const text = summarizeToolResult(call, phase) || formatToolIntent(call.name, args, phase);
    const trimmedText = text.trim();
    if (!trimmedText) continue;

    const startedAt =
      toTimestampMs(call.started_at) ??
      (typeof call.timeline_index === "number" && Number.isFinite(call.timeline_index)
        ? fallbackBase + call.timeline_index
        : fallbackBase + index);

    activities.push({
      id: call.id ? `tool-${call.id}` : `tool-${index}-${call.name}`,
      phase,
      text: trimmedText,
      timestamp: startedAt,
      toolName: call.name,
      toolCallId: call.id,
      sandboxProvider: resolveToolCallSandboxProvider(call),
    });
  }

  return activities;
}

function normalizedToolCallId(value: string | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function equivalentActivityText(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, " ") === right.trim().replace(/\s+/g, " ");
}

export function enrichActivitiesWithToolCallDetails(
  activities: LiveActivityItem[],
  toolCalls: ToolCallLike[] | undefined
): LiveActivityItem[] {
  if (!toolCalls || toolCalls.length === 0) return activities;
  const callsById = new Map<string, ToolCallLike>();
  const callsByName = new Map<string, ToolCallLike[]>();
  for (const call of toolCalls) {
    const callId = normalizedToolCallId(call.id);
    if (callId) callsById.set(callId, call);
    const name = call.name.trim().toLowerCase();
    if (!name) continue;
    const namedCalls = callsByName.get(name) || [];
    namedCalls.push(call);
    callsByName.set(name, namedCalls);
  }
  const usedCalls = new Set<ToolCallLike>();

  return activities.map((activity) => {
    const toolCallId = normalizedToolCallId(activity.toolCallId);
    const callById = toolCallId ? callsById.get(toolCallId) : undefined;
    const toolName = activity.toolName?.trim().toLowerCase() || "";
    const callByName = toolName
      ? callsByName.get(toolName)?.find((candidate) => !usedCalls.has(candidate))
      : undefined;
    const call = callById || callByName;
    if (!call) return activity;
    usedCalls.add(call);
    const args = call.arguments || call.args || {};
    const structuredText = formatStructuredToolActivityDetail(
      call.name,
      args,
      activity.phase,
      call.result
    );
    const text = structuredText || activity.text;
    const fullText = formatExpandedToolActivityDetail(call.name, args, activity.phase, call.result);
    if (!fullText || equivalentActivityText(text, fullText)) {
      return text === activity.text ? activity : { ...activity, text };
    }
    return { ...activity, text, fullText };
  });
}

export function mergeActivityLists(
  primary: LiveActivityItem[],
  secondary: LiveActivityItem[]
): LiveActivityItem[] {
  const allActivities = [...primary, ...secondary]
    .map((activity) => {
      const text = stripReasoningTagTokens(activity.text);
      return text === activity.text ? activity : { ...activity, text };
    })
    .filter((activity) => activity.text.length > 0);
  const hasCompletionForStart = (activity: LiveActivityItem): boolean => {
    if (activity.phase !== "start") return false;
    if (activity.toolCallId) {
      return allActivities.some(
        (candidate) =>
          candidate.phase !== "start" &&
          candidate.toolCallId === activity.toolCallId &&
          candidate.timestamp >= activity.timestamp
      );
    }
    const key = canonicalActivityKey(activity);
    const normalizedToolName = activity.toolName?.toLowerCase();
    return allActivities.some((candidate) => {
      if (candidate.phase === "start") return false;
      if (candidate.timestamp < activity.timestamp) return false;
      if (normalizedToolName && candidate.toolName?.toLowerCase() === normalizedToolName)
        return true;
      return canonicalActivityKey(candidate) === key;
    });
  };

  const seen = new Set<string>();
  const seenSemantic = new Set<string>();
  const merged: LiveActivityItem[] = [];

  const pushUnique = (activity: LiveActivityItem) => {
    if (hasCompletionForStart(activity)) {
      return;
    }
    const exactKey = activityDedupKey(activity);
    if (seen.has(exactKey)) return;
    const semanticKey = semanticActivityDedupKey(activity);
    if (seenSemantic.has(semanticKey)) return;
    seen.add(exactKey);
    seenSemantic.add(semanticKey);
    merged.push(activity);
  };

  for (const activity of allActivities) {
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

export type ActivityGroupKind = SharedActivityGroupKind;
export type ActivityDisplayEntry = SharedActivityDisplayEntry<LiveActivityItem>;

export function groupActivitiesForDisplay(activities: LiveActivityItem[]): ActivityDisplayEntry[] {
  return groupSharedActivities(activities);
}
