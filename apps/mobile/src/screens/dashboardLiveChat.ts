import type {
  MobileStatusSessionSnapshot,
  MobileStatusStreamEvent,
  SessionDetailSummary,
  SessionProcessActivitySummary,
} from "../lib/api";
import { isProviderRecoveryStatusLabel } from "cybara-shared/chat-status";
import type { SessionEventIdentity } from "cybara-shared/session-event-order";

type StatusEvent = Extract<MobileStatusStreamEvent, { type: "status" }>;

interface CachedMobileLiveAssistant {
  message: SessionDetailSummary["messages"][number];
  nowMs: number;
  runId: string | null;
  sequence: number;
  updatedAt: number;
}

const MOBILE_LIVE_ASSISTANT_STALE_MS = 15 * 60 * 1000;
const mobileLiveAssistantCache = new Map<string, CachedMobileLiveAssistant>();
const mobileLiveAssistantSubscribers = new Map<
  string,
  Set<(cached: CachedMobileLiveAssistant | null) => void>
>();

function normalizeLiveSessionId(sessionId?: string | null): string | null {
  const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
  return trimmed || null;
}

export function readCachedMobileLiveAssistant(
  sessionId?: string | null
): CachedMobileLiveAssistant | null {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return null;
  const cached = mobileLiveAssistantCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > MOBILE_LIVE_ASSISTANT_STALE_MS) {
    mobileLiveAssistantCache.delete(key);
    return null;
  }
  return {
    message: {
      ...cached.message,
      processActivities: cached.message.processActivities?.map((activity) => ({ ...activity })),
      toolCalls: cached.message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    },
    nowMs: cached.nowMs,
    runId: cached.runId,
    sequence: cached.sequence,
    updatedAt: cached.updatedAt,
  };
}

export function writeCachedMobileLiveAssistant(
  sessionId: string | null | undefined,
  message: SessionDetailSummary["messages"][number],
  nowMs = Date.now(),
  identity?: SessionEventIdentity
): void {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return;
  const previous = mobileLiveAssistantCache.get(key);
  mobileLiveAssistantCache.set(key, {
    message: {
      ...message,
      processActivities: message.processActivities?.map((activity) => ({ ...activity })),
      toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    },
    nowMs,
    runId:
      typeof identity?.runId === "string" && identity.runId.trim()
        ? identity.runId.trim()
        : (previous?.runId ?? null),
    sequence:
      typeof identity?.sequence === "number" && Number.isFinite(identity.sequence)
        ? identity.sequence
        : (previous?.sequence ?? 0),
    updatedAt: Date.now(),
  });
  const cached = readCachedMobileLiveAssistant(key);
  for (const subscriber of mobileLiveAssistantSubscribers.get(key) ?? []) {
    subscriber(cached);
  }
}

export function clearCachedMobileLiveAssistant(sessionId?: string | null): void {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return;
  mobileLiveAssistantCache.delete(key);
  for (const subscriber of mobileLiveAssistantSubscribers.get(key) ?? []) {
    subscriber(null);
  }
}

export function mobileAgentUsingBrowser(
  message: SessionDetailSummary["messages"][number] | null,
  sessionActive: boolean
): boolean {
  if (!sessionActive) return false;
  return (message?.processActivities ?? []).some(
    (activity) =>
      activity.phase === "start" && (activity.toolName || "").toLowerCase().includes("browser")
  );
}

export function isMobileSessionSnapshotCurrent(
  timestamp: number | undefined,
  serverReportsActive: boolean,
  now = Date.now()
): boolean {
  if (serverReportsActive) return true;
  return typeof timestamp === "number" && now - timestamp <= MOBILE_LIVE_ASSISTANT_STALE_MS;
}

export function subscribeCachedMobileLiveAssistant(
  sessionId: string,
  subscriber: (cached: CachedMobileLiveAssistant | null) => void
): () => void {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return () => {};
  const subscribers = mobileLiveAssistantSubscribers.get(key) ?? new Set();
  subscribers.add(subscriber);
  mobileLiveAssistantSubscribers.set(key, subscribers);
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) mobileLiveAssistantSubscribers.delete(key);
  };
}

function mobileActivityKey(activity: SessionProcessActivitySummary): string {
  const toolKey = typeof activity.toolCallId === "string" ? activity.toolCallId.trim() : "";
  const phase = activity.phase === "start" ? "result" : activity.phase || "";
  const text = (activity.text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^Running\b/i, "Ran")
    .toLowerCase();
  return [toolKey, phase, (activity.toolName || "").toLowerCase(), text].join("|");
}

export function prunePersistedMobileLiveAssistant(
  live: SessionDetailSummary["messages"][number] | null,
  persistedMessages: SessionDetailSummary["messages"]
): SessionDetailSummary["messages"][number] | null {
  if (!live) return null;
  const liveTimestampMs = Date.parse(live.timestamp || "");
  const persistedActivityKeys = new Set<string>();
  let latestPersistedTimestampMs = -Infinity;
  let latestPersistedRole: string | null = null;
  let latestPersistedHasFinalMaterial = false;
  for (const message of persistedMessages) {
    const messageTimestampMs = Date.parse(message.timestamp || "");
    if (
      Number.isFinite(liveTimestampMs) &&
      Number.isFinite(messageTimestampMs) &&
      messageTimestampMs >= liveTimestampMs &&
      messageTimestampMs >= latestPersistedTimestampMs
    ) {
      latestPersistedTimestampMs = messageTimestampMs;
      latestPersistedRole = message.role;
      latestPersistedHasFinalMaterial =
        Boolean((message.content || "").trim()) || Boolean(message.toolCalls?.length);
    }
    if (message.role !== "assistant") continue;
    for (const activity of message.processActivities || []) {
      persistedActivityKeys.add(mobileActivityKey(activity));
    }
  }
  if (latestPersistedRole === "assistant" && latestPersistedHasFinalMaterial) return null;
  if (persistedActivityKeys.size === 0) return live;
  const processActivities = (live.processActivities || []).filter(
    (activity) => !persistedActivityKeys.has(mobileActivityKey(activity))
  );
  const hasContent = Boolean((live.content || "").trim());
  const hasToolCalls = Boolean(live.toolCalls?.length);
  if (!hasContent && !hasToolCalls && processActivities.length === 0) return null;
  return {
    ...live,
    processActivities,
  };
}

export function liveStatusPhase(event: StatusEvent): SessionProcessActivitySummary["phase"] | null {
  if (event.toolPhase) return event.toolPhase;
  if (event.status === "tool_executing") return "start";
  if (event.status === "tool_completed") return "result";
  if (event.status === "error") return "error";
  if (
    event.status === "thinking" ||
    event.status === "generating" ||
    event.status === "compacting"
  ) {
    return "start";
  }
  return null;
}

function isMeaningfulLiveDetail(value: string | undefined): value is string {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return false;
  if (isProviderRecoveryStatusLabel(normalized)) return false;
  return ![
    "idle",
    "working",
    "working...",
    "generating response",
    "generating response...",
  ].includes(normalized);
}

export function liveActivityFromStatusEvent(
  event: StatusEvent
): SessionProcessActivitySummary | null {
  const compactionCompleted =
    event.status === "thinking" && (event.detail || "").trim().startsWith("Context compacted");
  const phase = compactionCompleted ? "result" : liveStatusPhase(event);
  if (!phase) return null;
  const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
  const compactionActivity = event.status === "compacting" || compactionCompleted;
  const toolName =
    (compactionActivity ? "__context_compaction" : event.toolName) ||
    (event.status === "thinking" || event.status === "generating" || event.status === "compacting"
      ? "__thought"
      : undefined);
  const fallbackText =
    event.status === "thinking"
      ? "Thinking..."
      : event.status === "generating"
        ? "Generating response..."
        : event.status === "compacting"
          ? "Compacting earlier context..."
          : event.status === "error"
            ? "Run failed"
            : phase === "blocked"
              ? "Tool blocked"
              : event.toolName
                ? `${event.toolName} running...`
                : "Working...";
  const text = isMeaningfulLiveDetail(event.detail) ? event.detail.trim() : fallbackText;
  return {
    id: compactionActivity
      ? "live-context-compaction"
      : event.toolCallId || `live-${event.status}-${timestamp}`,
    phase,
    text,
    timestamp,
    toolName,
    toolCallId: compactionActivity ? "live-context-compaction" : event.toolCallId,
  };
}

export function mergeLiveActivity(
  current: SessionProcessActivitySummary[],
  incoming: SessionProcessActivitySummary
): SessionProcessActivitySummary[] {
  return mergeMobileLiveActivities(current, [incoming]);
}

export function mergeMobileLiveActivities(
  current: SessionProcessActivitySummary[],
  incoming: SessionProcessActivitySummary[]
): SessionProcessActivitySummary[] {
  const next = current.map((activity) => ({ ...activity }));
  const indexes = new Map(
    next.map((activity, index) => [activity.toolCallId || activity.id, index] as const)
  );
  for (const activity of incoming) {
    const activityKey = activity.toolCallId || activity.id;
    const index = indexes.get(activityKey);
    if (typeof index === "number") {
      const existing = next[index];
      const preserveStartTimestamp = existing.phase === "start" && activity.phase !== "start";
      next[index] = {
        ...existing,
        ...activity,
        timestamp: preserveStartTimestamp ? existing.timestamp : activity.timestamp,
      };
    } else {
      indexes.set(activityKey, next.length);
      next.push({ ...activity });
    }
  }
  return next;
}

export function mobilePreSteerProcessActivities(
  message: SessionDetailSummary["messages"][number] | null
): SessionProcessActivitySummary[] {
  return (message?.processActivities || [])
    .filter((activity) => {
      const text = (activity.text || "").trim().toLowerCase();
      return (
        text.length > 0 &&
        !text.includes("steering to follow-up") &&
        !text.includes("starting queued follow-up")
      );
    })
    .map((activity) => ({ ...activity }))
    .slice(-12);
}

export function liveAssistantMessage(
  sessionId: string,
  current: SessionDetailSummary["messages"][number] | null,
  timestampMs = Date.now()
): SessionDetailSummary["messages"][number] {
  return (
    current || {
      id: `live-assistant-${sessionId}`,
      role: "assistant",
      content: "",
      timestamp: new Date(timestampMs).toISOString(),
      processActivities: [
        {
          id: `live-thinking-${timestampMs}`,
          phase: "start",
          text: "Thinking...",
          timestamp: timestampMs,
          toolName: "__thought",
        },
      ],
    }
  );
}

export function liveAssistantFromStatusSnapshot(
  sessionId: string,
  current: SessionDetailSummary["messages"][number] | null,
  snapshot: MobileStatusSessionSnapshot
): SessionDetailSummary["messages"][number] {
  const timestamp = typeof snapshot.timestamp === "number" ? snapshot.timestamp : Date.now();
  const base = liveAssistantMessage(sessionId, current, timestamp);
  const currentActivities = (base.processActivities || []).filter(
    (activity) =>
      !(
        activity.toolName === "__thought" &&
        activity.text.trim().toLowerCase() === "thinking..." &&
        activity.id.startsWith("live-thinking-")
      )
  );
  return {
    ...base,
    processActivities:
      snapshot.activities.length > 0
        ? mergeMobileLiveActivities(currentActivities, snapshot.activities)
        : base.processActivities,
  };
}
