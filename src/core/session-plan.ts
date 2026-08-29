export type SessionPlanItemStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type SessionPlanItemPriority = "high" | "medium" | "low";

export interface SessionPlanItem {
  content: string;
  status: SessionPlanItemStatus;
  priority: SessionPlanItemPriority;
}

export interface SessionPlanSummary {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
}

export interface SessionPlanSnapshot {
  sessionId: string;
  items: SessionPlanItem[];
  summary: SessionPlanSummary;
  updatedAt?: string;
  source: "todo_tool";
}

interface ToolCallLike {
  name?: unknown;
  args?: unknown;
  arguments?: unknown;
  result?: unknown;
}

interface MessageLike {
  timestamp?: unknown;
  agent_id?: unknown;
  tool_calls?: unknown;
}

export interface ExtractedSessionPlanState {
  plan: SessionPlanSnapshot;
  writerAgentId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStatus(value: unknown): SessionPlanItemStatus {
  if (value === "in_progress" || value === "completed" || value === "cancelled") return value;
  if (value === "canceled") return "cancelled";
  return "pending";
}

function normalizePriority(value: unknown): SessionPlanItemPriority {
  if (value === "high" || value === "low") return value;
  return "medium";
}

export function normalizeSessionPlanItems(value: unknown): SessionPlanItem[] {
  if (!Array.isArray(value)) return [];
  const items: SessionPlanItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const content = typeof raw.content === "string" ? raw.content.trim() : "";
    if (!content) continue;
    items.push({
      content: content.slice(0, 500),
      status: normalizeStatus(raw.status),
      priority: normalizePriority(raw.priority),
    });
  }
  return items.slice(0, 50);
}

export function summarizeSessionPlanItems(items: SessionPlanItem[]): SessionPlanSummary {
  const cancelled = items.filter((item) => item.status === "cancelled").length;
  return {
    total: items.length - cancelled,
    pending: items.filter((item) => item.status === "pending").length,
    inProgress: items.filter((item) => item.status === "in_progress").length,
    completed: items.filter((item) => item.status === "completed").length,
    cancelled,
  };
}

export function sanitizeTodoToolResult(result: unknown): {
  items: SessionPlanItem[];
  summary: SessionPlanSummary;
  note?: string;
} | null {
  const record = parseRecord(result);
  if (!record) return null;
  const items = normalizeSessionPlanItems(record.items);
  const summary = summarizeSessionPlanItems(items);
  const note =
    typeof record.note === "string" && record.note.trim()
      ? record.note.trim().slice(0, 300)
      : undefined;
  return {
    items,
    summary,
    ...(note ? { note } : {}),
  };
}

function planFromToolCall(
  sessionId: string,
  toolCall: ToolCallLike,
  updatedAt?: string
): SessionPlanSnapshot | undefined {
  if (String(toolCall.name || "").toLowerCase() !== "todo") return undefined;
  const resultRecord = parseRecord(toolCall.result);
  const resultPlan = Array.isArray(resultRecord?.items)
    ? sanitizeTodoToolResult(resultRecord)
    : null;
  const args = isRecord(toolCall.args)
    ? toolCall.args
    : isRecord(toolCall.arguments)
      ? toolCall.arguments
      : null;
  const items = resultPlan ? resultPlan.items : normalizeSessionPlanItems(args?.items);
  if (!resultPlan && items.length === 0) return undefined;
  return {
    sessionId,
    items,
    summary: summarizeSessionPlanItems(items),
    ...(updatedAt ? { updatedAt } : {}),
    source: "todo_tool",
  };
}

export function extractLatestSessionPlanState(
  sessionId: string,
  messages: MessageLike[]
): ExtractedSessionPlanState | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || !Array.isArray(message.tool_calls)) continue;
    for (let toolIndex = message.tool_calls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const rawTool = message.tool_calls[toolIndex];
      if (!isRecord(rawTool)) continue;
      const snapshot = planFromToolCall(
        sessionId,
        rawTool,
        typeof message.timestamp === "string" ? message.timestamp : undefined
      );
      if (snapshot) {
        const writerAgentId =
          typeof message.agent_id === "string" && message.agent_id.trim()
            ? message.agent_id.trim()
            : undefined;
        return {
          plan: snapshot,
          ...(writerAgentId ? { writerAgentId } : {}),
        };
      }
    }
  }
  return null;
}

export function extractLatestSessionPlan(
  sessionId: string,
  messages: MessageLike[]
): SessionPlanSnapshot | null {
  return extractLatestSessionPlanState(sessionId, messages)?.plan ?? null;
}
