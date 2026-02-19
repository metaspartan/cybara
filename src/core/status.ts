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

type StatusCallback = (data: StatusPayload) => void;

const statusCallbacks = new Set<StatusCallback>();

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

const encoder = new TextEncoder();

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
