import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { upsertPersistedSessionMessage } from "../core/session-context";
import {
  appendSessionEvent,
  getActiveSessionRunId,
  listAllSessionEvents,
  listAllRunEvents,
  listIncompleteSessionRuns,
  type SessionLedgerEvent,
} from "../core/session-event-ledger";
import {
  type AgentStatus,
  reduceSessionStatusSnapshot,
  type SessionStatusSnapshot,
  type StatusPayload,
} from "../core/status";
import type { ProcessActivityInfo } from "./chat-process-activities";
import { INTERRUPTED_RESPONSE } from "./chat-interruption";
import type { ChatMessage } from "./chat-types";

const LEGACY_RUN_RECOVERY_SETTLE_MS = 30_000;

export interface ChatRunRecoveryOptions {
  now?: number;
  processAlive?: (processId: number) => boolean;
}

const AGENT_STATUSES = new Set<AgentStatus>([
  "idle",
  "thinking",
  "tool_executing",
  "tool_completed",
  "generating",
  "compacting",
  "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function eventTimestamp(event: SessionLedgerEvent): number {
  if (isRecord(event.payload)) {
    const timestamp = event.payload.timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  const normalized = event.createdAt.includes("T")
    ? event.createdAt
    : `${event.createdAt.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function runProcessId(events: SessionLedgerEvent[]): number | undefined {
  for (const event of events) {
    if (event.type !== "run_started" || !isRecord(event.payload)) continue;
    const processId = event.payload.processId;
    if (typeof processId === "number" && Number.isInteger(processId) && processId > 0) {
      return processId;
    }
  }
  return undefined;
}

function processIsAlive(processId: number): boolean {
  if (processId === process.pid) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
}

function latestRunActivityAt(events: SessionLedgerEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, eventTimestamp(event)), 0);
}

function legacyRunIsSettled(events: SessionLedgerEvent[], now: number): boolean {
  const latestActivityAt = latestRunActivityAt(events);
  return latestActivityAt > 0 && now - latestActivityAt >= LEGACY_RUN_RECOVERY_SETTLE_MS;
}

function incompleteRunCanBeRecovered(
  events: SessionLedgerEvent[],
  options: Required<ChatRunRecoveryOptions>
): boolean {
  const ownerProcessId = runProcessId(events);
  if (ownerProcessId !== undefined) return !options.processAlive(ownerProcessId);
  return legacyRunIsSettled(events, options.now);
}

function statusPayload(event: SessionLedgerEvent): StatusPayload | null {
  if ((event.type !== "status" && event.type !== "error") || !isRecord(event.payload)) {
    return null;
  }
  const status = event.payload.status;
  if (typeof status !== "string" || !AGENT_STATUSES.has(status as AgentStatus)) return null;
  const payload = event.payload as Partial<StatusPayload>;
  return {
    status: status as AgentStatus,
    timestamp:
      typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
        ? payload.timestamp
        : eventTimestamp(event),
    ...(typeof payload.detail === "string" ? { detail: payload.detail } : {}),
    ...(typeof payload.agentId === "string" ? { agentId: payload.agentId } : {}),
    ...(typeof payload.toolName === "string" ? { toolName: payload.toolName } : {}),
    ...(typeof payload.toolCallId === "string" ? { toolCallId: payload.toolCallId } : {}),
    ...(typeof payload.sandboxProvider === "string"
      ? { sandboxProvider: payload.sandboxProvider }
      : {}),
    ...(payload.toolPhase === "start" ||
    payload.toolPhase === "result" ||
    payload.toolPhase === "error" ||
    payload.toolPhase === "blocked"
      ? { toolPhase: payload.toolPhase }
      : {}),
    ...(typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
      ? { durationMs: payload.durationMs }
      : {}),
    sessionId: event.sessionId,
    runId: event.runId,
    sequence: event.sequence,
  };
}

function assistantDelta(event: SessionLedgerEvent): string {
  if (event.type !== "assistant_delta" || !isRecord(event.payload)) return "";
  return typeof event.payload.delta === "string" ? event.payload.delta : "";
}

function hasPersistedAssistantEvent(events: SessionLedgerEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "message" && isRecord(event.payload) && event.payload.role === "assistant"
  );
}

function isGatewayCrashRecovery(events: SessionLedgerEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "run_completed" &&
      isRecord(event.payload) &&
      event.payload.source === "gateway_crash_recovery"
  );
}

function interruptionTimestamp(events: SessionLedgerEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "run_completed" || !isRecord(event.payload)) continue;
    if (event.payload.source !== "gateway_crash_recovery") continue;
    const timestamp = event.payload.interruptionTimestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  return (
    events.reduce((latest, event) => {
      if (
        event.type === "run_completed" &&
        isRecord(event.payload) &&
        event.payload.source === "gateway_crash_recovery"
      ) {
        return latest;
      }
      return Math.max(latest, eventTimestamp(event));
    }, 0) + 1
  );
}

function buildActivities(
  events: SessionLedgerEvent[],
  interrupted: boolean
): ProcessActivityInfo[] {
  let snapshot: SessionStatusSnapshot | undefined;
  for (const event of events) {
    const payload = statusPayload(event);
    if (!payload) continue;
    if (payload.status === "idle") continue;
    snapshot = reduceSessionStatusSnapshot(snapshot, payload) ?? undefined;
  }
  const activities = (snapshot?.activities || []).map((activity) => ({ ...activity }));
  if (!interrupted) return activities;
  for (const activity of activities) {
    if (activity.phase === "start") activity.phase = "blocked";
  }
  activities.push({
    id: `${events[0]?.runId || "run"}:interrupted`,
    phase: "blocked",
    text: "Turn interrupted when the gateway stopped.",
    timestamp: interruptionTimestamp(events),
    toolName: "__interruption",
  });
  return activities;
}

function messageTimestamp(message: ChatMessage): number {
  if (!message.timestamp) return 0;
  const normalized = message.timestamp.includes("T")
    ? message.timestamp
    : `${message.timestamp.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((message, index) => ({ message, index, timestamp: messageTimestamp(message) }))
    .sort((left, right) => {
      if (left.timestamp === right.timestamp) return left.index - right.index;
      return left.timestamp - right.timestamp;
    })
    .map(({ message }) => message);
}

function hydrateRunMessage(message: ChatMessage, events: SessionLedgerEvent[]): ChatMessage {
  const processActivities = buildActivities(events, isGatewayCrashRecovery(events));
  return {
    ...message,
    ...(processActivities.length > 0 ? { process_activities: processActivities } : {}),
  };
}

function completedEmptyRunEvents(
  eventsByRun: Map<string, SessionLedgerEvent[]>
): SessionLedgerEvent[][] {
  return [...eventsByRun.values()].filter((events) => {
    const hasStarted = events.some((event) => event.type === "run_started");
    const hasCompleted = events.some((event) => event.type === "run_completed");
    const generated = events.some((event) => statusPayload(event)?.status === "generating");
    return hasStarted && hasCompleted && generated && !hasPersistedAssistantEvent(events);
  });
}

function hasDurableAssistantWithinRun(
  messages: ChatMessage[],
  events: SessionLedgerEvent[]
): boolean {
  const startedAt = events
    .filter((event) => event.type === "run_started")
    .reduce((earliest, event) => Math.min(earliest, eventTimestamp(event)), Infinity);
  const completedAt = events
    .filter((event) => event.type === "run_completed")
    .reduce((latest, event) => Math.max(latest, eventTimestamp(event)), 0);
  if (!Number.isFinite(startedAt) || completedAt < startedAt) return false;
  return messages.some((message) => {
    if (message.role !== "assistant") return false;
    const timestamp = messageTimestamp(message);
    return timestamp >= startedAt && timestamp <= completedAt;
  });
}

export async function recoverInterruptedSessionMessages(
  sessionId: string,
  agentId: string,
  messages: ChatMessage[],
  recoveryOptions: ChatRunRecoveryOptions = {}
): Promise<ChatMessage[]> {
  const options: Required<ChatRunRecoveryOptions> = {
    now: recoveryOptions.now ?? Date.now(),
    processAlive: recoveryOptions.processAlive ?? processIsAlive,
  };
  const eventCache = new Map<string, SessionLedgerEvent[]>();
  for (const event of listAllSessionEvents(sessionId)) {
    const events = eventCache.get(event.runId) || [];
    events.push(event);
    eventCache.set(event.runId, events);
  }
  const eventsForRun = (runId: string): SessionLedgerEvent[] => {
    const cached = eventCache.get(runId);
    if (cached) return cached;
    const events = listAllRunEvents(runId);
    eventCache.set(runId, events);
    return events;
  };
  const hydrated = messages.map((message) => {
    const runId = typeof message.run_id === "string" ? message.run_id.trim() : "";
    return runId ? hydrateRunMessage(message, eventsForRun(runId)) : message;
  });
  const representedRunIds = new Set(
    hydrated.map((message) => message.run_id?.trim()).filter((runId): runId is string => !!runId)
  );
  let recoveredRunAdded = false;
  const activeRunId = getActiveSessionRunId(sessionId);

  for (const events of completedEmptyRunEvents(eventCache)) {
    const runId = events[0]?.runId;
    if (
      !runId ||
      runId === activeRunId ||
      representedRunIds.has(runId) ||
      hasDurableAssistantWithinRun(hydrated, events) ||
      !legacyRunIsSettled(events, options.now)
    ) {
      continue;
    }
    const timestamp = new Date(
      events.reduce((latest, event) => Math.max(latest, eventTimestamp(event)), 0) || Date.now()
    ).toISOString();
    const processActivities = buildActivities(events, false);
    const recovered: ChatMessage = {
      role: "assistant",
      content: INTERRUPTED_RESPONSE,
      timestamp,
      run_id: runId,
      interrupted: true,
      ...(processActivities.length > 0 ? { process_activities: processActivities } : {}),
    };
    await upsertPersistedSessionMessage(sessionId, agentId, recovered, {
      stableKey: `completed-empty-run:${runId}`,
      metadata: { source: "completed_empty_run_recovery" },
    });
    hydrated.push(recovered);
    representedRunIds.add(runId);
    recoveredRunAdded = true;
  }

  for (const run of listIncompleteSessionRuns(sessionId)) {
    if (run.runId === activeRunId || representedRunIds.has(run.runId)) continue;
    const events = eventsForRun(run.runId);
    if (
      events.length === 0 ||
      hasPersistedAssistantEvent(events) ||
      !incompleteRunCanBeRecovered(events, options)
    ) {
      continue;
    }
    const processActivities = buildActivities(events, true);
    const content = sanitizeAssistantContent(events.map(assistantDelta).join(""));
    if (processActivities.length <= 1 && !content.trim()) continue;
    const timestamp = new Date(
      events.reduce((latest, event) => Math.max(latest, eventTimestamp(event)), 0) || Date.now()
    ).toISOString();
    const recovered: ChatMessage = {
      role: "assistant",
      content,
      timestamp,
      run_id: run.runId,
      interrupted: true,
      process_activities: processActivities,
    };
    const durableMarker: ChatMessage = {
      role: "assistant",
      content,
      timestamp,
      run_id: run.runId,
      interrupted: true,
    };
    await upsertPersistedSessionMessage(sessionId, agentId, durableMarker, {
      stableKey: `interrupted-run:${run.runId}`,
      metadata: { source: "gateway_crash_recovery" },
    });
    const interruptedAt = processActivities.at(-1)?.timestamp ?? Date.now();
    appendSessionEvent({
      sessionId,
      runId: run.runId,
      type: "run_completed",
      payload: {
        interrupted: true,
        source: "gateway_crash_recovery",
        timestamp: interruptedAt,
        interruptionTimestamp: interruptedAt,
      },
    });
    hydrated.push(recovered);
    representedRunIds.add(run.runId);
    recoveredRunAdded = true;
  }

  return recoveredRunAdded || hydrated.some((message) => message.interrupted === true)
    ? sortMessages(hydrated)
    : hydrated;
}
