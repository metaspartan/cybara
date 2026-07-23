import { createAuthenticatedWebSocket, withGatewayBasePath } from "@/lib/auth";
import {
  consumeStatusStreamReplayEvents,
  recordStatusStreamReplayEvent,
} from "@/lib/status-stream-replay";

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
  runId?: string;
  sequence?: number;
  status: StreamAgentStatus;
  startedAt?: number;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: StatusActivity[];
  pendingMessages?: PendingChatMessage[];
}

export interface StatusStreamStatusEvent {
  type: "status";
  runId?: string;
  sequence?: number;
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
  pendingChatId?: string;
  clientPendingId?: string;
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
  runId?: string;
  sequence?: number;
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
  replayBufferedSessionEvents?: boolean;
}

function toWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${withGatewayBasePath(path)}`;
}

export function connectStatusStream(handlers: ConnectStatusStreamHandlers): () => void {
  sharedStatusStreamSubscribe(handlers);
  return () => sharedStatusStreamUnsubscribe(handlers);
}

const statusStreamSubscribers = new Set<ConnectStatusStreamHandlers>();
let statusStreamSocket: WebSocket | null = null;
let statusStreamReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statusStreamHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let statusStreamClosedByClient = false;
let statusStreamLastMessageAt = 0;

const STATUS_STREAM_HEARTBEAT_MS = 15_000;
const STATUS_STREAM_STALE_MS = 45_000;

function clearStatusStreamReconnect() {
  if (!statusStreamReconnectTimer) return;
  clearTimeout(statusStreamReconnectTimer);
  statusStreamReconnectTimer = null;
}

function clearStatusStreamHeartbeat() {
  if (!statusStreamHeartbeatTimer) return;
  clearInterval(statusStreamHeartbeatTimer);
  statusStreamHeartbeatTimer = null;
}

function startStatusStreamHeartbeat() {
  clearStatusStreamHeartbeat();
  statusStreamLastMessageAt = Date.now();
  statusStreamHeartbeatTimer = setInterval(() => {
    const socket = statusStreamSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - statusStreamLastMessageAt > STATUS_STREAM_STALE_MS) {
      socket.close();
      return;
    }
    try {
      socket.send("ping");
    } catch {
      socket.close();
    }
  }, STATUS_STREAM_HEARTBEAT_MS);
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
  statusStreamSocket = createAuthenticatedWebSocket(toWebSocketUrl("/api/ws/status"));

  statusStreamSocket.onopen = () => {
    startStatusStreamHeartbeat();
    notifyStatusStreamOpen();
  };

  statusStreamSocket.onmessage = (event) => {
    statusStreamLastMessageAt = Date.now();
    if (String(event.data) === "pong") return;
    try {
      const payload = JSON.parse(String(event.data)) as StatusStreamEvent;
      if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return;
      const chatSubscriberActive = Array.from(statusStreamSubscribers).some(
        (subscriber) => subscriber.replayBufferedSessionEvents === true
      );
      if (!chatSubscriberActive) recordStatusStreamReplayEvent(payload);
      notifyStatusStreamEvent(payload);
    } catch {
      return;
    }
  };

  statusStreamSocket.onclose = () => {
    clearStatusStreamHeartbeat();
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
  if (handlers.replayBufferedSessionEvents) {
    for (const event of consumeStatusStreamReplayEvents()) handlers.onEvent(event);
  }
  ensureStatusStreamConnected();
}

function sharedStatusStreamUnsubscribe(handlers: ConnectStatusStreamHandlers) {
  statusStreamSubscribers.delete(handlers);
  if (statusStreamSubscribers.size > 0) return;
  statusStreamClosedByClient = true;
  clearStatusStreamReconnect();
  clearStatusStreamHeartbeat();
  try {
    statusStreamSocket?.close();
  } catch {
    return;
  } finally {
    statusStreamSocket = null;
  }
}
