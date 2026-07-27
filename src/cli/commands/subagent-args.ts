import { type AgentIdentifierCandidate, resolveAgentIdentifier } from "./agent-resolution";

export interface SubagentSpawnPayload {
  task: string;
  label: string;
  agentId?: string;
  model?: string;
  runTimeoutSeconds?: number;
  cleanup?: "keep" | "delete";
  workspaceDir?: string;
  maxActiveChildren?: number;
  requesterSessionId?: string;
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return Math.floor(parsed);
}

export function parseSubagentSpawnArgs(args: string[]): SubagentSpawnPayload {
  const taskParts: string[] = [];
  const payload: Partial<SubagentSpawnPayload> = {};
  let parseFlags = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (parseFlags && arg === "--") {
      parseFlags = false;
      continue;
    }

    if (parseFlags && arg === "--agent") {
      payload.agentId = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    if (parseFlags && arg === "--model") {
      payload.model = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    if (parseFlags && arg === "--timeout") {
      payload.runTimeoutSeconds = parseNonNegativeInteger(readFlagValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (parseFlags && arg === "--no-timeout") {
      payload.runTimeoutSeconds = 0;
      continue;
    }

    if (parseFlags && arg === "--cleanup") {
      const cleanup = readFlagValue(args, index, arg);
      if (cleanup !== "keep" && cleanup !== "delete") {
        throw new Error("--cleanup must be keep or delete");
      }
      payload.cleanup = cleanup;
      index += 1;
      continue;
    }

    if (parseFlags && arg === "--workspace") {
      payload.workspaceDir = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    if (parseFlags && arg === "--max-active") {
      payload.maxActiveChildren = parseNonNegativeInteger(readFlagValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (parseFlags && arg === "--session") {
      payload.requesterSessionId = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    taskParts.push(arg);
  }

  const task = taskParts.join(" ").trim();
  if (!task) {
    throw new Error("Please specify a task");
  }

  return {
    ...payload,
    task,
    label: `Task: ${task.slice(0, 30)}...`,
  };
}

export function resolveSubagentSpawnAgent(
  payload: SubagentSpawnPayload,
  agents: AgentIdentifierCandidate[]
): SubagentSpawnPayload {
  if (!payload.agentId) return payload;
  const agentId = resolveAgentIdentifier(payload.agentId, agents);
  return agentId ? { ...payload, agentId } : payload;
}
