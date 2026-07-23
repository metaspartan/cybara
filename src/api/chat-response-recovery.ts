import { type AgentExecutionResult, type AgentMessage, agentManager } from "../core/agent";
import type { AgentToolCallResult } from "../core/agent-internals";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { stripThinkingTags } from "./chat-formatting";
import {
  buildNoUsableAssistantResponseMessage,
  buildUnsupportedAssistantClaimMessage,
  findAssistantEvidenceIssue,
  isSuccessfulToolCall,
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
  requiredToolName: string | undefined,
  evidenceIssue: ReturnType<typeof findAssistantEvidenceIssue>
): string {
  if (evidenceIssue === "missing_clarification") {
    return "Your previous response said a question was asked, but no question was visible. Ask the actual concise question directly now, or use the clarify tool with the complete question and options. Do not say that you asked without including the question.";
  }
  if (evidenceIssue === "unsupported_completion") {
    return "Your previous response claimed work was completed without a successful tool action supporting that claim. Perform the requested work with the available tools now, verify the concrete result, and report only what the tool results establish.";
  }
  if (evidenceIssue === "unsupported_verification") {
    return "Your previous response claimed verification passed without a successful verification action supporting it. Run the relevant checks now and report their actual results. If verification cannot run, say that explicitly.";
  }
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
  const successfulToolResults = params.toolResults.filter(isSuccessfulToolCall);
  const hasRequiredToolCall = params.requiredToolName
    ? successfulToolResults.some((toolCall) => toolCall.name === params.requiredToolName)
    : successfulToolResults.length > 0;
  const shouldRecoverCompletion = shouldRecoverNonSubstantiveAssistantCompletion(
    params.userMessage,
    visibleAssistantContent(params.responseContent),
    successfulToolResults.length
  );
  const evidenceIssue = shouldRecoverCompletion
    ? undefined
    : findAssistantEvidenceIssue(
        visibleAssistantContent(params.responseContent),
        params.toolResults
      );
  const shouldRetryToolExecution =
    (params.shouldRequireToolUse && (params.toolResults.length === 0 || !hasRequiredToolCall)) ||
    (params.toolsEnabled === true &&
      (evidenceIssue === "unsupported_completion" || evidenceIssue === "unsupported_verification"));
  if (!shouldRetryToolExecution && !shouldRecoverCompletion && !evidenceIssue) {
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
    content: buildRetryInstruction(
      shouldRetryToolExecution,
      params.requiredToolName,
      evidenceIssue
    ),
  });

  try {
    const retryResult = await agentManager.execute(params.agentId, retryMessages, {
      ...params.executeOptions,
      useTools: params.toolsEnabled,
      requireToolUse: shouldRetryToolExecution,
      requiredToolName: shouldRetryToolExecution ? params.requiredToolName : undefined,
    });
    const retryToolCalls = retryResult.tool_calls || [];
    const combinedToolCalls = [...params.toolResults, ...retryToolCalls];
    const successfulCombinedToolCalls = combinedToolCalls.filter(isSuccessfulToolCall);
    const retryHasRequiredToolCall = params.requiredToolName
      ? successfulCombinedToolCalls.some((toolCall) => toolCall.name === params.requiredToolName)
      : successfulCombinedToolCalls.length > 0;
    const retryIsSubstantive = !shouldRecoverNonSubstantiveAssistantCompletion(
      params.userMessage,
      visibleAssistantContent(retryResult.content),
      successfulCombinedToolCalls.length
    );
    const retryEvidenceIssue = findAssistantEvidenceIssue(
      visibleAssistantContent(retryResult.content),
      combinedToolCalls
    );
    if (
      !retryEvidenceIssue &&
      ((shouldRetryToolExecution && retryHasRequiredToolCall) ||
        (!shouldRetryToolExecution && retryIsSubstantive))
    ) {
      return {
        result: retryResult,
        responseContent: retryResult.content,
        toolResults: combinedToolCalls,
      };
    }
    return {
      responseContent: retryEvidenceIssue
        ? buildUnsupportedAssistantClaimMessage(retryEvidenceIssue)
        : shouldRecoverCompletion
          ? buildNoUsableAssistantResponseMessage()
          : evidenceIssue
            ? buildUnsupportedAssistantClaimMessage(evidenceIssue)
            : params.responseContent,
      toolResults: params.toolResults,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      responseContent: shouldRecoverCompletion
        ? buildNoUsableAssistantResponseMessage()
        : evidenceIssue
          ? buildUnsupportedAssistantClaimMessage(evidenceIssue)
          : params.responseContent,
      toolResults: params.toolResults,
    };
  }
}
