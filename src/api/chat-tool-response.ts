import { agentManager, type AgentExecutionFailure, type AgentMessage } from "../core/agent";
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
  sessionId: string;
  toolResults: ToolResponseResult[];
  useModelRouter?: boolean;
  userId?: string;
  workspaceDir?: string;
}

export async function resolveToolResponseContent(
  options: ResolveToolResponseOptions
): Promise<string> {
  if (options.responseContent.trim()) return options.responseContent;
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
  ].join("\n\n");
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
        useTools: false,
      }
    );
    return result.failure || !result.content.trim() ? fallback : result.content;
  } catch {
    return fallback;
  }
}
