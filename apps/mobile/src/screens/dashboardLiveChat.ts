import type {
  MobileStatusSessionSnapshot,
  MobileStatusStreamEvent,
  SessionDetailSummary,
  SessionProcessActivitySummary,
} from "../lib/api";

type StatusEvent = Extract<MobileStatusStreamEvent, { type: "status" }>;

interface CachedMobileLiveAssistant {
  message: SessionDetailSummary["messages"][number];
  nowMs: number;
  updatedAt: number;
}

const MOBILE_LIVE_ASSISTANT_STALE_MS = 15 * 60 * 1000;
const mobileLiveAssistantCache = new Map<string, CachedMobileLiveAssistant>();

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
    updatedAt: cached.updatedAt,
  };
}

export function writeCachedMobileLiveAssistant(
  sessionId: string | null | undefined,
  message: SessionDetailSummary["messages"][number],
  nowMs = Date.now()
): void {
  const key = normalizeLiveSessionId(sessionId);
  if (!key) return;
  mobileLiveAssistantCache.set(key, {
    message: {
      ...message,
      processActivities: message.processActivities?.map((activity) => ({ ...activity })),
      toolCalls: message.toolCalls?.map((toolCall) => ({ ...toolCall })),
    },
    nowMs,
    updatedAt: Date.now(),
  });
}

export function clearCachedMobileLiveAssistant(sessionId?: string | null): void {
  const key = normalizeLiveSessionId(sessionId);
  if (key) mobileLiveAssistantCache.delete(key);
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
  const phase = liveStatusPhase(event);
  if (!phase) return null;
  const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
  const toolName =
    event.toolName ||
    (event.status === "thinking" || event.status === "generating" || event.status === "compacting"
      ? "__thought"
      : undefined);
  const fallbackText =
    event.status === "thinking"
      ? "Thinking..."
      : event.status === "generating"
        ? "Generating response..."
        : event.status === "compacting"
          ? "Summarizing context..."
          : event.status === "error"
            ? "Run failed"
            : event.toolName
              ? `${event.toolName} running...`
              : "Working...";
  const text = isMeaningfulLiveDetail(event.detail) ? event.detail.trim() : fallbackText;
  return {
    id: event.toolCallId || `live-${event.status}-${timestamp}`,
    phase,
    text,
    timestamp,
    toolName,
    toolCallId: event.toolCallId,
  };
}

export function mergeLiveActivity(
  current: SessionProcessActivitySummary[],
  incoming: SessionProcessActivitySummary
): SessionProcessActivitySummary[] {
  const key = incoming.toolCallId || incoming.id;
  const next = [...current];
  const index = next.findIndex((activity) => (activity.toolCallId || activity.id) === key);
  if (index >= 0) {
    next[index] = { ...next[index], ...incoming };
  } else {
    next.push(incoming);
  }
  return next.slice(-12);
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
  return {
    ...base,
    processActivities:
      snapshot.activities.length > 0
        ? snapshot.activities.map((activity) => ({ ...activity }))
        : base.processActivities,
  };
}
