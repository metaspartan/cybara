import db from "./database";
import {
  extractLatestSessionPlanState,
  normalizeSessionPlanItems,
  summarizeSessionPlanItems,
  type ExtractedSessionPlanState,
  type SessionPlanLifecycle,
  type SessionPlanSnapshot,
} from "./session-plan";
import { broadcastSessionPlan } from "./status";
import { getActiveSessionRunId } from "./session-event-ledger";

interface StoredPlanRow {
  snapshot: string;
  writer_agent_id: string | null;
}

const activePlanTurns = new Set<string>();
db.exec(
  "CREATE TABLE IF NOT EXISTS session_plans (session_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, writer_agent_id TEXT, revision INTEGER NOT NULL)"
);

function storedState(sessionId: string): ExtractedSessionPlanState | null {
  const row = db
    .query<StoredPlanRow, [string]>(
      "SELECT snapshot, writer_agent_id FROM session_plans WHERE session_id = ?"
    )
    .get(sessionId);
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.snapshot);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.sessionId !== sessionId || !Array.isArray(record.items)) return null;
    const plan = parsed as SessionPlanSnapshot;
    plan.items = normalizeSessionPlanItems(plan.items);
    plan.summary = summarizeSessionPlanItems(plan.items);
    if (
      !["active", "completed", "paused", "needs_update", "cleared"].includes(String(plan.lifecycle))
    )
      plan.lifecycle = lifecycleFor(plan.items);
    if (!Number.isSafeInteger(plan.revision) || (plan.revision ?? -1) < 0) return null;
    return { plan, ...(row.writer_agent_id ? { writerAgentId: row.writer_agent_id } : {}) };
  } catch {
    return null;
  }
}

function lifecycleFor(items: SessionPlanSnapshot["items"]): SessionPlanLifecycle {
  if (items.length === 0) return "cleared";
  return items.every((item) => item.status === "completed" || item.status === "cancelled")
    ? "completed"
    : "active";
}

function save(plan: SessionPlanSnapshot, writerAgentId?: string): SessionPlanSnapshot {
  db.query(
    "INSERT INTO session_plans(session_id,snapshot,writer_agent_id,revision) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET snapshot=excluded.snapshot,writer_agent_id=excluded.writer_agent_id,revision=excluded.revision"
  ).run(plan.sessionId, JSON.stringify(plan), writerAgentId ?? null, plan.revision ?? 0);
  broadcastSessionPlan(plan);
  return plan;
}

export function recordSessionPlan(
  sessionId: string,
  items: SessionPlanSnapshot["items"],
  writerAgentId?: string
): SessionPlanSnapshot {
  const previous = storedState(sessionId);
  const normalized = normalizeSessionPlanItems(items);
  const runId = getActiveSessionRunId(sessionId);
  return save(
    {
      sessionId,
      items: normalized,
      summary: summarizeSessionPlanItems(normalized),
      updatedAt: new Date().toISOString(),
      revision: (previous?.plan.revision ?? 0) + 1,
      lifecycle: lifecycleFor(normalized),
      ...(runId ? { runId } : {}),
      source: "todo_tool",
    },
    writerAgentId
  );
}

export function beginSessionPlanTurn(sessionId: string): void {
  activePlanTurns.add(sessionId);
}

export function finishSessionPlanTurn(
  sessionId: string,
  outcome: "ended" | "paused"
): SessionPlanSnapshot | null {
  activePlanTurns.delete(sessionId);
  const state = storedState(sessionId);
  if (!state) return null;
  const lifecycle = lifecycleFor(state.plan.items);
  if (
    lifecycle !== "active" ||
    state.plan.lifecycle === "paused" ||
    state.plan.lifecycle === "needs_update"
  )
    return state.plan;
  return save(
    {
      ...state.plan,
      lifecycle: outcome === "paused" ? "paused" : "needs_update",
      revision: (state.plan.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    },
    state.writerAgentId
  );
}

export function readSessionPlanState(
  sessionId: string,
  messages: Parameters<typeof extractLatestSessionPlanState>[1]
): ExtractedSessionPlanState | null {
  const state = storedState(sessionId) ?? extractLatestSessionPlanState(sessionId, messages);
  if (!state) return null;
  const lifecycle = state.plan.lifecycle ?? lifecycleFor(state.plan.items);
  if (lifecycle === "active" && !activePlanTurns.has(sessionId)) {
    return {
      ...state,
      plan: save(
        {
          ...state.plan,
          lifecycle: "paused",
          revision: (state.plan.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        },
        state.writerAgentId
      ),
    };
  }
  return { ...state, plan: { ...state.plan, lifecycle } };
}

export function readSessionPlan(
  sessionId: string,
  messages: Parameters<typeof extractLatestSessionPlanState>[1]
): SessionPlanSnapshot | null {
  return readSessionPlanState(sessionId, messages)?.plan ?? null;
}

export function resetSessionPlanFromMessages(
  sessionId: string,
  messages: Parameters<typeof extractLatestSessionPlanState>[1]
): SessionPlanSnapshot {
  const previous = storedState(sessionId);
  const recovered = extractLatestSessionPlanState(sessionId, messages);
  const items = recovered?.plan.items ?? [];
  const lifecycle = lifecycleFor(items);
  activePlanTurns.delete(sessionId);
  return save(
    {
      sessionId,
      items,
      summary: summarizeSessionPlanItems(items),
      revision: (previous?.plan.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      lifecycle: lifecycle === "active" ? "paused" : lifecycle,
      source: "todo_tool",
    },
    recovered?.writerAgentId
  );
}

export function deleteSessionPlan(sessionId: string): void {
  activePlanTurns.delete(sessionId);
  db.query("DELETE FROM session_plans WHERE session_id=?").run(sessionId);
}
