// Global status event system - no circular imports

// Status types for the agent
export type AgentStatus = "idle" | "thinking" | "tool_executing" | "generating" | "error";

export interface StatusPayload {
  status: AgentStatus;
  timestamp: number;
  detail?: string;
}

type StatusCallback = (data: StatusPayload) => void;

const statusCallbacks = new Set<StatusCallback>();

// SSE client controllers for real-time updates (now using Uint8Array for proper encoding)
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

// Text encoder for SSE messages
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
  // Call all registered callbacks
  for (const callback of statusCallbacks) {
    try {
      callback(status);
    } catch (e) {
      // Ignore callback errors
    }
  }

  // Send to all SSE clients (encoded as Uint8Array)
  const message = encoder.encode(`data: ${JSON.stringify(status)}\n\n`);
  for (const client of sseClients) {
    try {
      client.enqueue(message);
    } catch (e) {
      // Client disconnected, remove
      sseClients.delete(client);
    }
  }

  console.log(
    `[Status] Broadcast: ${status.status} (${statusCallbacks.size} callbacks, ${sseClients.size} SSE clients)`
  );
}
