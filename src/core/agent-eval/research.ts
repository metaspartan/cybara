import { createHash } from "crypto";
import { sanitizeTrajectory } from "./portable";
import type { AgentTrajectory, EvalMessage, EvalToolCall } from "./types";

export type ResearchExportFormat =
  | "cybara_trace"
  | "trl_sft"
  | "prompt_completion"
  | "long_context";

export type DatasetSplit = "train" | "validation" | "test";

export interface ResearchTraceSummary {
  id: string;
  sessionId: string;
  turnIndex: number;
  agentId: string;
  provider: string | null;
  model: string | null;
  promptPreview: string;
  responsePreview: string;
  messageCount: number;
  toolCallCount: number;
  failedToolCallCount: number;
  hasObservableReasoning: boolean;
  observableReasoningCharacters: number;
  qualityScore: number;
  qualityFlags: string[];
  split: DatasetSplit;
  createdAt: string;
}

export interface ResearchTraceStats {
  total: number;
  toolCalls: number;
  failedToolCalls: number;
  reasoningTraces: number;
  cleanTraces: number;
  train: number;
  validation: number;
  test: number;
}

export interface ResearchExport {
  format: ResearchExportFormat;
  filename: string;
  mimeType: "application/x-ndjson";
  content: string;
  count: number;
}

interface TrainingMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

function preview(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function toolCalls(trajectory: AgentTrajectory): EvalToolCall[] {
  return trajectory.response.tool_calls ?? [];
}

function failedToolCalls(trajectory: AgentTrajectory): EvalToolCall[] {
  return toolCalls(trajectory).filter(
    (call) => call.status === "failed" || typeof call.error === "string"
  );
}

export function researchDatasetSplit(id: string): DatasetSplit {
  const bucket =
    Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16) % 100;
  if (bucket < 80) return "train";
  if (bucket < 90) return "validation";
  return "test";
}

function quality(trajectory: AgentTrajectory): { score: number; flags: string[] } {
  const flags: string[] = [];
  const calls = toolCalls(trajectory);
  const failed = failedToolCalls(trajectory);
  if (!trajectory.request.userMessage.content.trim()) flags.push("missing_prompt");
  if (!trajectory.response.content.trim()) flags.push("missing_final_response");
  if (failed.length > 0) flags.push("failed_tools");
  if (calls.some((call) => call.status === "completed" && call.result === undefined)) {
    flags.push("missing_tool_results");
  }
  const score = Math.max(
    0,
    100 -
      (flags.includes("missing_prompt") ? 35 : 0) -
      (flags.includes("missing_final_response") ? 45 : 0) -
      (flags.includes("failed_tools") ? Math.min(30, failed.length * 10) : 0) -
      (flags.includes("missing_tool_results") ? 15 : 0)
  );
  return { score, flags };
}

export function summarizeResearchTrace(trajectory: AgentTrajectory): ResearchTraceSummary {
  const result = quality(trajectory);
  const reasoning = trajectory.response.thinking?.trim() ?? "";
  return {
    id: trajectory.id,
    sessionId: trajectory.sessionId,
    turnIndex: trajectory.turnIndex,
    agentId: trajectory.agentId,
    provider: trajectory.provider,
    model: trajectory.model,
    promptPreview: preview(trajectory.request.userMessage.content),
    responsePreview: preview(trajectory.response.content),
    messageCount: trajectory.request.contextMessageCount + 1,
    toolCallCount: toolCalls(trajectory).length,
    failedToolCallCount: failedToolCalls(trajectory).length,
    hasObservableReasoning: reasoning.length > 0,
    observableReasoningCharacters: reasoning.length,
    qualityScore: result.score,
    qualityFlags: result.flags,
    split: researchDatasetSplit(trajectory.id),
    createdAt: trajectory.createdAt,
  };
}

export function summarizeResearchTraces(trajectories: AgentTrajectory[]): {
  traces: ResearchTraceSummary[];
  stats: ResearchTraceStats;
} {
  const traces = trajectories.map(summarizeResearchTrace);
  return {
    traces,
    stats: {
      total: traces.length,
      toolCalls: traces.reduce((total, trace) => total + trace.toolCallCount, 0),
      failedToolCalls: traces.reduce((total, trace) => total + trace.failedToolCallCount, 0),
      reasoningTraces: traces.filter((trace) => trace.hasObservableReasoning).length,
      cleanTraces: traces.filter((trace) => trace.qualityFlags.length === 0).length,
      train: traces.filter((trace) => trace.split === "train").length,
      validation: traces.filter((trace) => trace.split === "validation").length,
      test: traces.filter((trace) => trace.split === "test").length,
    },
  };
}

function simpleMessage(message: EvalMessage): TrainingMessage {
  return { role: message.role, content: message.content };
}

function trainingMessages(trajectory: AgentTrajectory): TrainingMessage[] {
  const messages =
    trajectory.request.messages.length > 0
      ? trajectory.request.messages.map(simpleMessage)
      : [simpleMessage(trajectory.request.userMessage)];
  const calls = toolCalls(trajectory);
  if (calls.length > 0) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? call.args),
        },
      })),
    });
    for (const call of calls) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(call.error ? { error: call.error } : (call.result ?? null)),
      });
    }
  }
  messages.push({ role: "assistant", content: trajectory.response.content });
  return messages;
}

function metadata(trajectory: AgentTrajectory): Record<string, unknown> {
  const result = quality(trajectory);
  const reasoning = trajectory.response.thinking?.trim();
  return {
    trace_id: trajectory.id,
    session_id: trajectory.sessionId,
    turn_index: trajectory.turnIndex,
    agent_id: trajectory.agentId,
    provider: trajectory.provider,
    model: trajectory.model,
    split: researchDatasetSplit(trajectory.id),
    created_at: trajectory.createdAt,
    quality_score: result.score,
    quality_flags: result.flags,
    observable_reasoning: reasoning
      ? { kind: "provider_exposed", content: reasoning }
      : { kind: "none", content: null },
  };
}

function researchRecord(
  trajectory: AgentTrajectory,
  format: ResearchExportFormat
): Record<string, unknown> {
  if (format === "cybara_trace") {
    return {
      format: "cybara-agent-trace",
      version: 1,
      trajectory,
      metadata: metadata(trajectory),
    };
  }
  if (format === "trl_sft") {
    return {
      messages: trainingMessages(trajectory),
      metadata: metadata(trajectory),
    };
  }
  if (format === "long_context") {
    return {
      prompt: trajectory.request.userMessage.content,
      context: toolCalls(trajectory).map((call) => ({
        tool: call.name,
        arguments: call.arguments ?? call.args,
        status: call.status,
        output: call.error ? { error: call.error } : (call.result ?? null),
      })),
      completion: trajectory.response.content,
      metadata: metadata(trajectory),
    };
  }
  return {
    prompt: trajectory.request.userMessage.content,
    completion: trajectory.response.content,
    metadata: metadata(trajectory),
  };
}

export function exportResearchTraces(
  trajectories: AgentTrajectory[],
  options: { format: ResearchExportFormat; sanitize?: boolean }
): ResearchExport {
  const date = new Date().toISOString().slice(0, 10);
  const selected = options.sanitize ? trajectories.map(sanitizeTrajectory) : trajectories;
  return {
    format: options.format,
    filename: `cybara-${options.format.replaceAll("_", "-")}-${date}.jsonl`,
    mimeType: "application/x-ndjson",
    content: selected
      .map((trajectory) => JSON.stringify(researchRecord(trajectory, options.format)))
      .join("\n"),
    count: selected.length,
  };
}

export function parseResearchExportFormat(value: string | undefined): ResearchExportFormat {
  if (
    value === "cybara_trace" ||
    value === "trl_sft" ||
    value === "prompt_completion" ||
    value === "long_context"
  ) {
    return value;
  }
  return "cybara_trace";
}
