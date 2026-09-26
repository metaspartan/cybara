import db from "../core/database";
import { getRun, type SubagentRunRecord } from "../core/subagent-registry";

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

function timestamp(value: string): number {
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
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
  return rows.map((row) => ({
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
  }));
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
