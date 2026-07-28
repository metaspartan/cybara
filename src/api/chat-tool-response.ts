import { agentManager } from "../core/agent";
import { formatToolResultPromptBlock } from "../core/chat-token-optimization";
import { config } from "../core/config";
import { providerManager } from "../core/providers";
import { buildToolExecutionFallbackMessage } from "./chat-tool-summary";

interface ToolResponseResult {
  id?: string;
  name: string;
  result: unknown;
}

interface ResolveToolResponseOptions {
  abortSignal: AbortSignal;
  agentId: string;
  channel?: string;
  maxOutputTokens?: number;
  message: string;
  model?: string;
  modelParamsOverride?: Record<string, unknown>;
  providerId?: string;
  responseContent: string;
  sessionId: string;
  toolResults: ToolResponseResult[];
  userId?: string;
  workspaceDir?: string;
}

export async function resolveToolResponseContent(
  options: ResolveToolResponseOptions
): Promise<string> {
  if (options.responseContent.trim()) return options.responseContent;
  const fallback = buildToolExecutionFallbackMessage(options.toolResults);
  if (!options.providerId) return fallback;
  const provider = providerManager.getWithCredentials(options.providerId);
  if (!provider) return fallback;
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
  try {
    const result = await agentManager.callLLM(
      provider,
      options.model,
      [
        {
          role: "user",
          content: `The user asked: "${options.message}"\n\nTools completed:\n${toolResultsText}\n\nAnswer the user from these results. Do not call tools.`,
        },
      ],
      [],
      {
        agentId: options.agentId,
        sessionId: options.sessionId,
        channel: options.channel,
        userId: options.userId,
        workspaceDir: options.workspaceDir,
        abortSignal: options.abortSignal,
        maxOutputTokens: options.maxOutputTokens,
        modelParamsOverride: options.modelParamsOverride,
      }
    );
    return result.content || fallback;
  } catch {
    return fallback;
  }
}
