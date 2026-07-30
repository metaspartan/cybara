import { stripReasoningTagTokens } from "./agent-internals";
import { isMidLoopContextCompactionDetail } from "./llm/context-pressure";
import { createLogger } from "./logger";
import { notifyMobilePushForStatus, notifyMobilePushForTask } from "./mobile-push";
import { redactSecrets, redactSecretText } from "./redaction";
import {
  appendBufferedAssistantDelta,
  appendSessionEvent,
  beginSessionRun,
  completeSessionRun,
  ensureSessionRunId,
  flushBufferedAssistantDeltas,
  getActiveSessionRunId,
  removeSupersededRecoveryCompletion,
} from "./session-event-ledger";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "tool_executing"
  | "tool_completed"
  | "generating"
  | "compacting"
  | "error";

export type ToolStatusPhase = "start" | "result" | "error" | "blocked";

export interface StatusPayload {
  status: AgentStatus;
  timestamp: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
  toolPhase?: ToolStatusPhase;
  durationMs?: number;
  pendingChatId?: string;
  clientPendingId?: string;
  runId?: string;
  sequence?: number;
}

export interface TaskEventPayload {
  type: "task_completed";
  taskId: string;
  taskName: string;
  status: "completed" | "failed";
  sessionId?: string;
  resultPreview?: string;
  error?: string;
  timestamp?: number;
}

export interface StatusSnapshotEventPayload {
  type: "snapshot";
  timestamp: number;
  activeSessions: SessionStatusSnapshot[];
  activeSessionIds: string[];
  count: number;
}

export type PendingChatMessageMode = "queued" | "steering";

export interface PendingChatMessageSnapshot {
  id: string;
  sessionId: string;
  clientPendingId?: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  mode: PendingChatMessageMode;
  sequence: number;
}

export type StatusStreamEvent =
  | ({ type: "status" } & StatusPayload)
  | TaskEventPayload
  | StatusSnapshotEventPayload
  | TokenStreamEventPayload;

export interface TokenStreamEventPayload {
  type: "assistant_token";
  sessionId: string;
  agentId?: string;
  delta: string;
  timestamp: number;
  runId?: string;
  sequence?: number;
}

export interface SessionActivitySnapshot {
  id: string;
  phase: ToolStatusPhase;
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface SessionStatusSnapshot {
  sessionId: string;
  runId?: string;
  sequence?: number;
  status: AgentStatus;
  startedAt: number;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: SessionActivitySnapshot[];
  pendingMessages?: PendingChatMessageSnapshot[];
}

type StatusCallback = (data: StatusPayload) => void;
type StatusStreamCallback = (event: StatusStreamEvent) => void;

const statusCallbacks = new Set<StatusCallback>();
const statusStreamCallbacks = new Set<StatusStreamCallback>();
const log = createLogger("Status");

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

const encoder = new TextEncoder();
const sessionStatusSnapshots = new Map<string, SessionStatusSnapshot>();
const sessionPendingChatMessages = new Map<string, PendingChatMessageSnapshot[]>();
let sessionStatusLivenessResolver: ((sessionId: string) => boolean) | undefined;
const ACTIVE_STATUSES = new Set<AgentStatus>([
  "thinking",
  "generating",
  "tool_executing",
  "tool_completed",
  "compacting",
  "error",
]);
const STATUS_STALE_MS = 15 * 60 * 1000;

export function setSessionStatusLivenessResolver(resolver?: (sessionId: string) => boolean): void {
  sessionStatusLivenessResolver = resolver;
}

export function isSessionStatusActive(status?: string): boolean {
  return typeof status === "string" && ACTIVE_STATUSES.has(status as AgentStatus);
}

function clonePendingMessages(
  messages?: PendingChatMessageSnapshot[]
): PendingChatMessageSnapshot[] {
  return (messages || []).map((message) => ({ ...message }));
}

function pendingMessagesForSession(sessionId: string): PendingChatMessageSnapshot[] {
  return clonePendingMessages(sessionPendingChatMessages.get(sessionId));
}

function withPendingMessages(snapshot: SessionStatusSnapshot): SessionStatusSnapshot {
  const pendingMessages = pendingMessagesForSession(snapshot.sessionId);
  return {
    ...snapshot,
    activities: snapshot.activities.map((activity) => ({ ...activity })),
    ...(pendingMessages.length > 0 ? { pendingMessages } : {}),
  };
}

function pendingOnlySnapshot(
  sessionId: string,
  pendingMessages: PendingChatMessageSnapshot[]
): SessionStatusSnapshot {
  const timestamp = pendingMessages.reduce(
    (latest, message) => Math.max(latest, message.updatedAt || message.createdAt || 0),
    Date.now()
  );
  return {
    sessionId,
    status: "thinking",
    startedAt: timestamp,
    timestamp,
    detail: "Queued follow-up",
    activities: [],
    pendingMessages: clonePendingMessages(pendingMessages),
  };
}

function sanitizeActivityText(detail?: string): string {
  if (!detail || typeof detail !== "string") return "";
  return redactSecretText(stripReasoningTagTokens(detail))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isMeaningfulThoughtDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
  if (isMidLoopContextCompactionDetail(detail)) return false;
  if (
    normalized === "thinking..." ||
    normalized === "thinking" ||
    normalized === "generating response..." ||
    normalized === "generating response" ||
    normalized === "idle" ||
    normalized === "working..." ||
    normalized === "working"
  ) {
    return false;
  }
  return true;
}

function statusToPhase(
  status: AgentStatus,
  requestedPhase?: ToolStatusPhase
): ToolStatusPhase | null {
  if (requestedPhase) return requestedPhase;
  if (status === "tool_executing") return "start";
  if (status === "tool_completed") return "result";
  if (status === "error") return "error";
  return null;
}

function normalizeToolName(value?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeToolCallId(value?: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeActivityTextForPhase(text: string, phase: ToolStatusPhase): string {
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

function defaultToolActivityText(toolName: string | undefined, phase: ToolStatusPhase): string {
  const label = toolName || "Tool";
  if (phase === "start") return `${label} running...`;
  if (phase === "result") return `${label} complete`;
  if (phase === "blocked") return `${label} blocked`;
  return `${label} failed`;
}

function findMatchingStartActivityIndex(
  activities: SessionActivitySnapshot[],
  timestamp: number,
  toolName?: string,
  toolCallId?: string
): number {
  const normalizedToolCallId = normalizeToolCallId(toolCallId);
  if (normalizedToolCallId) {
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const candidate = activities[index];
      if (!candidate || candidate.phase !== "start") continue;
      if (candidate.timestamp > timestamp) continue;
      if (candidate.toolCallId === normalizedToolCallId) {
        return index;
      }
    }
  }

  const normalizedToolName = toolName?.toLowerCase();
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const candidate = activities[index];
    if (!candidate || candidate.phase !== "start") continue;
    if (candidate.timestamp > timestamp) continue;
    if (normalizedToolName) {
      const candidateToolName = candidate.toolName?.toLowerCase();
      if (candidateToolName !== normalizedToolName) continue;
    }
    return index;
  }
  return -1;
}

function statusActivityId(payload: StatusPayload): string {
  if (payload.runId && typeof payload.sequence === "number") {
    return `${payload.runId}:${payload.sequence}`;
  }
  return `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export function reduceSessionStatusSnapshot(
  previous: SessionStatusSnapshot | undefined,
  payload: StatusPayload
): SessionStatusSnapshot | null {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) return previous ?? null;

  const nextActivities = previous?.activities.map((activity) => ({ ...activity })) || [];
  const phase = statusToPhase(payload.status, payload.toolPhase);
  const rawActivityText = sanitizeActivityText(payload.detail);
  const activityText =
    phase && rawActivityText
      ? normalizeActivityTextForPhase(rawActivityText, phase)
      : rawActivityText;
  const toolName = normalizeToolName(payload.toolName);
  const toolCallId = normalizeToolCallId(payload.toolCallId);
  const isThoughtStatus = payload.status === "thinking" || payload.status === "generating";

  if (phase) {
    if (phase === "start") {
      const startText = activityText || defaultToolActivityText(toolName, "start");
      nextActivities.push({
        id: statusActivityId(payload),
        phase: "start",
        text: startText,
        timestamp: payload.timestamp,
        toolName,
        toolCallId,
        sandboxProvider: payload.sandboxProvider,
      });
    } else {
      const matchIndex = findMatchingStartActivityIndex(
        nextActivities,
        payload.timestamp,
        toolName,
        toolCallId
      );
      if (matchIndex >= 0) {
        const matched = nextActivities[matchIndex];
        const matchedText = typeof matched?.text === "string" ? matched.text : "";
        const resolvedText =
          activityText ||
          normalizeActivityTextForPhase(matchedText, phase) ||
          defaultToolActivityText(toolName || matched?.toolName, phase);
        nextActivities[matchIndex] = {
          id: matched.id,
          phase,
          text: resolvedText,
          timestamp: matched.timestamp,
          toolName: toolName || matched.toolName,
          toolCallId: toolCallId || matched.toolCallId,
          sandboxProvider: payload.sandboxProvider || matched.sandboxProvider,
        };
      } else {
        const fallbackText = activityText || defaultToolActivityText(toolName, phase);
        nextActivities.push({
          id: statusActivityId(payload),
          phase,
          text: fallbackText,
          timestamp: payload.timestamp,
          toolName,
          toolCallId,
          sandboxProvider: payload.sandboxProvider,
        });
      }
    }
  } else if (isThoughtStatus && activityText && isMeaningfulThoughtDetail(activityText)) {
    const lastActivity = nextActivities[nextActivities.length - 1];
    const duplicateThought =
      lastActivity &&
      lastActivity.toolName === "__thought" &&
      lastActivity.text.trim().toLowerCase() === activityText.toLowerCase();
    if (!duplicateThought) {
      nextActivities.push({
        id: statusActivityId(payload),
        phase: "result",
        text: activityText,
        timestamp: payload.timestamp,
        toolName: "__thought",
      });
    }
  }

  if (payload.status === "idle") {
    return null;
  }

  return {
    sessionId,
    runId: payload.runId || previous?.runId,
    sequence: payload.sequence ?? previous?.sequence,
    status: payload.status,
    startedAt:
      previous && (!payload.runId || !previous.runId || payload.runId === previous.runId)
        ? previous.startedAt
        : payload.timestamp,
    timestamp: payload.timestamp,
    detail: sanitizeActivityText(payload.detail),
    agentId: payload.agentId,
    activities: nextActivities,
  };
}

function upsertSessionStatusSnapshot(payload: StatusPayload): void {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) return;
  const next = reduceSessionStatusSnapshot(sessionStatusSnapshots.get(sessionId), payload);
  if (!next) {
    sessionStatusSnapshots.delete(sessionId);
    return;
  }
  sessionStatusSnapshots.set(sessionId, next);
}

function cleanupStaleSnapshots(now = Date.now()): void {
  for (const [sessionId, snapshot] of sessionStatusSnapshots.entries()) {
    if (now - snapshot.timestamp > STATUS_STALE_MS && !sessionStatusLivenessResolver?.(sessionId)) {
      sessionStatusSnapshots.delete(sessionId);
    }
  }
}

export function listSessionStatusSnapshots(): SessionStatusSnapshot[] {
  cleanupStaleSnapshots();
  const snapshots = new Map<string, SessionStatusSnapshot>();
  for (const snapshot of sessionStatusSnapshots.values()) {
    if (!isSessionStatusActive(snapshot.status)) continue;
    snapshots.set(snapshot.sessionId, withPendingMessages(snapshot));
  }
  for (const [sessionId, pendingMessages] of sessionPendingChatMessages.entries()) {
    if (pendingMessages.length === 0 || snapshots.has(sessionId)) continue;
    snapshots.set(sessionId, pendingOnlySnapshot(sessionId, pendingMessages));
  }
  return Array.from(snapshots.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export function getSessionStatusSnapshot(sessionId: string): SessionStatusSnapshot | null {
  cleanupStaleSnapshots();
  const key = sessionId.trim();
  if (!key) return null;
  const snapshot = sessionStatusSnapshots.get(key);
  if (snapshot) return withPendingMessages(snapshot);
  const pendingMessages = pendingMessagesForSession(key);
  if (pendingMessages.length === 0) return null;
  return pendingOnlySnapshot(key, pendingMessages);
}

export function getSessionRunStatusSnapshot(sessionId: string): SessionStatusSnapshot | null {
  cleanupStaleSnapshots();
  const key = sessionId.trim();
  if (!key) return null;
  const snapshot = sessionStatusSnapshots.get(key);
  if (!snapshot) return null;
  return {
    ...snapshot,
    activities: snapshot.activities.map((activity) => ({ ...activity })),
  };
}

export function setSessionPendingChatMessages(
  sessionId: string,
  pendingMessages: PendingChatMessageSnapshot[]
): void {
  const key = sessionId.trim();
  if (!key) return;
  const normalized = clonePendingMessages(pendingMessages)
    .filter((message) => message.sessionId === key && message.content.trim().length > 0)
    .map((message) => ({
      ...message,
      content: redactSecretText(message.content),
    }));
  if (normalized.length === 0) {
    sessionPendingChatMessages.delete(key);
    return;
  }
  sessionPendingChatMessages.set(key, normalized);
}

export function addSSEClient(controller: ReadableStreamDefaultController<Uint8Array>): void {
  sseClients.add(controller);
  log.info("SSE client added", { clients: sseClients.size });
}

export function removeSSEClient(controller: ReadableStreamDefaultController<Uint8Array>): void {
  sseClients.delete(controller);
  log.info("SSE client removed", { clients: sseClients.size });
}

export function onStatus(callback: StatusCallback): () => void {
  statusCallbacks.add(callback);
  return () => {
    statusCallbacks.delete(callback);
  };
}

export function onStatusStream(callback: StatusStreamCallback): () => void {
  statusStreamCallbacks.add(callback);
  return () => {
    statusStreamCallbacks.delete(callback);
  };
}

function emitStatusStreamEvent(event: StatusStreamEvent): void {
  for (const callback of statusStreamCallbacks) {
    try {
      callback(event);
    } catch {}
  }

  const message = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const client of sseClients) {
    try {
      if (client.desiredSize !== null && client.desiredSize <= 0) {
        client.close();
        sseClients.delete(client);
        continue;
      }
      client.enqueue(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function createStatusSnapshotEvent(): StatusSnapshotEventPayload {
  const activeSessions = listSessionStatusSnapshots();
  return {
    type: "snapshot",
    timestamp: Date.now(),
    activeSessions,
    activeSessionIds: activeSessions.map((entry) => entry.sessionId),
    count: activeSessions.length,
  };
}

export function broadcastStatusSnapshot(): void {
  emitStatusStreamEvent(createStatusSnapshotEvent());
}

export function broadcastStatus(status: StatusPayload): void {
  const sanitizedStatus = redactSecrets(status) as StatusPayload;
  const sessionId = sanitizedStatus.sessionId?.trim();
  let runId = sanitizedStatus.runId;
  let sequence = sanitizedStatus.sequence;
  if (sessionId) {
    const activeRunId = getActiveSessionRunId(sessionId);
    runId = activeRunId || beginSessionRun(sessionId, runId);
    try {
      flushBufferedAssistantDeltas(sessionId, runId);
      if (!activeRunId) {
        appendSessionEvent({
          sessionId,
          runId,
          type: "run_started",
          payload: { timestamp: Date.now(), processId: process.pid },
        });
      }
      sequence = appendSessionEvent({
        sessionId,
        runId,
        type: sanitizedStatus.status === "error" ? "error" : "status",
        payload: sanitizedStatus,
      }).sequence;
    } catch {
      sequence = undefined;
    }
  }
  const sequencedStatus = { ...sanitizedStatus, runId, sequence };
  upsertSessionStatusSnapshot(sequencedStatus);
  notifyMobilePushForStatus(sequencedStatus);

  for (const callback of statusCallbacks) {
    try {
      callback(sequencedStatus);
    } catch {}
  }

  emitStatusStreamEvent({ ...sequencedStatus, type: "status" });

  if (sessionId && sequencedStatus.status === "idle") {
    if (runId) {
      try {
        appendSessionEvent({
          sessionId,
          runId,
          type: "run_completed",
          payload: { timestamp: Date.now() },
        });
        removeSupersededRecoveryCompletion(sessionId, runId);
      } catch {
        void 0;
      }
    }
    completeSessionRun(sessionId);
  }

  log.debug("Broadcast status", {
    status: status.status,
    callbacks: statusCallbacks.size,
    streamCallbacks: statusStreamCallbacks.size,
    sseClients: sseClients.size,
  });
}

export function broadcastTaskEvent(event: TaskEventPayload): void {
  const payload = redactSecrets({
    ...event,
    timestamp: Date.now(),
  }) as TaskEventPayload;
  notifyMobilePushForTask(payload);
  emitStatusStreamEvent(payload);

  log.debug("Broadcast task event", {
    taskName: event.taskName,
    taskStatus: event.status,
    streamCallbacks: statusStreamCallbacks.size,
    sseClients: sseClients.size,
  });
}

export function broadcastTokenDelta(event: {
  sessionId: string;
  agentId?: string;
  delta: string;
}): void {
  const sessionId = event.sessionId.trim();
  const runId = getActiveSessionRunId(sessionId) || ensureSessionRunId(sessionId);
  const timestamp = Date.now();
  const sanitizedDelta = redactSecretText(event.delta);
  try {
    appendBufferedAssistantDelta({
      sessionId,
      runId,
      agentId: event.agentId,
      delta: sanitizedDelta,
      timestamp,
    });
  } catch {
    void 0;
  }
  emitStatusStreamEvent({
    type: "assistant_token",
    sessionId,
    agentId: event.agentId,
    delta: sanitizedDelta,
    timestamp,
    runId,
  });
}
