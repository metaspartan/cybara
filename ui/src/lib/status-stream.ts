import { appendApiTokenParam } from "@/lib/auth";

export type StreamAgentStatus =
  "idle" | "thinking" | "tool_executing" | "tool_completed" | "generating" | "compacting" | "error";

export interface StatusActivity {
  id: string;
  phase: "start" | "result" | "error";
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
  toolPhase?: "start" | "result" | "error";
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
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    clearReconnect();
    socket = new WebSocket(toWebSocketUrl("/api/ws/status"));

    socket.onopen = () => {
      handlers.onOpen?.();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as StatusStreamEvent;
        if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return;
        handlers.onEvent(payload);
      } catch {
        // Ignore malformed payloads.
      }
    };

    socket.onclose = () => {
      handlers.onClose?.();
      if (closedByUser) return;
      reconnectTimer = setTimeout(connect, 2000);
    };

    socket.onerror = () => {
      try {
        socket?.close();
      } catch {
        // ignore
      }
    };
  };

  connect();

  return () => {
    closedByUser = true;
    clearReconnect();
    try {
      socket?.close();
    } catch {
      // ignore
    }
    socket = null;
  };
}
