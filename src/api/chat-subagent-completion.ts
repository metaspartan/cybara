import type { AgentToolCallResult } from "../core/agent-internals";
import type { handleSessionsWait } from "../core/tools/handlers/channel";

interface SpawnResult {
  runId?: unknown;
  status?: unknown;
}

interface WaitRunResult {
  runId?: unknown;
  status?: unknown;
}

interface WaitResult {
  runs?: unknown;
}

interface AwaitSpawnedSubagentsOptions {
  abortSignal: AbortSignal;
  agentId: string;
  sessionId: string;
  toolResults: AgentToolCallResult[];
  onWaiting: (pendingCount: number) => void;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "timeout", "killed"]);

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function acceptedSpawnRunIds(toolResults: AgentToolCallResult[]): string[] {
  return toolResults.flatMap((toolCall) => {
    if (toolCall.name !== "sessions_spawn") return [];
    const result = objectValue(toolCall.result) as SpawnResult | undefined;
    return result?.status === "accepted" && typeof result.runId === "string" && result.runId.trim()
      ? [result.runId.trim()]
      : [];
  });
}

function retrievedTerminalRunIds(toolResults: AgentToolCallResult[]): Set<string> {
  const runIds = new Set<string>();
  for (const toolCall of toolResults) {
    if (toolCall.name !== "sessions_wait") continue;
    const result = objectValue(toolCall.result) as WaitResult | undefined;
    if (!Array.isArray(result?.runs)) continue;
    for (const candidate of result.runs) {
      const run = objectValue(candidate) as WaitRunResult | undefined;
      if (
        typeof run?.runId === "string" &&
        typeof run.status === "string" &&
        TERMINAL_RUN_STATUSES.has(run.status)
      ) {
        runIds.add(run.runId);
      }
    }
  }
  return runIds;
}

export function unresolvedSpawnRunIds(toolResults: AgentToolCallResult[]): string[] {
  const retrieved = retrievedTerminalRunIds(toolResults);
  return [...new Set(acceptedSpawnRunIds(toolResults))].filter((runId) => !retrieved.has(runId));
}

export async function awaitSpawnedSubagentResults(
  options: AwaitSpawnedSubagentsOptions
): Promise<AgentToolCallResult | undefined> {
  const runIds = unresolvedSpawnRunIds(options.toolResults);
  if (runIds.length === 0) return undefined;

  const startedAt = Date.now();
  let pendingRunIds = runIds;
  let result: Awaited<ReturnType<typeof handleSessionsWait>> | undefined;
  const channelTools = await import("../core/tools/handlers/channel");

  while (pendingRunIds.length > 0) {
    options.onWaiting(pendingRunIds.length);
    result = await channelTools.handleSessionsWait(
      { runIds, timeoutSeconds: 60 },
      {
        abortSignal: options.abortSignal,
        agentId: options.agentId,
        sessionId: options.sessionId,
      }
    );
    pendingRunIds = result.pendingRunIds;
  }

  return {
    id: `auto-wait-${crypto.randomUUID()}`,
    name: "sessions_wait",
    args: { runIds },
    result,
    duration: Math.max(0, Date.now() - startedAt),
  };
}
