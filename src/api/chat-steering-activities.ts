import { getSessionStatusSnapshot } from "../core/status";
import { sanitizeProcessThoughtText } from "./chat-formatting";
import { dedupeProcessActivities, type ProcessActivityInfo } from "./chat-process-activities";
import { parseIsoTimestampMs, type InMemoryChatSession } from "./chat-runtime-state";
import type { ChatMessage } from "./chat-types";
export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
export function collectAttachedProcessActivityIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.process_activities)) continue;
    for (const activity of message.process_activities) {
      if (typeof activity.id === "string" && activity.id.trim()) {
        ids.add(activity.id);
      }
    }
  }
  return ids;
}

export function getSessionProcessActivities(
  sessionId: string,
  options?: { excludeActivityIds?: Set<string> }
): ProcessActivityInfo[] | undefined {
  const snapshot = getSessionStatusSnapshot(sessionId);
  if (!snapshot || !Array.isArray(snapshot.activities) || snapshot.activities.length === 0) {
    return undefined;
  }
  const excludeActivityIds = options?.excludeActivityIds;
  const activities = snapshot.activities
    .filter((activity) => !excludeActivityIds?.has(activity.id))
    .map((activity) => ({
      id: activity.id,
      phase: activity.phase,
      text: activity.text,
      timestamp: activity.timestamp,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: activity.sandboxProvider,
    }));
  return sanitizeObservedProcessActivities(activities);
}

export function sanitizeObservedProcessActivities(
  activities: unknown
): ProcessActivityInfo[] | undefined {
  if (!Array.isArray(activities)) return undefined;
  const sanitized: ProcessActivityInfo[] = [];
  for (const entry of activities) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawText = typeof record.text === "string" ? record.text.trim() : "";
    const text = record.toolName === "__thought" ? sanitizeProcessThoughtText(rawText) : rawText;
    if (!text) continue;
    const timestamp =
      typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
        ? record.timestamp
        : Date.now();
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim().slice(0, 160)
        : `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const phase =
      record.phase === "start" ||
      record.phase === "result" ||
      record.phase === "error" ||
      record.phase === "blocked"
        ? record.phase
        : "result";
    const toolName =
      typeof record.toolName === "string" && record.toolName.trim()
        ? record.toolName.trim().slice(0, 120)
        : undefined;
    const toolCallId =
      typeof record.toolCallId === "string" && record.toolCallId.trim()
        ? record.toolCallId.trim().slice(0, 160)
        : undefined;
    const sandboxProvider =
      typeof record.sandboxProvider === "string" && record.sandboxProvider.trim()
        ? record.sandboxProvider.trim().slice(0, 80)
        : undefined;
    sanitized.push({
      id,
      phase,
      text: text.length > 1000 ? `${text.slice(0, 1000)}...` : text,
      timestamp,
      toolName,
      toolCallId,
      sandboxProvider,
    });
  }
  const deduped = dedupeProcessActivities(sanitized);
  return deduped.length > 0 ? deduped : undefined;
}

function isSteeringHandoffProcessActivity(activity: ProcessActivityInfo): boolean {
  const text = activity.text.trim().toLowerCase();
  return text === "steering to follow-up..." || text === "starting queued follow-up";
}

function buildSteeringCompletionActivity(
  pendingSteeringId: string | undefined,
  timestamp: number
): ProcessActivityInfo {
  return {
    id: pendingSteeringId ? `steered-${pendingSteeringId}` : `steered-${timestamp}`,
    phase: "result",
    text: "Conversation steered.",
    timestamp,
    toolName: "__steering",
  };
}

export function materializeInterruptedAssistantBeforeSteering(
  session: InMemoryChatSession,
  observedActivities?: ProcessActivityInfo[],
  options?: { pendingSteeringId?: string; createEmptyBoundary?: boolean }
): ChatMessage | undefined {
  const pendingSteeringId = options?.pendingSteeringId;
  if (!pendingSteeringId) return undefined;
  const isMatchingPendingMessage = (message: ChatMessage): boolean =>
    message._pendingSteeringId === pendingSteeringId;
  const steeringIndex = session.messages.findIndex(
    (message) => message.role === "user" && isMatchingPendingMessage(message)
  );
  const existingInterruptedIndex = session.messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.content.trim().length === 0 &&
      Array.isArray(message.process_activities) &&
      isMatchingPendingMessage(message)
  );
  const previousMessage = steeringIndex >= 0 ? session.messages[steeringIndex - 1] : undefined;
  const previousInterruptedAssistant =
    previousMessage?.role === "assistant" &&
    previousMessage.content.trim().length === 0 &&
    Array.isArray(previousMessage.process_activities) &&
    isMatchingPendingMessage(previousMessage)
      ? previousMessage
      : existingInterruptedIndex >= 0
        ? session.messages[existingInterruptedIndex]
        : undefined;

  if (steeringIndex < 0 && !previousInterruptedAssistant) return undefined;

  const steeringTimestampMs =
    (steeringIndex >= 0
      ? parseIsoTimestampMs(session.messages[steeringIndex]?.timestamp)
      : parseIsoTimestampMs(previousInterruptedAssistant?.timestamp)) || Date.now();
  const interruptedActivities = dedupeProcessActivities([
    ...(observedActivities || []),
    ...(getSessionProcessActivities(session.id, {
      excludeActivityIds: previousInterruptedAssistant
        ? undefined
        : collectAttachedProcessActivityIds(session.messages),
    }) || []),
  ]).filter((activity) => !isSteeringHandoffProcessActivity(activity));
  const latestActivityTimestamp = interruptedActivities.reduce(
    (latest, activity) => Math.max(latest, activity.timestamp),
    0
  );
  const steeringCompletion = buildSteeringCompletionActivity(
    pendingSteeringId,
    Math.max(0, steeringTimestampMs - 1, latestActivityTimestamp + 1)
  );
  const processActivities = dedupeProcessActivities([...interruptedActivities, steeringCompletion]);

  if (previousInterruptedAssistant) {
    const merged = dedupeProcessActivities([
      ...(previousInterruptedAssistant.process_activities || []),
      ...processActivities,
    ]);
    previousInterruptedAssistant.process_activities = merged;
    return previousInterruptedAssistant;
  }

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: "",
    timestamp: new Date(Math.max(0, steeringTimestampMs - 1)).toISOString(),
    process_activities: processActivities,
    _pendingSteeringId: pendingSteeringId,
  };
  session.messages.splice(steeringIndex, 0, assistantMessage);
  const lastMessage = session.messages[session.messages.length - 1] || assistantMessage;
  session.updatedAt = lastMessage.timestamp || new Date().toISOString();
  return assistantMessage;
}
