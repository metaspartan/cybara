import { type AgentExecutionResult, type AgentMessage, agentManager } from "../core/agent";
import type { AgentToolCallResult } from "../core/agent-internals";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { stripThinkingTags } from "./chat-formatting";
import {
  buildNoUsableAssistantResponseMessage,
  shouldRecoverNonSubstantiveAssistantCompletion,
} from "./chat-tool-summary";

type AgentExecuteOptions = NonNullable<Parameters<typeof agentManager.execute>[2]>;

export interface AssistantResponseRecoveryParams {
  agentId: string;
  executeOptions: Omit<AgentExecuteOptions, "requireToolUse" | "requiredToolName" | "useTools">;
  executionMessages: AgentMessage[];
  requiredToolName?: string;
  responseContent: string;
  shouldRequireToolUse: boolean;
  toolResults: AgentToolCallResult[];
  toolsEnabled?: boolean;
  userMessage: string;
}

export interface AssistantResponseRecoveryResult {
  error?: string;
  result?: AgentExecutionResult;
  responseContent: string;
  toolResults: AgentToolCallResult[];
}

function visibleAssistantContent(content: string): string {
  return sanitizeAssistantContent(stripThinkingTags(content).content);
}

function buildRetryInstruction(
  shouldRetryToolExecution: boolean,
  requiredToolName: string | undefined
): string {
  if (!shouldRetryToolExecution) {
    return "Your previous response was empty or only claimed completion without evidence. Re-read the conversation and answer the user's actual request with concrete results. Use available tools when the request requires action. Do not reply with only a completion claim.";
  }
  if (requiredToolName) {
    return `Your previous response did not execute the request. Re-read the conversation, use the \`${requiredToolName}\` tool now, verify the result, and then give a concrete user-facing summary.`;
  }
  return "Your previous response did not execute the request. Re-read the conversation, perform concrete tool calls now, verify the result, and then give a user-facing summary. Do not reply with only a completion claim.";
}

export async function recoverAssistantResponse(
  params: AssistantResponseRecoveryParams
): Promise<AssistantResponseRecoveryResult> {
  const hasRequiredToolCall = params.requiredToolName
    ? params.toolResults.some((toolCall) => toolCall.name === params.requiredToolName)
    : params.toolResults.length > 0;
  const shouldRecoverCompletion = shouldRecoverNonSubstantiveAssistantCompletion(
    params.userMessage,
    visibleAssistantContent(params.responseContent),
    params.toolResults.length
  );
  const shouldRetryToolExecution =
    params.shouldRequireToolUse && (params.toolResults.length === 0 || !hasRequiredToolCall);
  if (!shouldRetryToolExecution && !shouldRecoverCompletion) {
    return {
      responseContent: params.responseContent,
      toolResults: params.toolResults,
    };
  }

  const retryMessages = [...params.executionMessages];
  if (params.responseContent.trim()) {
    retryMessages.push({ role: "assistant", content: params.responseContent });
  }
  retryMessages.push({
    role: "user",
    content: buildRetryInstruction(shouldRetryToolExecution, params.requiredToolName),
  });

  try {
    const retryResult = await agentManager.execute(params.agentId, retryMessages, {
      ...params.executeOptions,
      useTools: params.toolsEnabled,
      requireToolUse: shouldRetryToolExecution,
      requiredToolName: shouldRetryToolExecution ? params.requiredToolName : undefined,
    });
    const retryToolCalls = retryResult.tool_calls || [];
    const retryIsSubstantive = !shouldRecoverNonSubstantiveAssistantCompletion(
      params.userMessage,
      visibleAssistantContent(retryResult.content),
      retryToolCalls.length
    );
    if (retryToolCalls.length > 0 || (!shouldRetryToolExecution && retryIsSubstantive)) {
      return {
        result: retryResult,
        responseContent: retryResult.content,
        toolResults: [...params.toolResults, ...retryToolCalls],
      };
    }
    return {
      responseContent: shouldRecoverCompletion
        ? buildNoUsableAssistantResponseMessage()
        : params.responseContent,
      toolResults: params.toolResults,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      responseContent: shouldRecoverCompletion
        ? buildNoUsableAssistantResponseMessage()
        : params.responseContent,
      toolResults: params.toolResults,
    };
  }
}
