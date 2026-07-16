import { getFlagValue } from "./args";
import { CLI_API_BASE as API_BASE, fetchCliAPI as fetchAPI, withCliAuthHeaders } from "../client";

interface AgentLoopSummary {
  id: string;
  agentId: string;
  label: string;
  objective: string;
  status: string;
  stopReason?: string;
  createdAt: string;
  updatedAt: string;
  iterationsCompleted: number;
  maxIterations: number;
}

interface AgentLoopDetail extends AgentLoopSummary {
  startedAt?: string;
  endedAt?: string;
  maxDurationSeconds: number;
  modelOverride?: string;
  useTools: boolean;
  finalResponse?: string;
  error?: string;
  steps: Array<{
    iteration: number;
    durationMs: number;
    toolCallCount: number;
    done: boolean;
    response: string;
  }>;
}

function parseIntegerFlag(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseLoopStartArgs(args: string[]): {
  objective: string;
  maxIterations?: number;
  maxDurationSeconds?: number;
  model?: string;
  useTools?: boolean;
} {
  const objectiveFromFlag = getFlagValue(args, "--objective");
  const model = getFlagValue(args, "--model");
  const maxIterations = parseIntegerFlag(getFlagValue(args, "--max-iterations"));
  const maxDurationSeconds = parseIntegerFlag(getFlagValue(args, "--max-duration"));
  const useTools = args.includes("--no-tools") ? false : undefined;

  const objectiveTokens: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (
      token === "--objective" ||
      token === "--model" ||
      token === "--max-iterations" ||
      token === "--max-duration"
    ) {
      i += 1;
      continue;
    }
    if (token === "--no-tools") continue;
    objectiveTokens.push(token);
  }

  return {
    objective: (objectiveFromFlag || objectiveTokens.join(" ")).trim(),
    maxIterations,
    maxDurationSeconds,
    model,
    useTools,
  };
}

export async function rawLoopList(agentId?: string): Promise<void> {
  const endpoint = agentId ? `/api/agents/${encodeURIComponent(agentId)}/loops` : "/api/loops";
  const data = await fetchAPI<{ runs: AgentLoopSummary[] }>(endpoint);
  if (!data) {
    console.error("ERROR: Failed to fetch loop runs from", API_BASE);
    process.exit(1);
  }

  const runs = Array.isArray(data.runs) ? data.runs : [];
  console.log("CYBARA AGENT LOOPS");
  console.log("==================");
  if (agentId) {
    console.log(`agent: ${agentId}`);
  }
  console.log(`total: ${runs.length}`);
  console.log("");

  if (runs.length === 0) {
    console.log("No loop runs");
    return;
  }

  for (const run of runs) {
    const status =
      run.status === "running"
        ? "⟳"
        : run.status === "completed"
          ? "✓"
          : run.status === "failed" || run.status === "timeout"
            ? "✗"
            : "•";
    console.log(`${status} ${run.label.slice(0, 60)}`);
    console.log(`  id: ${run.id}`);
    console.log(
      `  status: ${run.status}${run.stopReason ? ` (${run.stopReason})` : ""}  iter: ${run.iterationsCompleted}/${run.maxIterations}`
    );
  }
}

export async function rawLoopStart(agentId: string, args: string[]): Promise<void> {
  if (!agentId) {
    console.error("ERROR: Please specify an agent ID");
    console.log("Usage: cybara loop start <agent-id> <objective>");
    process.exit(1);
  }

  const parsed = parseLoopStartArgs(args);
  if (!parsed.objective) {
    console.error("ERROR: Please specify an objective");
    console.log("Usage: cybara loop start <agent-id> <objective>");
    process.exit(1);
  }

  const response = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/loops`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      objective: parsed.objective,
      maxIterations: parsed.maxIterations,
      maxDurationSeconds: parsed.maxDurationSeconds,
      model: parsed.model,
      useTools: parsed.useTools,
      label: parsed.objective.slice(0, 80),
    }),
  });

  const result = (await response.json()) as {
    success?: boolean;
    runId?: string;
    error?: string;
    run?: AgentLoopSummary;
  };

  if (!result.success || !result.runId) {
    console.error(`✗ Failed to start loop: ${result.error || response.statusText}`);
    process.exit(1);
  }

  console.log(`✓ Started loop: ${result.runId}`);
  if (result.run) {
    console.log(`  agent: ${result.run.agentId}`);
    console.log(`  objective: ${result.run.objective.slice(0, 120)}`);
    console.log(`  status: ${result.run.status}`);
  }
}

export async function rawLoopShow(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a loop run ID");
    console.log("Usage: cybara loop show <run-id>");
    process.exit(1);
  }

  const data = await fetchAPI<{
    success: boolean;
    error?: string;
    run?: AgentLoopDetail;
  }>(`/api/loops/${encodeURIComponent(id)}`);
  if (!data) {
    console.error("ERROR: Failed to fetch loop run from", API_BASE);
    process.exit(1);
  }
  if (!data.success || !data.run) {
    console.error(`ERROR: ${data.error || "Loop run not found"}`);
    process.exit(1);
  }

  const run = data.run;
  console.log("CYBARA LOOP RUN");
  console.log("===============");
  console.log(`id: ${run.id}`);
  console.log(`agent: ${run.agentId}`);
  console.log(`status: ${run.status}${run.stopReason ? ` (${run.stopReason})` : ""}`);
  console.log(`iterations: ${run.iterationsCompleted}/${run.maxIterations}`);
  console.log(`duration_limit_s: ${run.maxDurationSeconds}`);
  console.log(`tools: ${run.useTools ? "enabled" : "disabled"}`);
  console.log(`objective: ${run.objective}`);
  if (run.error) console.log(`error: ${run.error}`);
  if (run.finalResponse) console.log(`final: ${run.finalResponse.slice(0, 200)}`);
}

export async function rawLoopCancel(id: string): Promise<void> {
  if (!id) {
    console.error("ERROR: Please specify a loop run ID");
    console.log("Usage: cybara loop cancel <run-id>");
    process.exit(1);
  }

  const response = await fetch(`${API_BASE}/api/loops/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: withCliAuthHeaders(),
  });
  const result = (await response.json()) as {
    success?: boolean;
    error?: string;
  };
  if (!result.success) {
    console.error(`✗ Failed to cancel: ${result.error || response.statusText}`);
    process.exit(1);
  }
  console.log(`✓ Cancellation requested: ${id}`);
}
