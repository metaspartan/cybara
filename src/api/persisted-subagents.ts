import db from "../core/database";
import {
  getRun,
  normalizeSubagentActivities,
  normalizeSubagentThinking,
  normalizeSubagentToolCalls,
  type SubagentActivity,
  type SubagentRunRecord,
  type SubagentToolCall,
} from "../core/subagent-registry";

interface PersistedChild {
  id: string;
  parent_session_id: string;
  title: string | null;
  workspace_dir: string | null;
  created_at: string;
  updated_at: string;
  task: string | null;
  result: string | null;
}

interface PersistedChildMessage {
  session_id: string;
  content: string;
  metadata: string | null;
}

const TOOL_CALL_STATUSES = new Set(["pending", "executing", "completed", "failed"]);
const ACTIVITY_PHASES = new Set(["start", "result", "error", "blocked"]);

function timestamp(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMessageMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readToolCallStatus(value: unknown): SubagentToolCall["status"] {
  return typeof value === "string" && TOOL_CALL_STATUSES.has(value)
    ? (value as SubagentToolCall["status"])
    : undefined;
}

function readToolCalls(metadata: Record<string, unknown>, runId: string): SubagentToolCall[] {
  const raw = metadata.tool_calls;
  if (!Array.isArray(raw)) return [];
  const toolCalls: SubagentToolCall[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) continue;
    const args = isRecord(entry.args)
      ? entry.args
      : isRecord(entry.arguments)
        ? entry.arguments
        : undefined;
    toolCalls.push({
      id:
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : `${runId}-tool-${toolCalls.length}`,
      name,
      args,
      result: "result" in entry ? entry.result : null,
      status: readToolCallStatus(entry.status),
      timeline_index:
        typeof entry.timeline_index === "number" && Number.isFinite(entry.timeline_index)
          ? entry.timeline_index
          : toolCalls.length,
    });
  }
  return toolCalls;
}

function readActivities(metadata: Record<string, unknown>): SubagentActivity[] {
  const raw = metadata.process_activities;
  if (!Array.isArray(raw)) return [];
  const activities: SubagentActivity[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const text = typeof entry.text === "string" ? entry.text : "";
    const phase =
      typeof entry.phase === "string" && ACTIVITY_PHASES.has(entry.phase) ? entry.phase : "";
    if (!text.trim() || !phase) continue;
    activities.push({
      id:
        typeof entry.id === "string" && entry.id.trim()
          ? entry.id.trim()
          : `activity-${activities.length}`,
      phase: phase as SubagentActivity["phase"],
      text,
      timestamp:
        typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
          ? entry.timestamp
          : 0,
      toolName: typeof entry.toolName === "string" ? entry.toolName : undefined,
      toolCallId: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
      sandboxProvider:
        typeof entry.sandboxProvider === "string" ? entry.sandboxProvider : undefined,
    });
  }
  return activities;
}

interface PersistedRunDetails {
  thinking?: string;
  activities?: SubagentActivity[];
  toolCalls?: SubagentToolCall[];
  activityCount?: number;
  toolCallCount?: number;
}

function loadRunDetails(messages: PersistedChildMessage[]): Map<string, PersistedRunDetails> {
  const details = new Map<string, PersistedRunDetails>();
  for (const message of messages) {
    const metadata = parseMessageMetadata(message.metadata);
    if (!metadata) continue;
    const entry = details.get(message.session_id) ?? {};
    const toolCalls = readToolCalls(metadata, message.session_id);
    if (toolCalls.length > 0) {
      entry.toolCalls = [...(entry.toolCalls ?? []), ...toolCalls];
    }
    const activities = readActivities(metadata);
    if (activities.length > 0) {
      entry.activities = [...(entry.activities ?? []), ...activities];
    }
    if (Array.isArray(metadata.tool_calls)) {
      entry.toolCallCount = (entry.toolCallCount ?? 0) + metadata.tool_calls.length;
    }
    if (Array.isArray(metadata.process_activities)) {
      entry.activityCount = (entry.activityCount ?? 0) + metadata.process_activities.length;
    }
    if (typeof metadata.thinking === "string" && metadata.thinking.trim()) {
      entry.thinking = [entry.thinking, metadata.thinking].filter(Boolean).join("\n\n");
    }
    details.set(message.session_id, entry);
  }
  for (const [sessionId, entry] of details) {
    details.set(sessionId, {
      ...entry,
      thinking: normalizeSubagentThinking(entry.thinking),
      activities: normalizeSubagentActivities(entry.activities),
      toolCalls: normalizeSubagentToolCalls(entry.toolCalls, {
        requesterSessionKey: "persisted",
        runId: sessionId,
      }),
    });
  }
  return details;
}

function loadChildMessages(requesterSessionId?: string): PersistedChildMessage[] {
  return db
    .prepare(
      `
    SELECT cs.id AS session_id, m.content, m.metadata
    FROM chat_sessions cs
    JOIN session_messages m ON m.session_id = cs.id
    WHERE cs.parent_session_id IS NOT NULL
      ${requesterSessionId === undefined ? "" : "AND cs.parent_session_id = ?"}
    ORDER BY cs.id, m.created_at ASC, m.rowid ASC
  `
    )
    .all(
      ...(requesterSessionId === undefined ? [] : [requesterSessionId])
    ) as PersistedChildMessage[];
}

export function listPersistedSubagentRuns(requesterSessionId?: string): SubagentRunRecord[] {
  const rows = db
    .prepare(
      `
    SELECT cs.id, cs.parent_session_id, cs.title, cs.workspace_dir, cs.created_at, cs.updated_at,
      (SELECT content FROM session_messages WHERE session_id = cs.id AND role = 'user'
        ORDER BY created_at ASC, rowid ASC LIMIT 1) AS task,
      (SELECT content FROM session_messages WHERE session_id = cs.id AND role = 'assistant'
        ORDER BY created_at DESC, rowid DESC LIMIT 1) AS result
    FROM chat_sessions cs
    WHERE cs.parent_session_id IS NOT NULL
      ${requesterSessionId === undefined ? "" : "AND cs.parent_session_id = ?"}
    ORDER BY cs.created_at DESC, cs.id
  `
    )
    .all(...(requesterSessionId === undefined ? [] : [requesterSessionId])) as PersistedChild[];
  const details = loadRunDetails(loadChildMessages(requesterSessionId));
  return rows.map((row) => {
    const runDetails = details.get(row.id);
    return {
      imported: true,
      runId: row.id,
      childSessionKey: row.id,
      requesterSessionKey: row.parent_session_id,
      requesterDisplayKey: row.parent_session_id,
      task: row.task ?? row.title ?? "Imported subagent",
      label: row.title ?? undefined,
      cleanup: "keep",
      workspaceDir: row.workspace_dir ?? undefined,
      createdAt: timestamp(row.created_at),
      startedAt: timestamp(row.created_at),
      endedAt: timestamp(row.updated_at),
      outcome: { status: "ok", result: row.result ?? undefined },
      thinking: runDetails?.thinking,
      activities: runDetails?.activities,
      toolCalls: runDetails?.toolCalls,
      activityCount: runDetails?.activityCount,
      toolCallCount: runDetails?.toolCallCount,
    };
  });
}

export function mergeSubagentRuns(
  nativeRuns: SubagentRunRecord[],
  persistedRuns: SubagentRunRecord[]
): SubagentRunRecord[] {
  const nativeSessionKeys = new Set(nativeRuns.map((run) => run.childSessionKey));
  return [
    ...nativeRuns,
    ...persistedRuns.filter((run) => !nativeSessionKeys.has(run.childSessionKey)),
  ];
}

export function findSubagentRun(
  runId: string,
  requesterSessionId?: string
): SubagentRunRecord | undefined {
  const run =
    getRun(runId) ??
    listPersistedSubagentRuns(requesterSessionId).find((entry) => entry.runId === runId);
  if (run?.silent || (requesterSessionId && run?.requesterSessionKey !== requesterSessionId))
    return undefined;
  return run;
}
