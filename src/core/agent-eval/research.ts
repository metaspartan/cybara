import { createHash } from "crypto";
import { sanitizeTrajectory } from "./portable";
import type { AgentTrajectory, EvalMessage, EvalToolCall } from "./types";

export type ResearchExportFormat =
  | "cybara_trace"
  | "trl_sft"
  | "distillation_sft"
  | "hf_session_trace"
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
  toolNames: string[];
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

export interface ResearchDatasetCard {
  filename: "README.md";
  mimeType: "text/markdown";
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

interface TrainingToolSchema {
  type: "function";
  function: {
    name: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string }>;
      required: string[];
    };
  };
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
    toolNames: [...new Set(toolCalls(trajectory).map((call) => call.name))],
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

function jsonSchemaType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  if (typeof value === "object") return "object";
  return typeof value;
}

function observedToolSchemas(trajectory: AgentTrajectory): TrainingToolSchema[] {
  const schemas = new Map<
    string,
    { calls: number; properties: Map<string, { type: string; occurrences: number }> }
  >();
  for (const call of toolCalls(trajectory)) {
    const args = call.arguments ?? call.args;
    const record = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    const schema = schemas.get(call.name) ?? { calls: 0, properties: new Map() };
    schema.calls += 1;
    for (const [key, value] of Object.entries(record)) {
      const property = schema.properties.get(key);
      schema.properties.set(key, {
        type: property?.type ?? jsonSchemaType(value),
        occurrences: (property?.occurrences ?? 0) + 1,
      });
    }
    schemas.set(call.name, schema);
  }
  return [...schemas.entries()].map(([name, schema]) => ({
    type: "function",
    function: {
      name,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          [...schema.properties.entries()].map(([key, property]) => [key, { type: property.type }])
        ),
        required: [...schema.properties.entries()]
          .filter(([, property]) => property.occurrences === schema.calls)
          .map(([key]) => key),
      },
    },
  }));
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
      tools: observedToolSchemas(trajectory),
      metadata: metadata(trajectory),
    };
  }
  if (format === "distillation_sft") {
    return {
      messages: trainingMessages(trajectory),
      tools: observedToolSchemas(trajectory),
      teacher: {
        provider: trajectory.provider,
        model: trajectory.model,
        observable_reasoning: trajectory.response.thinking?.trim() || null,
      },
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

function hfSessionTraceLines(trajectories: AgentTrajectory[]): string[] {
  const sessionIds = [...new Set(trajectories.map((trajectory) => trajectory.sessionId))];
  if (sessionIds.length > 1) {
    throw new Error(
      "Validation error: Hugging Face session trace export requires traces from one chat"
    );
  }
  const sessionId = sessionIds[0] ?? "empty";
  const ordered = [...trajectories].sort((left, right) => left.turnIndex - right.turnIndex);
  const lines: Record<string, unknown>[] = [
    {
      type: "session",
      harness: "cybara",
      id: sessionId,
      name: ordered[0]?.request.userMessage.content.slice(0, 80) || "Cybara agent session",
    },
  ];
  for (const trajectory of ordered) {
    lines.push({
      type: "message",
      message: {
        role: "user",
        content: trajectory.request.userMessage.content,
        timestamp: trajectory.createdAt,
      },
    });
    const calls = toolCalls(trajectory);
    if (calls.length > 0) {
      lines.push({
        type: "message",
        message: {
          role: "assistant",
          content: "",
          reasoningContent: trajectory.response.thinking?.trim() || undefined,
          model: trajectory.model ?? undefined,
          toolCalls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? call.args),
            },
          })),
          timestamp: trajectory.createdAt,
        },
      });
      for (const call of calls) {
        lines.push({
          type: "message",
          message: {
            role: "tool",
            content: JSON.stringify(call.error ? { error: call.error } : (call.result ?? null)),
            toolCallId: call.id,
            timestamp: trajectory.createdAt,
          },
        });
      }
    }
    lines.push({
      type: "message",
      message: {
        role: "assistant",
        content: trajectory.response.content,
        reasoningContent: calls.length === 0 ? trajectory.response.thinking?.trim() || undefined : undefined,
        model: trajectory.model ?? undefined,
        timestamp: trajectory.createdAt,
      },
    });
  }
  return lines.map((line) => JSON.stringify(line));
}

export function exportResearchTraces(
  trajectories: AgentTrajectory[],
  options: { format: ResearchExportFormat; sanitize?: boolean }
): ResearchExport {
  const date = new Date().toISOString().slice(0, 10);
  const selected = options.sanitize ? trajectories.map(sanitizeTrajectory) : trajectories;
  const content =
    options.format === "hf_session_trace"
      ? hfSessionTraceLines(selected).join("\n")
      : selected
          .map((trajectory) => JSON.stringify(researchRecord(trajectory, options.format)))
          .join("\n");
  return {
    format: options.format,
    filename: `cybara-${options.format.replaceAll("_", "-")}-${date}.jsonl`,
    mimeType: "application/x-ndjson",
    content,
    count: selected.length,
  };
}

export function createResearchDatasetCard(
  trajectories: AgentTrajectory[],
  options: { format: ResearchExportFormat; sanitize?: boolean }
): ResearchDatasetCard {
  const summaries = summarizeResearchTraces(trajectories);
  const models = [
    ...new Set(
      trajectories
        .map((trajectory) => trajectory.model)
        .filter((model): model is string => typeof model === "string" && model.length > 0)
    ),
  ];
  const content = [
    "---",
    "task_categories:",
    "- text-generation",
    "- conversational",
    "tags:",
    "- agent-traces",
    "- tool-use",
    "- synthetic-data",
    "---",
    "",
    "# Cybara Agent Trace Dataset",
    "",
    "## Dataset summary",
    "",
    `This export contains ${trajectories.length} completed agent trace${trajectories.length === 1 ? "" : "s"} in the \`${options.format}\` format.`,
    `Stable splits: ${summaries.stats.train} train, ${summaries.stats.validation} validation, and ${summaries.stats.test} test.`,
    `Quality checks marked ${summaries.stats.cleanTraces} traces clean and observed ${summaries.stats.failedToolCalls} failed tool calls.`,
    "",
    "## Sources and provenance",
    "",
    `Teacher models: ${models.length > 0 ? models.join(", ") : "not recorded"}.`,
    "Records were captured from completed Cybara agent turns and retain provider and model provenance when available.",
    "",
    "## Intended uses",
    "",
    "- Supervised fine-tuning and sequence-level distillation",
    "- Tool-use behavior analysis",
    "- Agent regression evaluation",
    "- Long-context response research",
    "",
    "## Privacy and limitations",
    "",
    `Sensitive-content redaction was ${options.sanitize ? "enabled" : "disabled"} for this export.`,
    "Review every record before publishing because prompts and tool outputs can contain private or licensed material.",
    "Reasoning fields contain only reasoning text exposed by the provider. Hidden reasoning and teacher logits are not inferred or reconstructed.",
    "Observed tool schemas describe arguments present in captured calls and are not authoritative tool definitions.",
    "Stable train, validation, and test splits are derived from trace identifiers.",
    "",
  ].join("\n");
  return {
    filename: "README.md",
    mimeType: "text/markdown",
    content,
    count: trajectories.length,
  };
}

export function parseResearchExportFormat(value: string | undefined): ResearchExportFormat {
  if (
    value === "cybara_trace" ||
    value === "trl_sft" ||
    value === "distillation_sft" ||
    value === "hf_session_trace" ||
    value === "prompt_completion" ||
    value === "long_context"
  ) {
    return value;
  }
  return "cybara_trace";
}
