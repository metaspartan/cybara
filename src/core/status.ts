import { createLogger } from "./logger";
import { stripReasoningTagTokens } from "./agent-internals";

export type AgentStatus =
  "idle" | "thinking" | "tool_executing" | "tool_completed" | "generating" | "compacting" | "error";

export type ToolStatusPhase = "start" | "result" | "error";

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

export type StatusStreamEvent =
  | ({ type: "status" } & StatusPayload)
  | TaskEventPayload
  | StatusSnapshotEventPayload
  | TokenStreamEventPayload;

/** A delta of assistant text streamed to the UI in real time. */
export interface TokenStreamEventPayload {
  type: "assistant_token";
  sessionId: string;
  agentId?: string;
  /** The text delta (may be a few characters or a line). */
  delta: string;
  timestamp: number;
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
  status: AgentStatus;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: SessionActivitySnapshot[];
}

type StatusCallback = (data: StatusPayload) => void;
type StatusStreamCallback = (event: StatusStreamEvent) => void;

const statusCallbacks = new Set<StatusCallback>();
const statusStreamCallbacks = new Set<StatusStreamCallback>();
const log = createLogger("Status");

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

const encoder = new TextEncoder();
const sessionStatusSnapshots = new Map<string, SessionStatusSnapshot>();
const ACTIVE_STATUSES = new Set<AgentStatus>([
  "thinking",
  "generating",
  "tool_executing",
  "tool_completed",
]);
const STATUS_STALE_MS = 15 * 60 * 1000;

function isActiveStatus(status: AgentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function sanitizeActivityText(detail?: string): string {
  if (!detail || typeof detail !== "string") return "";
  // Streamed reasoning deltas can arrive as bare markup (e.g. "</think>");
  // never let tag tokens become visible activity text.
  return stripReasoningTagTokens(detail).replace(/\s{2,}/g, " ").trim();
}

function isMeaningfulThoughtDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  if (!normalized) return false;
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

function statusToPhase(status: AgentStatus): ToolStatusPhase | null {
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

function upsertSessionStatusSnapshot(payload: StatusPayload): void {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) return;

  const previous = sessionStatusSnapshots.get(sessionId);
  const nextActivities = previous?.activities ? [...previous.activities] : [];
  const phase = statusToPhase(payload.status);
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
        id: `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
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
          timestamp: payload.timestamp,
          toolName: toolName || matched.toolName,
          toolCallId: toolCallId || matched.toolCallId,
          sandboxProvider: payload.sandboxProvider || matched.sandboxProvider,
        };
      } else {
        const fallbackText = activityText || defaultToolActivityText(toolName, phase);
        nextActivities.push({
          id: `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
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
        id: `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        phase: "result",
        text: activityText,
        timestamp: payload.timestamp,
        toolName: "__thought",
      });
    }
  }

  if (payload.status === "idle") {
    sessionStatusSnapshots.delete(sessionId);
    return;
  }

  sessionStatusSnapshots.set(sessionId, {
    sessionId,
    status: payload.status,
    timestamp: payload.timestamp,
    detail: sanitizeActivityText(payload.detail),
    agentId: payload.agentId,
    activities: nextActivities,
  });
}

function cleanupStaleSnapshots(now = Date.now()): void {
  for (const [sessionId, snapshot] of sessionStatusSnapshots.entries()) {
    if (now - snapshot.timestamp > STATUS_STALE_MS) {
      sessionStatusSnapshots.delete(sessionId);
    }
  }
}

export function listSessionStatusSnapshots(): SessionStatusSnapshot[] {
  cleanupStaleSnapshots();
  return Array.from(sessionStatusSnapshots.values())
    .filter((snapshot) => isActiveStatus(snapshot.status))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((snapshot) => ({
      ...snapshot,
      activities: snapshot.activities.map((activity) => ({ ...activity })),
    }));
}

export function getSessionStatusSnapshot(sessionId: string): SessionStatusSnapshot | null {
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
    } catch {
      // Ignore callback errors
    }
  }

  const message = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const client of sseClients) {
    try {
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

export function broadcastStatus(status: StatusPayload): void {
  upsertSessionStatusSnapshot(status);

  for (const callback of statusCallbacks) {
    try {
      callback(status);
    } catch {
      // Ignore callback errors
    }
  }

  emitStatusStreamEvent({ ...status, type: "status" });

  log.debug("Broadcast status", {
    status: status.status,
    callbacks: statusCallbacks.size,
    streamCallbacks: statusStreamCallbacks.size,
    sseClients: sseClients.size,
  });
}

export function broadcastTaskEvent(event: TaskEventPayload): void {
  const payload = { ...event, timestamp: Date.now() };
  emitStatusStreamEvent(payload);

  log.debug("Broadcast task event", {
    taskName: event.taskName,
    taskStatus: event.status,
    streamCallbacks: statusStreamCallbacks.size,
    sseClients: sseClients.size,
  });
}

/** Stream an assistant text delta to the UI in real time. */
export function broadcastTokenDelta(event: {
  sessionId: string;
  agentId?: string;
  delta: string;
}): void {
  emitStatusStreamEvent({
    type: "assistant_token",
    sessionId: event.sessionId,
    agentId: event.agentId,
    delta: event.delta,
    timestamp: Date.now(),
  });
}
