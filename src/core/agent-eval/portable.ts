import type { AgentEvalRun, AgentGolden, AgentTrajectory, EvalMessage } from "./types";

export const EVAL_SUITE_FORMAT = "cybara-agent-eval-suite";
export const EVAL_SUITE_VERSION = 1;
export const MAX_IMPORTED_GOLDENS = 500;

export interface EvalSuiteBundle {
  format: typeof EVAL_SUITE_FORMAT;
  version: typeof EVAL_SUITE_VERSION;
  exportedAt: string;
  sanitized: boolean;
  goldens: AgentGolden[];
}

export interface ParsedEvalSuiteGolden {
  name: string;
  description: string | null;
  tags: string[];
  baseline: AgentTrajectory;
}

export interface AgentGoldenSummary {
  id: string;
  trajectoryId: string;
  name: string;
  description: string | null;
  tags: string[];
  baseline: {
    id: string;
    sessionId: string;
    turnIndex: number;
    agentId: string;
    provider: string | null;
    model: string | null;
    request: {
      userMessage: EvalMessage;
      userMessageIndex: number;
      workspaceDir: string | null;
    };
    structure: AgentTrajectory["structure"];
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, field: string, limit: number, required = false): string {
  if (typeof value !== "string") {
    if (!required) return "";
    throw new Error(`${field} must be a string`);
  }
  const text = value.trim();
  if (required && !text) throw new Error(`${field} is required`);
  if (text.length > limit) throw new Error(`${field} exceeds ${limit} characters`);
  return text;
}

function sanitizeMessage(message: EvalMessage): EvalMessage {
  return {
    ...message,
    content: message.content ? "[redacted]" : "",
    ...(message.thinking ? { thinking: "[redacted]" } : {}),
    tool_calls: message.tool_calls?.map((call) => ({
      ...call,
      args: {},
      ...(call.arguments ? { arguments: {} } : {}),
      ...(call.result === undefined ? {} : { result: "[redacted]" }),
      ...(call.error ? { error: "[redacted]" } : {}),
    })),
    process_activities: message.process_activities?.map((activity) => ({
      ...activity,
      text: "[redacted]",
    })),
  };
}

export function sanitizeTrajectory(trajectory: AgentTrajectory): AgentTrajectory {
  return {
    ...trajectory,
    request: {
      ...trajectory.request,
      messages: trajectory.request.messages.map(sanitizeMessage),
      userMessage: sanitizeMessage(trajectory.request.userMessage),
      workspaceDir: null,
    },
    response: sanitizeMessage(trajectory.response),
  };
}

export function createEvalSuiteBundle(
  goldens: AgentGolden[],
  options?: { sanitize?: boolean }
): EvalSuiteBundle {
  const sanitized = options?.sanitize === true;
  return {
    format: EVAL_SUITE_FORMAT,
    version: EVAL_SUITE_VERSION,
    exportedAt: new Date().toISOString(),
    sanitized,
    goldens: goldens.map((golden) => ({
      ...golden,
      baseline: sanitized ? sanitizeTrajectory(golden.baseline) : golden.baseline,
    })),
  };
}

export function summarizeGolden(golden: AgentGolden): AgentGoldenSummary {
  return {
    id: golden.id,
    trajectoryId: golden.trajectoryId,
    name: golden.name,
    description: golden.description,
    tags: golden.tags,
    baseline: {
      id: golden.baseline.id,
      sessionId: golden.baseline.sessionId,
      turnIndex: golden.baseline.turnIndex,
      agentId: golden.baseline.agentId,
      provider: golden.baseline.provider,
      model: golden.baseline.model,
      request: {
        userMessage: golden.baseline.request.userMessage,
        userMessageIndex: golden.baseline.request.userMessageIndex,
        workspaceDir: golden.baseline.request.workspaceDir,
      },
      structure: golden.baseline.structure,
      createdAt: golden.baseline.createdAt,
    },
    createdAt: golden.createdAt,
    updatedAt: golden.updatedAt,
  };
}

export function evalSuiteJsonl(
  goldens: AgentGolden[],
  options?: { sanitize?: boolean; runs?: AgentEvalRun[] }
): string {
  const bundle = createEvalSuiteBundle(goldens, options);
  const latestRuns = new Map<string, AgentEvalRun>();
  for (const run of options?.runs ?? []) {
    if (!latestRuns.has(run.goldenId)) latestRuns.set(run.goldenId, run);
  }
  return bundle.goldens
    .map((golden) => {
      const latestRun = latestRuns.get(golden.id);
      return JSON.stringify({
        format: "cybara-agent-trajectory",
        version: 1,
        id: golden.id,
        name: golden.name,
        description: golden.description,
        tags: golden.tags,
        conversations: [
          ...golden.baseline.request.messages.map((message) => ({
            from:
              message.role === "assistant" ? "gpt" : message.role === "user" ? "human" : "system",
            value: message.content,
          })),
          {
            from: "gpt",
            value: golden.baseline.response.content,
          },
        ],
        metadata: {
          provider: golden.baseline.provider,
          model: golden.baseline.model,
          agentId: golden.baseline.agentId,
          workspaceDir: golden.baseline.request.workspaceDir,
          contextHash: golden.baseline.request.contextHash,
          structure: golden.baseline.structure,
          toolCalls: golden.baseline.response.tool_calls ?? [],
          createdAt: golden.baseline.createdAt,
          latestEval: latestRun
            ? {
                status: latestRun.status,
                score: latestRun.score,
                differences: latestRun.comparison?.differences ?? [],
                error: latestRun.error,
                completedAt: latestRun.completedAt,
              }
            : null,
        },
      });
    })
    .join("\n");
}

function parseTrajectory(value: unknown, index: number): AgentTrajectory {
  if (!isRecord(value)) throw new Error(`goldens[${index}].baseline must be an object`);
  const request = value.request;
  const response = value.response;
  const structure = value.structure;
  if (!isRecord(request) || !Array.isArray(request.messages) || !isRecord(request.userMessage)) {
    throw new Error(`goldens[${index}].baseline.request is invalid`);
  }
  if (!isRecord(response) || typeof response.content !== "string") {
    throw new Error(`goldens[${index}].baseline.response is invalid`);
  }
  if (!isRecord(structure) || !Array.isArray(structure.tools) || !isRecord(structure.response)) {
    throw new Error(`goldens[${index}].baseline.structure is invalid`);
  }
  boundedText(value.agentId, `goldens[${index}].baseline.agentId`, 200, true);
  boundedText(
    request.userMessage.content,
    `goldens[${index}].baseline.request.userMessage`,
    2_000_000,
    true
  );
  const serialized = JSON.stringify(value);
  if (serialized.length > 5_000_000) throw new Error(`goldens[${index}] exceeds 5 MB`);
  return JSON.parse(serialized) as AgentTrajectory;
}

export function parseEvalSuiteBundle(value: unknown): ParsedEvalSuiteGolden[] {
  if (!isRecord(value)) throw new Error("Eval suite must be an object");
  if (value.format !== EVAL_SUITE_FORMAT || value.version !== EVAL_SUITE_VERSION) {
    throw new Error("Unsupported eval suite format or version");
  }
  if (value.sanitized === true) {
    throw new Error("Redacted eval exports are not replayable and cannot be imported");
  }
  if (!Array.isArray(value.goldens)) throw new Error("Eval suite goldens must be an array");
  if (value.goldens.length > MAX_IMPORTED_GOLDENS) {
    throw new Error(`Eval suite exceeds ${MAX_IMPORTED_GOLDENS} golden tests`);
  }
  return value.goldens.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`goldens[${index}] must be an object`);
    const tags = Array.isArray(entry.tags)
      ? entry.tags
          .map((tag) => boundedText(tag, `goldens[${index}].tags`, 80))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    return {
      name: boundedText(entry.name, `goldens[${index}].name`, 200, true),
      description: boundedText(entry.description, `goldens[${index}].description`, 2000) || null,
      tags,
      baseline: parseTrajectory(entry.baseline, index),
    };
  });
}
