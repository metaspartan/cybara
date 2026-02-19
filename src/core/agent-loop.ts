import { agentManager, type AgentMessage } from "./agent";

export type AgentLoopStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type AgentLoopStopReason = "done" | "max_iterations" | "cancelled" | "timeout" | "error";

export interface AgentLoopStep {
  iteration: number;
  prompt: string;
  response: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  toolCallCount: number;
  done: boolean;
}

export interface AgentLoopRun {
  id: string;
  agentId: string;
  objective: string;
  label: string;
  status: AgentLoopStatus;
  stopReason?: AgentLoopStopReason;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  maxIterations: number;
  maxDurationSeconds: number;
  modelOverride?: string;
  useTools: boolean;
  iterationsCompleted: number;
  steps: AgentLoopStep[];
  lastResponse?: string;
  finalResponse?: string;
  error?: string;
  cancelRequested: boolean;
}

export interface StartAgentLoopInput {
  agentId: string;
  objective: string;
  label?: string;
  maxIterations?: number;
  maxDurationSeconds?: number;
  modelOverride?: string;
  useTools?: boolean;
}

const DEFAULT_MAX_ITERATIONS = 6;
const HARD_MAX_ITERATIONS = 50;
const DEFAULT_MAX_DURATION_SECONDS = 300;
const HARD_MAX_DURATION_SECONDS = 3600;
const MAX_STORED_RUNS = 200;

const loopRuns = new Map<string, AgentLoopRun>();
const cancelledRunIds = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function trimLabel(input: string | undefined, objective: string): string {
  const candidate = typeof input === "string" ? input.trim() : "";
  if (candidate.length > 0) {
    return candidate.slice(0, 120);
  }
  return objective.slice(0, 120);
}

function detectDone(response: string): { done: boolean; finalResponse: string } {
  const content = response.trim();
  const donePrefix = content.match(/^done:\s*/i);
  if (donePrefix) {
    return {
      done: true,
      finalResponse: content.slice(donePrefix[0].length).trim() || content,
    };
  }

  if (/\[done\]/i.test(content) || /<done>\s*true\s*<\/done>/i.test(content)) {
    return {
      done: true,
      finalResponse: content
        .replace(/\[done\]/gi, "")
        .replace(/<done>\s*true\s*<\/done>/gi, "")
        .trim(),
    };
  }

  return { done: false, finalResponse: content };
}

function buildLoopSystemPrompt(objective: string): string {
  return [
    "You are running in an autonomous objective loop.",
    "Work toward the objective using tools when useful.",
    "If objective is complete, start your response with 'DONE:' and then provide the final result.",
    "If objective cannot proceed safely, explain blockers and next safest action.",
    `Objective: ${objective}`,
  ].join("\n");
}

function buildIterationPrompt(
  objective: string,
  iteration: number,
  maxIterations: number,
  previousResponse?: string
): string {
  const header = `Iteration ${iteration}/${maxIterations}`;
  if (!previousResponse) {
    return [
      header,
      `Objective: ${objective}`,
      "Start working now. Include concrete progress and next action.",
      "Remember: if fully complete, start with DONE:.",
    ].join("\n");
  }

  return [
    header,
    `Objective: ${objective}`,
    "Previous iteration response:",
    previousResponse,
    "Continue execution. Include what changed and what you will do next.",
    "If fully complete, start with DONE:.",
  ].join("\n");
}

function pruneLoopRuns(): void {
  if (loopRuns.size <= MAX_STORED_RUNS) return;

  const sorted = [...loopRuns.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const toDelete = sorted.length - MAX_STORED_RUNS;

  for (let i = 0; i < toDelete; i++) {
    const runId = sorted[i]?.id;
    if (!runId) continue;
    loopRuns.delete(runId);
    cancelledRunIds.delete(runId);
  }
}

async function executeLoop(runId: string): Promise<void> {
  const run = loopRuns.get(runId);
  if (!run) return;

  run.status = "running";
  run.startedAt = nowIso();
  run.updatedAt = nowIso();

  const conversation: AgentMessage[] = [
    {
      role: "system",
      content: buildLoopSystemPrompt(run.objective),
    },
  ];

  const startedAtMs = Date.now();
  let previousResponse: string | undefined;

  try {
    for (let iteration = 1; iteration <= run.maxIterations; iteration++) {
      if (cancelledRunIds.has(run.id) || run.cancelRequested) {
        run.status = "cancelled";
        run.stopReason = "cancelled";
        break;
      }

      const elapsedMs = Date.now() - startedAtMs;
      if (elapsedMs > run.maxDurationSeconds * 1000) {
        run.status = "timeout";
        run.stopReason = "timeout";
        break;
      }

      const prompt = buildIterationPrompt(
        run.objective,
        iteration,
        run.maxIterations,
        previousResponse
      );

      conversation.push({ role: "user", content: prompt });
      const stepStartedAt = Date.now();

      const result = await agentManager.execute(run.agentId, conversation, {
        useTools: run.useTools,
        sessionId: `loop:${run.id}:${iteration}`,
        channel: "loop",
        userId: "loop-runner",
        modelOverride: run.modelOverride,
      });

      const response = (result.content || "").trim();
      conversation.push({ role: "assistant", content: response });
      previousResponse = response;

      const doneDetection = detectDone(response);
      const stepEndedAt = Date.now();

      run.steps.push({
        iteration,
        prompt,
        response,
        startedAt: new Date(stepStartedAt).toISOString(),
        endedAt: new Date(stepEndedAt).toISOString(),
        durationMs: Math.max(0, stepEndedAt - stepStartedAt),
        toolCallCount: result.tool_calls?.length || 0,
        done: doneDetection.done,
      });
      run.iterationsCompleted = iteration;
      run.lastResponse = response;
      run.updatedAt = nowIso();

      if (doneDetection.done) {
        run.status = "completed";
        run.stopReason = "done";
        run.finalResponse = doneDetection.finalResponse || response;
        break;
      }
    }

    if (run.status === "running") {
      run.status = "completed";
      run.stopReason = "max_iterations";
      run.finalResponse = run.lastResponse;
    } else if (run.status === "timeout" || run.status === "cancelled") {
      run.finalResponse = run.lastResponse;
    }
  } catch (error) {
    run.status = "failed";
    run.stopReason = "error";
    run.error = (error as Error).message || "Unknown loop execution error";
  } finally {
    run.endedAt = nowIso();
    run.updatedAt = nowIso();
    cancelledRunIds.delete(run.id);
  }
}

export function startAgentLoop(input: StartAgentLoopInput): AgentLoopRun {
  const agentId = input.agentId?.trim();
  const objective = input.objective?.trim();
  if (!agentId) {
    throw new Error("agentId is required");
  }
  if (!objective) {
    throw new Error("objective is required");
  }
  if (!agentManager.get(agentId)) {
    throw new Error("Agent not found");
  }

  const maxIterations = clampInteger(
    input.maxIterations,
    DEFAULT_MAX_ITERATIONS,
    1,
    HARD_MAX_ITERATIONS
  );
  const maxDurationSeconds = clampInteger(
    input.maxDurationSeconds,
    DEFAULT_MAX_DURATION_SECONDS,
    5,
    HARD_MAX_DURATION_SECONDS
  );

  const run: AgentLoopRun = {
    id: crypto.randomUUID(),
    agentId,
    objective,
    label: trimLabel(input.label, objective),
    status: "pending",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    maxIterations,
    maxDurationSeconds,
    modelOverride:
      typeof input.modelOverride === "string" && input.modelOverride.trim().length > 0
        ? input.modelOverride.trim()
        : undefined,
    useTools: input.useTools !== false,
    iterationsCompleted: 0,
    steps: [],
    cancelRequested: false,
  };

  loopRuns.set(run.id, run);
  pruneLoopRuns();

  executeLoop(run.id).catch((error) => {
    const current = loopRuns.get(run.id);
    if (!current) return;
    current.status = "failed";
    current.stopReason = "error";
    current.error = (error as Error).message || "Unhandled loop execution error";
    current.endedAt = nowIso();
    current.updatedAt = nowIso();
    cancelledRunIds.delete(run.id);
  });

  return { ...run };
}

export function getAgentLoopRun(runId: string): AgentLoopRun | undefined {
  const run = loopRuns.get(runId);
  if (!run) return undefined;
  return { ...run, steps: [...run.steps] };
}

export function listAgentLoopRuns(agentId?: string): AgentLoopRun[] {
  const runs = [...loopRuns.values()]
    .filter((run) => (!agentId ? true : run.agentId === agentId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((run) => ({ ...run, steps: [...run.steps] }));
  return runs;
}

export function cancelAgentLoopRun(runId: string): boolean {
  const run = loopRuns.get(runId);
  if (!run) return false;

  run.cancelRequested = true;
  run.updatedAt = nowIso();
  cancelledRunIds.add(runId);
  return true;
}

export function resetAgentLoopRunsForTests(): void {
  loopRuns.clear();
  cancelledRunIds.clear();
}
