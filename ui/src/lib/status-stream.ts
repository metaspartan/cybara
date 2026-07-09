import { appendApiTokenParam } from "@/lib/auth";

export type StreamAgentStatus =
  | "idle"
  | "thinking"
  | "tool_executing"
  | "tool_completed"
  | "generating"
  | "compacting"
  | "error";

export interface StatusActivity {
  id: string;
  phase: "start" | "result" | "error" | "blocked";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface PendingChatMessage {
  id: string;
  sessionId: string;
  clientPendingId?: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  mode: "queued" | "steering";
  sequence: number;
}

export interface StatusSessionSnapshot {
  sessionId: string;
  status: StreamAgentStatus;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: StatusActivity[];
  pendingMessages?: PendingChatMessage[];
}

export interface StatusStreamStatusEvent {
  type: "status";
  status: StreamAgentStatus;
  timestamp: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
  toolPhase?: "start" | "result" | "error" | "blocked";
  durationMs?: number;
}

export interface StatusStreamTaskEvent {
  type: "task_completed";
  taskId: string;
  taskName: string;
  status: "completed" | "failed";
  sessionId?: string;
  resultPreview?: string;
  error?: string;
  timestamp?: number;
}

export interface StatusStreamSnapshotEvent {
  type: "snapshot";
  timestamp: number;
  activeSessions: StatusSessionSnapshot[];
  activeSessionIds: string[];
  count: number;
}

export interface StatusStreamTokenEvent {
  type: "assistant_token";
  sessionId: string;
  agentId?: string;
  delta: string;
  timestamp: number;
}

export type StatusStreamEvent =
  | StatusStreamStatusEvent
  | StatusStreamTaskEvent
  | StatusStreamSnapshotEvent
  | StatusStreamTokenEvent;

interface ConnectStatusStreamHandlers {
  onEvent: (event: StatusStreamEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

function toWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${appendApiTokenParam(path)}`;
}

export function connectStatusStream(handlers: ConnectStatusStreamHandlers): () => void {
  sharedStatusStreamSubscribe(handlers);
  return () => sharedStatusStreamUnsubscribe(handlers);
}

const statusStreamSubscribers = new Set<ConnectStatusStreamHandlers>();
let statusStreamSocket: WebSocket | null = null;
let statusStreamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statusStreamClosedByClient = false;

function clearStatusStreamReconnect() {
  if (!statusStreamReconnectTimer) return;
  clearTimeout(statusStreamReconnectTimer);
  statusStreamReconnectTimer = null;
}

function notifyStatusStreamOpen() {
  for (const subscriber of statusStreamSubscribers) {
    subscriber.onOpen?.();
  }
}

function notifyStatusStreamClose() {
  for (const subscriber of statusStreamSubscribers) {
    subscriber.onClose?.();
  }
}

function notifyStatusStreamEvent(payload: StatusStreamEvent) {
  for (const subscriber of statusStreamSubscribers) {
    subscriber.onEvent(payload);
  }
}

function ensureStatusStreamConnected() {
  if (
    statusStreamSocket &&
    (statusStreamSocket.readyState === WebSocket.OPEN ||
      statusStreamSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  if (statusStreamSubscribers.size === 0) return;

  clearStatusStreamReconnect();
  statusStreamClosedByClient = false;
  statusStreamSocket = new WebSocket(toWebSocketUrl("/api/ws/status"));

  statusStreamSocket.onopen = notifyStatusStreamOpen;

  statusStreamSocket.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as StatusStreamEvent;
      if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return;
      notifyStatusStreamEvent(payload);
    } catch {
      return;
    }
  };

  statusStreamSocket.onclose = () => {
    statusStreamSocket = null;
    notifyStatusStreamClose();
    if (statusStreamClosedByClient || statusStreamSubscribers.size === 0) return;
    statusStreamReconnectTimer = setTimeout(ensureStatusStreamConnected, 2000);
  };

  statusStreamSocket.onerror = () => {
    try {
      statusStreamSocket?.close();
    } catch {
      return;
    }
  };
}

function sharedStatusStreamSubscribe(handlers: ConnectStatusStreamHandlers) {
  statusStreamSubscribers.add(handlers);
  ensureStatusStreamConnected();
}

function sharedStatusStreamUnsubscribe(handlers: ConnectStatusStreamHandlers) {
  statusStreamSubscribers.delete(handlers);
  if (statusStreamSubscribers.size > 0) return;
  statusStreamClosedByClient = true;
  clearStatusStreamReconnect();
  try {
    statusStreamSocket?.close();
  } catch {
    return;
  } finally {
    statusStreamSocket = null;
  }
}
