import type { LiveActivityItem } from "@/lib/chatActivities";
import {
  type StatusSessionSnapshot,
  type StatusStreamStatusEvent,
  type StreamAgentStatus,
} from "@/lib/status-stream";
import {
  applyLiveActivityEvent,
  formatToolIntent,
  getLatestInFlightStep,
  isGenericStatusLabel,
  isMeaningfulThoughtDetail,
  normalizeSessionStatus,
  normalizeSnapshotActivities,
  resolveStatusSnapshotActivities,
  toLiveActivityItems,
} from "./chatModel";

export type MultiChatLiveStatusValue = "thinking" | "generating" | "compacting" | "idle";

export interface MultiChatLiveState {
  status: StreamAgentStatus;
  liveStatus: MultiChatLiveStatusValue;
  detail?: string;
  timestamp: number;
  observedAt: number;
  startedAtMs: number;
  activities: LiveActivityItem[];
  currentStep: string | null;
  streamingContent: string | null;
  runId: string | null;
  sequence: number;
}

export const MULTI_CHAT_ACTIVE_STATUSES = new Set<StreamAgentStatus>([
  "thinking",
  "generating",
  "tool_executing",
  "tool_completed",
  "compacting",
]);

function defaultCurrentStep(
  status: MultiChatLiveStatusValue,
  detail?: string,
  activities: LiveActivityItem[] = []
): string | null {
  const activeTool = getLatestInFlightStep(activities);
  if (activeTool && !isGenericStatusLabel(activeTool)) return activeTool;
  const normalizedDetail = typeof detail === "string" ? detail.trim() : "";
  if (isMeaningfulThoughtDetail(normalizedDetail)) return normalizedDetail;
  if (status === "generating") return "Generating response...";
  if (status === "compacting") return "Compacting earlier context...";
  if (status === "thinking") return "Thinking...";
  return null;
}

function snapshotLatestTimestamp(snapshot: StatusSessionSnapshot): number {
  let latest = Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : 0;
  for (const activity of snapshot.activities || []) {
    if (Number.isFinite(activity.timestamp) && activity.timestamp > latest) {
      latest = activity.timestamp;
    }
  }
  return latest;
}

export function projectMultiChatSnapshot(
  snapshot: StatusSessionSnapshot,
  previous?: MultiChatLiveState,
  observedAt = Date.now()
): MultiChatLiveState {
  const liveStatus = normalizeSessionStatus(snapshot.status);
  const snapshotActivities = normalizeSnapshotActivities(
    toLiveActivityItems(snapshot.activities),
    snapshot.status
  );
  const activities = resolveStatusSnapshotActivities(
    snapshotActivities,
    previous?.activities || [],
    liveStatus
  );
  const timestamp = snapshotLatestTimestamp(snapshot) || observedAt;
  const currentStep = defaultCurrentStep(liveStatus, snapshot.detail, activities);
  return {
    status: snapshot.status,
    liveStatus,
    detail: snapshot.detail,
    timestamp,
    observedAt,
    startedAtMs: previous?.startedAtMs || timestamp,
    activities,
    currentStep,
    streamingContent: liveStatus === "generating" ? (previous?.streamingContent ?? null) : null,
    runId: snapshot.runId?.trim() || previous?.runId || null,
    sequence: snapshot.sequence || previous?.sequence || 0,
  };
}

export function projectMultiChatStatusEvent(
  previous: MultiChatLiveState | undefined,
  event: StatusStreamStatusEvent,
  observedAt = Date.now()
): MultiChatLiveState | null {
  const detail = typeof event.detail === "string" ? event.detail.trim() : "";
  const steeringHandoff =
    event.status === "idle" && detail.toLowerCase() === "steering to follow-up...";
  if ((event.status === "idle" && !steeringHandoff) || event.status === "error") return null;

  const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : observedAt;
  let status = event.status;
  let liveStatus = normalizeSessionStatus(event.status);
  let activities = previous?.activities || [];
  let currentStep = previous?.currentStep || null;
  let streamingContent = previous?.streamingContent || null;

  if (steeringHandoff) {
    status = "thinking";
    liveStatus = "thinking";
    activities = applyLiveActivityEvent(activities, {
      phase: "result",
      text: detail,
      timestamp,
      toolName: "__thought",
    });
    currentStep = detail;
  } else if (
    event.status === "thinking" ||
    event.status === "generating" ||
    event.status === "compacting"
  ) {
    if (event.status !== "generating" || previous?.status !== "generating") {
      streamingContent = null;
    }
    if (!event.toolName && isMeaningfulThoughtDetail(detail)) {
      activities = applyLiveActivityEvent(activities, {
        phase: "result",
        text: detail,
        timestamp,
        toolName: "__thought",
      });
    }
    currentStep = defaultCurrentStep(liveStatus, detail, activities);
  } else if (event.status === "tool_executing" || event.status === "tool_completed") {
    streamingContent = null;
    const phase = event.toolPhase || (event.status === "tool_executing" ? "start" : "result");
    const toolName = event.toolName || "tool";
    const text = formatToolIntent(toolName, {}, phase, event.detail);
    activities = applyLiveActivityEvent(activities, {
      phase,
      text,
      timestamp,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      sandboxProvider: event.sandboxProvider,
    });
    liveStatus = "thinking";
    currentStep =
      phase === "start"
        ? isGenericStatusLabel(text)
          ? "Thinking..."
          : text
        : defaultCurrentStep("thinking", undefined, activities);
  }

  return {
    status,
    liveStatus,
    detail: detail || undefined,
    timestamp,
    observedAt,
    startedAtMs: previous?.startedAtMs || timestamp,
    activities,
    currentStep,
    streamingContent,
    runId: event.runId?.trim() || previous?.runId || null,
    sequence: event.sequence || previous?.sequence || 0,
  };
}

export function projectMultiChatToken(
  previous: MultiChatLiveState | undefined,
  event: { delta: string; runId?: string; sequence?: number; timestamp: number },
  observedAt = Date.now()
): MultiChatLiveState {
  const runId = event.runId?.trim() || previous?.runId || null;
  const sameRun = !previous?.runId || !runId || previous.runId === runId;
  const streamingContent = `${sameRun ? previous?.streamingContent || "" : ""}${event.delta}`;
  return {
    status: "generating",
    liveStatus: "generating",
    timestamp: event.timestamp,
    observedAt,
    startedAtMs: sameRun ? previous?.startedAtMs || event.timestamp : event.timestamp,
    activities: sameRun ? previous?.activities || [] : [],
    currentStep: "Generating response...",
    streamingContent,
    runId,
    sequence: event.sequence || previous?.sequence || 0,
  };
}

export function multiChatStateFromCache(
  cached: {
    status: MultiChatLiveStatusValue;
    activities: LiveActivityItem[];
    currentStep: string | null;
    streamingContent: string | null;
    runId: string | null;
    sequence: number;
    startedAtMs: number | null;
    updatedAt: number;
  },
  observedAt = Date.now()
): MultiChatLiveState {
  const status: StreamAgentStatus = cached.status === "idle" ? "thinking" : cached.status;
  return {
    status,
    liveStatus: cached.status === "idle" ? "thinking" : cached.status,
    timestamp: cached.updatedAt,
    observedAt,
    startedAtMs: cached.startedAtMs || cached.updatedAt,
    activities: cached.activities,
    currentStep: cached.currentStep,
    streamingContent: cached.streamingContent,
    runId: cached.runId,
    sequence: cached.sequence,
  };
}
