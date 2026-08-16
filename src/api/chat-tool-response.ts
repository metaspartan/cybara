import { agentManager, type AgentExecutionFailure, type AgentMessage } from "../core/agent";
import type { AgentToolCallResult } from "../core/agent-internals";
import { formatToolResultPromptBlock } from "../core/chat-token-optimization";
import { config } from "../core/config";
import { INTERRUPTED_RESPONSE } from "./chat-interruption";
import { buildNoUsableAssistantResponseMessage } from "./chat-tool-summary";

interface ToolResponseResult {
  id?: string;
  name: string;
  result: unknown;
}

interface ResolveToolResponseOptions {
  abortSignal: AbortSignal;
  agentId: string;
  channel?: string;
  executionFailure?: AgentExecutionFailure;
  executionMessages: AgentMessage[];
  maxOutputTokens?: number;
  message: string;
  modelOverride?: string;
  modelParamsOverride?: Record<string, unknown>;
  responseContent: string;
  reconcileTodo?: boolean;
  sessionId: string;
  toolResults: ToolResponseResult[];
  useModelRouter?: boolean;
  userId?: string;
  workspaceDir?: string;
}

export interface ResolvedToolResponse {
  responseContent: string;
  toolResults: AgentToolCallResult[];
}

function hasIncompleteTodo(toolResults: ToolResponseResult[]): boolean {
  const latestTodo = [...toolResults].reverse().find((toolCall) => toolCall.name === "todo");
  if (!latestTodo?.result || typeof latestTodo.result !== "object") return false;
  const items = (latestTodo.result as { items?: unknown }).items;
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const status = (item as { status?: unknown }).status;
    return status === "pending" || status === "in_progress";
  });
}

export async function resolveToolResponseContent(
  options: ResolveToolResponseOptions
): Promise<ResolvedToolResponse> {
  if (options.responseContent.trim()) {
    return { responseContent: options.responseContent, toolResults: [] };
  }
  const fallback = options.executionFailure
    ? INTERRUPTED_RESPONSE
    : buildNoUsableAssistantResponseMessage();
  const toonEnabled = config.getTokenOptimizationSettings().toonStructuredDataEnabled;
  const toolResultsText = options.toolResults
    .map((toolCall) =>
      formatToolResultPromptBlock(toolCall.name, toolCall.result, {
        toonEnabled,
        sessionId: options.sessionId,
        toolCallId: toolCall.id,
      })
    )
    .join("\n\n");
  const synthesisInstruction = [
    "Write the final user-facing response for the latest request using the observed tool results below.",
    "Do not call tools, mention internal tool counts, or claim anything the results do not establish.",
    options.executionFailure
      ? "The original execution was interrupted, so report verified progress and clearly identify anything that remains unfinished."
      : "Answer directly and concisely with the verified result.",
    `Latest request: ${options.message}`,
    `Observed tool results:\n${toolResultsText}`,
    options.reconcileTodo && hasIncompleteTodo(options.toolResults)
      ? "Use the todo tool once to reconcile the full plan with the completed delegated results before answering. Mark only work established by the results as completed and preserve genuinely unfinished work."
      : "",
  ].join("\n\n");
  const shouldReconcileTodo =
    options.reconcileTodo === true && hasIncompleteTodo(options.toolResults);
  try {
    const result = await agentManager.execute(
      options.agentId,
      [...options.executionMessages, { role: "user", content: synthesisInstruction }],
      {
        sessionId: options.sessionId,
        channel: options.channel,
        userId: options.userId,
        workspaceDir: options.workspaceDir,
        abortSignal: options.abortSignal,
        maxOutputTokens: options.maxOutputTokens,
        modelOverride: options.modelOverride,
        modelParamsOverride: options.modelParamsOverride,
        useModelRouter: options.useModelRouter,
        useMemory: false,
        useTools: shouldReconcileTodo,
        allowedToolNames: shouldReconcileTodo ? ["todo"] : undefined,
        requireToolUse: shouldReconcileTodo,
        requiredToolName: shouldReconcileTodo ? "todo" : undefined,
      }
    );
    return {
      responseContent: result.failure || !result.content.trim() ? fallback : result.content,
      toolResults: result.tool_calls || [],
    };
  } catch {
    return { responseContent: fallback, toolResults: [] };
  }
}
