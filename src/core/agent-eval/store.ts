import db from "../database";
import type { AgentEvalRun, AgentGolden, AgentTrajectory, StructuralComparison } from "./types";
import type { ParsedEvalSuiteGolden } from "./portable";

interface TrajectoryRow {
  id: string;
  session_id: string;
  turn_index: number;
  agent_id: string;
  provider: string | null;
  model: string | null;
  request_json: string;
  response_json: string;
  structure_json: string;
  created_at: string;
}

interface GoldenRow {
  id: string;
  trajectory_id: string;
  name: string;
  description: string | null;
  tags_json: string;
  baseline_json: string;
  created_at: string;
  updated_at: string;
}

interface EvalRunRow {
  id: string;
  golden_id: string;
  replay_session_id: string | null;
  status: AgentEvalRun["status"];
  score: number | null;
  diff_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function trajectoryFromRow(row: TrajectoryRow): AgentTrajectory {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    agentId: row.agent_id,
    provider: row.provider,
    model: row.model,
    request: parseJson<AgentTrajectory["request"]>(row.request_json),
    response: parseJson<AgentTrajectory["response"]>(row.response_json),
    structure: parseJson<AgentTrajectory["structure"]>(row.structure_json),
    createdAt: row.created_at,
  };
}

function goldenFromRow(row: GoldenRow): AgentGolden {
  return {
    id: row.id,
    trajectoryId: row.trajectory_id,
    name: row.name,
    description: row.description,
    tags: parseJson<string[]>(row.tags_json),
    baseline: parseJson<AgentTrajectory>(row.baseline_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runFromRow(row: EvalRunRow): AgentEvalRun {
  return {
    id: row.id,
    goldenId: row.golden_id,
    replaySessionId: row.replay_session_id,
    status: row.status,
    score: row.score,
    comparison: row.diff_json ? parseJson<StructuralComparison>(row.diff_json) : null,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function upsertTrajectory(trajectory: AgentTrajectory): AgentTrajectory {
  db.prepare(
    `INSERT INTO agent_trajectories
      (id, session_id, turn_index, agent_id, provider, model, request_json, response_json, structure_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, turn_index) DO UPDATE SET
       agent_id = excluded.agent_id,
       provider = excluded.provider,
       model = excluded.model,
       request_json = excluded.request_json,
       response_json = excluded.response_json,
       structure_json = excluded.structure_json,
       created_at = excluded.created_at`
  ).run(
    trajectory.id,
    trajectory.sessionId,
    trajectory.turnIndex,
    trajectory.agentId,
    trajectory.provider,
    trajectory.model,
    JSON.stringify(trajectory.request),
    JSON.stringify(trajectory.response),
    JSON.stringify(trajectory.structure),
    trajectory.createdAt
  );
  return getTrajectoryBySessionTurn(trajectory.sessionId, trajectory.turnIndex) ?? trajectory;
}

export function getTrajectory(id: string): AgentTrajectory | null {
  const row = db
    .prepare("SELECT * FROM agent_trajectories WHERE id = ?")
    .get(id) as TrajectoryRow | null;
  return row ? trajectoryFromRow(row) : null;
}

export function getTrajectoryBySessionTurn(
  sessionId: string,
  turnIndex: number
): AgentTrajectory | null {
  const row = db
    .prepare("SELECT * FROM agent_trajectories WHERE session_id = ? AND turn_index = ?")
    .get(sessionId, turnIndex) as TrajectoryRow | null;
  return row ? trajectoryFromRow(row) : null;
}

export function listSessionTrajectories(sessionId: string): AgentTrajectory[] {
  return (
    db
      .prepare("SELECT * FROM agent_trajectories WHERE session_id = ? ORDER BY turn_index ASC")
      .all(sessionId) as TrajectoryRow[]
  ).map(trajectoryFromRow);
}

export function listTrajectories(limit = 100, offset = 0): AgentTrajectory[] {
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const boundedOffset = Math.max(0, Math.floor(offset));
  return (
    db
      .prepare("SELECT * FROM agent_trajectories ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(boundedLimit, boundedOffset) as TrajectoryRow[]
  ).map(trajectoryFromRow);
}

export function countTrajectories(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM agent_trajectories").get() as {
    count: number;
  };
  return row.count;
}

export function deleteSessionTrajectories(sessionId: string): number {
  return db.prepare("DELETE FROM agent_trajectories WHERE session_id = ?").run(sessionId).changes;
}

export function saveGolden(input: {
  trajectory: AgentTrajectory;
  name: string;
  description?: string | null;
  tags?: string[];
}): AgentGolden {
  const id = crypto.randomUUID();
  const tags = (input.tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
  db.prepare(
    `INSERT INTO agent_goldens
      (id, trajectory_id, name, description, tags_json, baseline_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.trajectory.id,
    input.name.trim(),
    input.description?.trim() || null,
    JSON.stringify(tags),
    JSON.stringify(input.trajectory)
  );
  return getGolden(id) as AgentGolden;
}

export function getGolden(id: string): AgentGolden | null {
  const row = db.prepare("SELECT * FROM agent_goldens WHERE id = ?").get(id) as GoldenRow | null;
  return row ? goldenFromRow(row) : null;
}

export function listGoldens(): AgentGolden[] {
  return (
    db.prepare("SELECT * FROM agent_goldens ORDER BY updated_at DESC").all() as GoldenRow[]
  ).map(goldenFromRow);
}

export function importGoldens(entries: ParsedEvalSuiteGolden[]): AgentGolden[] {
  const imported: AgentGolden[] = [];
  db.transaction(() => {
    for (const entry of entries) {
      const importId = crypto.randomUUID();
      const trajectory = upsertTrajectory({
        ...entry.baseline,
        id: `trajectory_import_${importId.replaceAll("-", "")}`,
        sessionId: `eval-import-${importId}`,
        createdAt: new Date().toISOString(),
      });
      imported.push(
        saveGolden({
          trajectory,
          name: entry.name,
          description: entry.description,
          tags: entry.tags,
        })
      );
    }
  })();
  return imported;
}

export function deleteGolden(id: string): boolean {
  let deleted = false;
  db.transaction(() => {
    db.prepare("DELETE FROM agent_eval_runs WHERE golden_id = ?").run(id);
    deleted = (db.prepare("DELETE FROM agent_goldens WHERE id = ?").run(id).changes ?? 0) > 0;
  })();
  return deleted;
}

export function createEvalRun(goldenId: string): AgentEvalRun {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO agent_eval_runs (id, golden_id, status) VALUES (?, ?, 'running')").run(
    id,
    goldenId
  );
  return getEvalRun(id) as AgentEvalRun;
}

export function finishEvalRun(
  id: string,
  input: {
    replaySessionId?: string | null;
    comparison?: StructuralComparison | null;
    error?: string | null;
  }
): AgentEvalRun {
  const status: AgentEvalRun["status"] = input.error
    ? "error"
    : input.comparison?.equivalent
      ? "passed"
      : "failed";
  db.prepare(
    `UPDATE agent_eval_runs SET
       replay_session_id = ?, status = ?, score = ?, diff_json = ?, error = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    input.replaySessionId ?? null,
    status,
    input.comparison?.score ?? null,
    input.comparison ? JSON.stringify(input.comparison) : null,
    input.error ?? null,
    id
  );
  return getEvalRun(id) as AgentEvalRun;
}

export function getEvalRun(id: string): AgentEvalRun | null {
  const row = db.prepare("SELECT * FROM agent_eval_runs WHERE id = ?").get(id) as EvalRunRow | null;
  return row ? runFromRow(row) : null;
}

export function listEvalRuns(limit = 100): AgentEvalRun[] {
  return (
    db
      .prepare("SELECT * FROM agent_eval_runs ORDER BY created_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(500, Math.floor(limit)))) as EvalRunRow[]
  ).map(runFromRow);
}
