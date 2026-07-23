export type TUIStreamStatus =
  | "idle"
  | "thinking"
  | "tool_executing"
  | "tool_completed"
  | "generating"
  | "compacting"
  | "error";

export interface TUIStreamActivity {
  id: string;
  phase: "start" | "result" | "error" | "blocked";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
}

export interface TUIStreamStatusEvent {
  type: "status";
  status: TUIStreamStatus;
  timestamp: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  toolPhase?: "start" | "result" | "error" | "blocked";
  pendingChatId?: string;
  clientPendingId?: string;
}

export interface TUIStreamTokenEvent {
  type: "assistant_token";
  sessionId: string;
  delta: string;
  timestamp: number;
}

export interface TUIStreamSnapshotEvent {
  type: "snapshot";
  timestamp: number;
  activeSessions: Array<{
    sessionId: string;
    status: TUIStreamStatus;
    detail?: string;
    activities: TUIStreamActivity[];
  }>;
}

export type TUIStatusStreamEvent =
  | TUIStreamStatusEvent
  | TUIStreamTokenEvent
  | TUIStreamSnapshotEvent;

export function reconcileTUIStreamingText(
  currentText: string,
  snapshot: TUIStreamSnapshotEvent,
  sessionId: string
): string {
  return snapshot.activeSessions.some((session) => session.sessionId === sessionId)
    ? currentText
    : "";
}

export interface TUIStatusStreamOptions {
  apiBase: string;
  apiKey?: string | null;
  gatewayPassword?: string | null;
  signal: AbortSignal;
  onEvent: (event: TUIStatusStreamEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const STREAM_STATUSES = new Set<TUIStreamStatus>([
  "idle",
  "thinking",
  "tool_executing",
  "tool_completed",
  "generating",
  "compacting",
  "error",
]);

const ACTIVITY_PHASES = new Set<TUIStreamActivity["phase"]>([
  "start",
  "result",
  "error",
  "blocked",
]);

function streamStatus(value: unknown): TUIStreamStatus | null {
  return typeof value === "string" && STREAM_STATUSES.has(value as TUIStreamStatus)
    ? (value as TUIStreamStatus)
    : null;
}

function activityPhase(value: unknown): TUIStreamActivity["phase"] | null {
  return typeof value === "string" && ACTIVITY_PHASES.has(value as TUIStreamActivity["phase"])
    ? (value as TUIStreamActivity["phase"])
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseActivity(value: unknown): TUIStreamActivity | null {
  if (!isRecord(value)) return null;
  const phase = activityPhase(value.phase);
  const timestamp = finiteNumber(value.timestamp);
  if (
    typeof value.id !== "string" ||
    !phase ||
    typeof value.text !== "string" ||
    timestamp === null
  ) {
    return null;
  }
  return {
    id: value.id,
    phase,
    text: value.text,
    timestamp,
    toolName: optionalString(value.toolName),
    toolCallId: optionalString(value.toolCallId),
  };
}

export function parseTUIStatusEvent(value: string): TUIStatusStreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    const timestamp = finiteNumber(parsed.timestamp);
    if (parsed.type === "assistant_token") {
      if (
        timestamp === null ||
        typeof parsed.sessionId !== "string" ||
        typeof parsed.delta !== "string"
      ) {
        return null;
      }
      return {
        type: "assistant_token",
        sessionId: parsed.sessionId,
        delta: parsed.delta,
        timestamp,
      };
    }
    if (parsed.type === "status") {
      const status = streamStatus(parsed.status);
      const phase = parsed.toolPhase === undefined ? undefined : activityPhase(parsed.toolPhase);
      if (timestamp === null || !status || phase === null) return null;
      return {
        type: "status",
        status,
        timestamp,
        detail: optionalString(parsed.detail),
        sessionId: optionalString(parsed.sessionId),
        agentId: optionalString(parsed.agentId),
        toolName: optionalString(parsed.toolName),
        toolCallId: optionalString(parsed.toolCallId),
        toolPhase: phase,
        pendingChatId: optionalString(parsed.pendingChatId),
        clientPendingId: optionalString(parsed.clientPendingId),
      };
    }
    if (parsed.type === "snapshot") {
      if (timestamp === null || !Array.isArray(parsed.activeSessions)) return null;
      const activeSessions = parsed.activeSessions.flatMap((value) => {
        if (!isRecord(value) || typeof value.sessionId !== "string") return [];
        const status = streamStatus(value.status);
        if (!status || !Array.isArray(value.activities)) return [];
        return [
          {
            sessionId: value.sessionId,
            status,
            detail: optionalString(value.detail),
            activities: value.activities.flatMap((activity) => {
              const parsedActivity = parseActivity(activity);
              return parsedActivity ? [parsedActivity] : [];
            }),
          },
        ];
      });
      return { type: "snapshot", timestamp, activeSessions };
    }
  } catch {
    return null;
  }
  return null;
}

export async function consumeTUIStatusStream(options: TUIStatusStreamOptions): Promise<void> {
  const headers = new Headers({ Accept: "text/event-stream" });
  if (options.apiKey) headers.set("Authorization", `Bearer ${options.apiKey}`);
  if (options.gatewayPassword) {
    headers.set("X-Cybara-Gateway-Password", options.gatewayPassword);
  }
  const response = await fetch(`${options.apiBase}/api/sse/status`, {
    headers,
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Status stream unavailable (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!options.signal.aborted) {
    const next = await reader.read();
    if (next.done) return;
    buffer += decoder.decode(next.value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = parseTUIStatusEvent(data);
      if (event) options.onEvent(event);
    }
  }
}
