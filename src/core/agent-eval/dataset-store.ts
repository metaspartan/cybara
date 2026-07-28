import db from "../database";
import type {
  AgentDatasetItem,
  AgentDatasetItemStatus,
  AgentDatasetRun,
  AgentDatasetRunStatus,
  AgentDatasetUsage,
} from "./types";

interface DatasetRunRow {
  id: string;
  name: string;
  agent_id: string;
  provider: string | null;
  model: string | null;
  status: AgentDatasetRunStatus;
  samples_per_prompt: number;
  concurrency: number;
  tools_enabled: number;
  max_output_tokens: number;
  sample_timeout_seconds: number;
  total_items: number;
  cancel_requested: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface DatasetItemRow {
  id: string;
  run_id: string;
  prompt_index: number;
  sample_index: number;
  prompt: string;
  session_id: string;
  status: AgentDatasetItemStatus;
  trajectory_id: string | null;
  usage_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface DatasetRunCountsRow {
  completed_items: number;
  failed_items: number;
  cancelled_items: number;
  queued_items: number;
  running_items: number;
}

interface DatasetUsageRow {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  call_count: number;
  duration_ms: number;
  average_first_token_ms: number | null;
}

const EMPTY_USAGE: AgentDatasetUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  cacheHitRate: null,
  totalTokens: 0,
  callCount: 0,
  durationMs: 0,
  tokensPerSecond: null,
  averageFirstTokenMs: null,
};

function parseUsage(value: string | null): AgentDatasetUsage {
  if (!value) return { ...EMPTY_USAGE };
  try {
    const parsed = JSON.parse(value) as Partial<AgentDatasetUsage>;
    return {
      inputTokens: Math.max(0, Number(parsed.inputTokens || 0)),
      outputTokens: Math.max(0, Number(parsed.outputTokens || 0)),
      cachedInputTokens: Math.max(0, Number(parsed.cachedInputTokens || 0)),
      cacheWriteTokens: Math.max(0, Number(parsed.cacheWriteTokens || 0)),
      cacheHitRate:
        typeof parsed.cacheHitRate === "number" && Number.isFinite(parsed.cacheHitRate)
          ? parsed.cacheHitRate
          : null,
      totalTokens: Math.max(0, Number(parsed.totalTokens || 0)),
      callCount: Math.max(0, Number(parsed.callCount || 0)),
      durationMs: Math.max(0, Number(parsed.durationMs || 0)),
      tokensPerSecond:
        typeof parsed.tokensPerSecond === "number" && Number.isFinite(parsed.tokensPerSecond)
          ? parsed.tokensPerSecond
          : null,
      averageFirstTokenMs:
        typeof parsed.averageFirstTokenMs === "number" &&
        Number.isFinite(parsed.averageFirstTokenMs)
          ? parsed.averageFirstTokenMs
          : null,
    };
  } catch {
    return { ...EMPTY_USAGE };
  }
}

function readRunUsage(runId: string): AgentDatasetUsage {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(json_extract(usage_json, '$.inputTokens')), 0) AS input_tokens,
        COALESCE(SUM(json_extract(usage_json, '$.outputTokens')), 0) AS output_tokens,
        COALESCE(SUM(json_extract(usage_json, '$.cachedInputTokens')), 0) AS cached_input_tokens,
        COALESCE(SUM(json_extract(usage_json, '$.cacheWriteTokens')), 0) AS cache_write_tokens,
        COALESCE(SUM(json_extract(usage_json, '$.totalTokens')), 0) AS total_tokens,
        COALESCE(SUM(json_extract(usage_json, '$.callCount')), 0) AS call_count,
        COALESCE(SUM(json_extract(usage_json, '$.durationMs')), 0) AS duration_ms,
        AVG(json_extract(usage_json, '$.averageFirstTokenMs')) AS average_first_token_ms
       FROM agent_dataset_items WHERE run_id = ? AND usage_json IS NOT NULL`
    )
    .get(runId) as DatasetUsageRow;
  const inputTokens = Math.max(0, Number(row.input_tokens || 0));
  const outputTokens = Math.max(0, Number(row.output_tokens || 0));
  const cachedInputTokens = Math.max(0, Number(row.cached_input_tokens || 0));
  const durationMs = Math.max(0, Number(row.duration_ms || 0));
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens: Math.max(0, Number(row.cache_write_tokens || 0)),
    cacheHitRate:
      inputTokens > 0 && cachedInputTokens <= inputTokens
        ? Number(((cachedInputTokens / inputTokens) * 100).toFixed(1))
        : null,
    totalTokens: Math.max(0, Number(row.total_tokens || 0)),
    callCount: Math.max(0, Number(row.call_count || 0)),
    durationMs,
    tokensPerSecond:
      durationMs > 0 ? Number(((outputTokens / durationMs) * 1000).toFixed(2)) : null,
    averageFirstTokenMs:
      typeof row.average_first_token_ms === "number" && Number.isFinite(row.average_first_token_ms)
        ? Math.round(row.average_first_token_ms)
        : null,
  };
}

function itemFromRow(row: DatasetItemRow): AgentDatasetItem {
  return {
    id: row.id,
    runId: row.run_id,
    promptIndex: row.prompt_index,
    sampleIndex: row.sample_index,
    prompt: row.prompt,
    sessionId: row.session_id,
    status: row.status,
    trajectoryId: row.trajectory_id,
    usage: parseUsage(row.usage_json),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function getDatasetItem(itemId: string): AgentDatasetItem | null {
  const row = db
    .prepare("SELECT * FROM agent_dataset_items WHERE id = ?")
    .get(itemId) as DatasetItemRow | null;
  return row ? itemFromRow(row) : null;
}

function countRunItems(runId: string): DatasetRunCountsRow {
  return db
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_items,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed_items,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_items,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_items,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_items
       FROM agent_dataset_items WHERE run_id = ?`
    )
    .get(runId) as DatasetRunCountsRow;
}

function runFromRow(row: DatasetRunRow): AgentDatasetRun {
  const counts = countRunItems(row.id);
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    samplesPerPrompt: row.samples_per_prompt,
    concurrency: row.concurrency,
    toolsEnabled: row.tools_enabled === 1,
    maxOutputTokens: Math.max(512, Number(row.max_output_tokens || 4096)),
    sampleTimeoutSeconds: Math.max(0.01, Number(row.sample_timeout_seconds || 300)),
    totalItems: row.total_items,
    completedItems: Number(counts.completed_items || 0),
    failedItems: Number(counts.failed_items || 0),
    cancelledItems: Number(counts.cancelled_items || 0),
    queuedItems: Number(counts.queued_items || 0),
    runningItems: Number(counts.running_items || 0),
    cancelRequested: row.cancel_requested === 1,
    usage: readRunUsage(row.id),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createDatasetRun(input: {
  name: string;
  agentId: string;
  provider?: string | null;
  model?: string | null;
  prompts: string[];
  samplesPerPrompt: number;
  concurrency: number;
  toolsEnabled: boolean;
  maxOutputTokens?: number;
  sampleTimeoutSeconds?: number;
}): AgentDatasetRun {
  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_dataset_runs
        (id, name, agent_id, provider, model, samples_per_prompt, concurrency, tools_enabled,
         max_output_tokens, sample_timeout_seconds, total_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.agentId,
      input.provider ?? null,
      input.model ?? null,
      input.samplesPerPrompt,
      input.concurrency,
      input.toolsEnabled ? 1 : 0,
      input.maxOutputTokens ?? 4096,
      input.sampleTimeoutSeconds ?? 300,
      input.prompts.length * input.samplesPerPrompt
    );
    const insertItem = db.prepare(
      `INSERT INTO agent_dataset_items
        (id, run_id, prompt_index, sample_index, prompt, session_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    input.prompts.forEach((prompt, promptIndex) => {
      for (let sampleIndex = 0; sampleIndex < input.samplesPerPrompt; sampleIndex += 1) {
        insertItem.run(
          crypto.randomUUID(),
          id,
          promptIndex,
          sampleIndex,
          prompt,
          crypto.randomUUID()
        );
      }
    });
  })();
  return getDatasetRun(id) as AgentDatasetRun;
}

export function getDatasetRun(id: string): AgentDatasetRun | null {
  const row = db
    .prepare("SELECT * FROM agent_dataset_runs WHERE id = ?")
    .get(id) as DatasetRunRow | null;
  return row ? runFromRow(row) : null;
}

export function listDatasetRuns(limit = 50): AgentDatasetRun[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return (
    db
      .prepare("SELECT * FROM agent_dataset_runs ORDER BY created_at DESC LIMIT ?")
      .all(boundedLimit) as DatasetRunRow[]
  ).map(runFromRow);
}

export function listDatasetRunItems(runId: string): AgentDatasetItem[] {
  return (
    db
      .prepare(
        "SELECT * FROM agent_dataset_items WHERE run_id = ? ORDER BY prompt_index, sample_index"
      )
      .all(runId) as DatasetItemRow[]
  ).map(itemFromRow);
}

export function markDatasetRunRunning(runId: string): AgentDatasetRun | null {
  const changed = db
    .prepare(
      `UPDATE agent_dataset_runs
     SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), completed_at = NULL, error = NULL
     WHERE id = ? AND status IN ('queued', 'running')`
    )
    .run(runId).changes;
  return changed === 1 ? getDatasetRun(runId) : null;
}

export function resetInterruptedDatasetItems(runId: string): number {
  const run = getDatasetRun(runId);
  if (!run) return 0;
  if (run.cancelRequested) {
    return db
      .prepare(
        `UPDATE agent_dataset_items
         SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP, error = 'Cancelled by user'
         WHERE run_id = ? AND status IN ('queued', 'running')`
      )
      .run(runId).changes;
  }
  return db
    .prepare(
      `UPDATE agent_dataset_items
       SET status = 'queued', started_at = NULL, error = NULL
       WHERE run_id = ? AND status = 'running'`
    )
    .run(runId).changes;
}

export function claimDatasetItem(runId: string): AgentDatasetItem | null {
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM agent_dataset_items
         WHERE run_id = ? AND status = 'queued'
         ORDER BY prompt_index, sample_index LIMIT 1`
      )
      .get(runId) as DatasetItemRow | null;
    if (!row) return null;
    const claimed = db
      .prepare(
        `UPDATE agent_dataset_items
         SET status = 'running', started_at = CURRENT_TIMESTAMP, error = NULL
         WHERE id = ? AND status = 'queued'`
      )
      .run(row.id).changes;
    if (claimed !== 1) return null;
    const updated = db
      .prepare("SELECT * FROM agent_dataset_items WHERE id = ?")
      .get(row.id) as DatasetItemRow;
    return itemFromRow(updated);
  })();
}

export function completeDatasetItem(
  itemId: string,
  trajectoryId: string,
  usage: AgentDatasetUsage
): AgentDatasetItem | null {
  const changed = db
    .prepare(
      `UPDATE agent_dataset_items
       SET status = 'completed', trajectory_id = ?, usage_json = ?, error = NULL,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running'`
    )
    .run(trajectoryId, JSON.stringify(usage), itemId).changes;
  return changed === 1 ? getDatasetItem(itemId) : null;
}

export function failDatasetItem(itemId: string, error: string): AgentDatasetItem | null {
  const changed = db
    .prepare(
      `UPDATE agent_dataset_items
       SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running'`
    )
    .run(error, itemId).changes;
  return changed === 1 ? getDatasetItem(itemId) : null;
}

export function cancelDatasetItem(itemId: string, error: string): AgentDatasetItem | null {
  const changed = db
    .prepare(
      `UPDATE agent_dataset_items
       SET status = 'cancelled', error = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running'`
    )
    .run(error, itemId).changes;
  return changed === 1 ? getDatasetItem(itemId) : null;
}

export function requestDatasetRunCancel(runId: string): AgentDatasetRun | null {
  const cancelled = db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE agent_dataset_runs
         SET cancel_requested = 1,
             status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
             completed_at = CASE WHEN status = 'queued' THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE id = ? AND status IN ('queued', 'running')`
      )
      .run(runId).changes;
    if (changed !== 1) return false;
    db.prepare(
      `UPDATE agent_dataset_items
       SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
       WHERE run_id = ? AND status = 'queued'`
    ).run(runId);
    return true;
  })();
  return cancelled ? getDatasetRun(runId) : null;
}

export function finalizeDatasetRun(runId: string, runtimeError?: string): AgentDatasetRun | null {
  const run = getDatasetRun(runId);
  if (!run) return null;
  const status: AgentDatasetRunStatus = runtimeError
    ? "error"
    : run.cancelRequested
      ? "cancelled"
      : run.completedItems === 0 && run.failedItems > 0
        ? "error"
        : "completed";
  const error = runtimeError ?? (status === "error" ? "All dataset items failed" : null);
  db.prepare(
    `UPDATE agent_dataset_runs
     SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(status, error, runId);
  return getDatasetRun(runId);
}

export function retryDatasetRun(runId: string): AgentDatasetRun | null {
  const retried = db.transaction(() => {
    const run = getDatasetRun(runId);
    if (!run || run.status === "queued" || run.status === "running") return false;
    const incompleteItems = db
      .prepare(
        `SELECT id FROM agent_dataset_items
         WHERE run_id = ? AND status != 'completed'`
      )
      .all(runId) as Array<{ id: string }>;
    if (incompleteItems.length === 0) return false;
    const resetItem = db.prepare(
      `UPDATE agent_dataset_items
       SET status = 'queued', session_id = ?, trajectory_id = NULL, usage_json = NULL,
           started_at = NULL, completed_at = NULL, error = NULL
       WHERE id = ? AND status != 'completed'`
    );
    for (const item of incompleteItems) {
      resetItem.run(crypto.randomUUID(), item.id);
    }
    db.prepare(
      `UPDATE agent_dataset_runs
       SET status = 'queued', cancel_requested = 0, started_at = NULL, completed_at = NULL, error = NULL
       WHERE id = ?`
    ).run(runId);
    return true;
  })();
  return retried ? getDatasetRun(runId) : null;
}

export function deleteDatasetRun(runId: string): boolean {
  const run = getDatasetRun(runId);
  if (!run || run.status === "queued" || run.status === "running") return false;
  return db.prepare("DELETE FROM agent_dataset_runs WHERE id = ?").run(runId).changes > 0;
}
