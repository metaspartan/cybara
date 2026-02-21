export type AgentStatus =
  | "idle"
  | "thinking"
  | "tool_executing"
  | "tool_completed"
  | "generating"
  | "error";

export type ToolStatusPhase = "start" | "result" | "error";

export interface StatusPayload {
  status: AgentStatus;
  timestamp: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
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

export interface SessionActivitySnapshot {
  id: string;
  phase: ToolStatusPhase;
  text: string;
  timestamp: number;
  toolName?: string;
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

const statusCallbacks = new Set<StatusCallback>();

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
const MAX_SESSION_ACTIVITY_ITEMS = 80;

function isActiveStatus(status: AgentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function sanitizeActivityText(detail?: string): string {
  if (!detail || typeof detail !== "string") return "";
  const trimmed = detail.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 240) return trimmed;
  return `${trimmed.slice(0, 237)}...`;
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

function upsertSessionStatusSnapshot(payload: StatusPayload): void {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) return;

  const previous = sessionStatusSnapshots.get(sessionId);
  const nextActivities = previous?.activities ? [...previous.activities] : [];
  const phase = statusToPhase(payload.status);
  const activityText = sanitizeActivityText(payload.detail);
  const isThoughtStatus = payload.status === "thinking" || payload.status === "generating";

  if (phase && activityText) {
    nextActivities.push({
      id: `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      phase,
      text: activityText,
      timestamp: payload.timestamp,
      toolName: payload.toolName,
    });
    if (nextActivities.length > MAX_SESSION_ACTIVITY_ITEMS) {
      nextActivities.splice(0, nextActivities.length - MAX_SESSION_ACTIVITY_ITEMS);
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
      if (nextActivities.length > MAX_SESSION_ACTIVITY_ITEMS) {
        nextActivities.splice(0, nextActivities.length - MAX_SESSION_ACTIVITY_ITEMS);
      }
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
  console.log(`[Status] SSE client added (${sseClients.size} total)`);
}

export function removeSSEClient(controller: ReadableStreamDefaultController<Uint8Array>): void {
  sseClients.delete(controller);
  console.log(`[Status] SSE client removed (${sseClients.size} remaining)`);
}

export function onStatus(callback: StatusCallback): () => void {
  statusCallbacks.add(callback);
  return () => {
    statusCallbacks.delete(callback);
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

  const message = encoder.encode(`data: ${JSON.stringify(status)}\n\n`);
  for (const client of sseClients) {
    try {
      client.enqueue(message);
    } catch {
      sseClients.delete(client);
    }
  }

  console.log(
    `[Status] Broadcast: ${status.status} (${statusCallbacks.size} callbacks, ${sseClients.size} SSE clients)`
  );
}

export function broadcastTaskEvent(event: TaskEventPayload): void {
  const payload = { ...event, timestamp: Date.now() };
  const message = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  for (const client of sseClients) {
    try {
      client.enqueue(message);
    } catch {
      sseClients.delete(client);
    }
  }

  console.log(
    `[Status] Task event: ${event.taskName} ${event.status} (${sseClients.size} SSE clients)`
  );
}
