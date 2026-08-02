import { type AgentExecutionResult, type AgentMessage, agentManager } from "../core/agent";
import type { AgentToolCallResult } from "../core/agent-internals";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { isContextCompactionOnlyContent } from "../core/llm/tool-transcript";
import { stripThinkingTags } from "./chat-formatting";
import {
  buildNoUsableAssistantResponseMessage,
  buildUnsupportedAssistantClaimMessage,
  findAssistantEvidenceIssue,
  isEvidenceToolCall,
  isSuccessfulToolCall,
  requiresToolEvidenceForMessage,
  shouldRecoverNonSubstantiveAssistantCompletion,
} from "./chat-tool-summary";

type AgentExecuteOptions = NonNullable<Parameters<typeof agentManager.execute>[2]>;

const MAX_RESPONSE_RECOVERY_ATTEMPTS = 2;
const EMPTY_RECOVERY_ASSISTANT_CONTENT = "I could not complete the previous attempt.";

export interface AssistantResponseRecoveryParams {
  agentId: string;
  allowPlanOnly?: boolean;
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
  evidenceIssue: ReturnType<typeof findAssistantEvidenceIssue>,
  compactionOnly: boolean
): string {
  if (compactionOnly) {
    return "Earlier context was compacted successfully. Continue the current task from the preserved context and tool results, then give the user a substantive response. Do not repeat an internal compaction marker.";
  }
  if (evidenceIssue === "missing_clarification") {
    return "Your previous response said a question was asked, but no question was visible. Ask the actual concise question directly now, or use the clarify tool with the complete question and options. Do not say that you asked without including the question.";
  }
  if (evidenceIssue === "unfinished_execution") {
    return "Your previous response stopped after describing work you said you were executing now. Continue immediately, use the available tools to finish and verify the request, and return only after the work is complete or a concrete blocker prevents further progress.";
  }
  if (evidenceIssue === "incomplete_plan") {
    return "Your previous response claimed the task was complete while the latest todo plan still contained unfinished items. Finish the remaining work or mark only genuinely completed items complete, verify the required deliverables, and then report the accurate result.";
  }
  if (evidenceIssue === "missing_action_evidence") {
    return "Your previous response answered an actionable request without using the available tools. Use the tools now to inspect or perform the work, base every claim on the observed results, and return a concrete answer only after a real tool attempt.";
  }
  if (evidenceIssue === "plan_only") {
    return "Your previous response only proposed a plan for work the user asked you to perform. Continue immediately, use the available tools to implement and verify concrete progress, and report the actual result instead of another plan.";
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

function appendRecoveryPrompt(
  messages: AgentMessage[],
  assistantContent: string,
  instruction: string
): void {
  const lastRole = messages.at(-1)?.role;
  if (lastRole === "user") {
    messages.push({
      role: "assistant",
      content: assistantContent.trim() || EMPTY_RECOVERY_ASSISTANT_CONTENT,
    });
  } else if (lastRole !== "assistant" && assistantContent.trim()) {
    messages.push({ role: "assistant", content: assistantContent });
  }
  messages.push({ role: "user", content: instruction });
}

export async function recoverAssistantResponse(
  params: AssistantResponseRecoveryParams
): Promise<AssistantResponseRecoveryResult> {
  const initialCompactionOnly = isContextCompactionOnlyContent(params.responseContent);
  const successfulToolResults = params.toolResults.filter(isSuccessfulToolCall);
  const requireActionEvidence =
    params.toolsEnabled === true &&
    params.allowPlanOnly !== true &&
    requiresToolEvidenceForMessage(params.userMessage);
  const hasRequiredToolCall = params.requiredToolName
    ? successfulToolResults.some((toolCall) => toolCall.name === params.requiredToolName)
    : requireActionEvidence
      ? params.toolResults.some(isEvidenceToolCall)
      : successfulToolResults.length > 0;
  const shouldRecoverCompletion =
    shouldRecoverNonSubstantiveAssistantCompletion(
      params.userMessage,
      visibleAssistantContent(params.responseContent),
      successfulToolResults.length
    ) || initialCompactionOnly;
  const evidenceIssue = findAssistantEvidenceIssue(
    visibleAssistantContent(params.responseContent),
    params.toolResults,
    {
      allowPlanOnly: params.allowPlanOnly,
      requireActionEvidence,
      userMessage: params.userMessage,
    }
  );
  const shouldRetryToolExecution =
    (params.shouldRequireToolUse && (params.toolResults.length === 0 || !hasRequiredToolCall)) ||
    (params.toolsEnabled === true &&
      (evidenceIssue === "unfinished_execution" ||
        evidenceIssue === "incomplete_plan" ||
        evidenceIssue === "missing_action_evidence" ||
        evidenceIssue === "plan_only" ||
        evidenceIssue === "unsupported_completion" ||
        evidenceIssue === "unsupported_verification"));
  if (!shouldRetryToolExecution && !shouldRecoverCompletion && !evidenceIssue) {
    return {
      responseContent: params.responseContent,
      toolResults: params.toolResults,
    };
  }

  const retryMessages = [...params.executionMessages];
  let latestContent = params.responseContent;
  let latestCompactionOnly = initialCompactionOnly;
  let latestEvidenceIssue = evidenceIssue;
  let combinedToolCalls = [...params.toolResults];
  let lastError: string | undefined;

  for (let attempt = 0; attempt < MAX_RESPONSE_RECOVERY_ATTEMPTS; attempt += 1) {
    appendRecoveryPrompt(
      retryMessages,
      visibleAssistantContent(latestContent),
      buildRetryInstruction(
        shouldRetryToolExecution,
        params.requiredToolName,
        latestEvidenceIssue,
        latestCompactionOnly
      )
    );

    try {
      const retryResult = await agentManager.execute(params.agentId, retryMessages, {
        ...params.executeOptions,
        useTools: params.toolsEnabled,
        requireToolUse: shouldRetryToolExecution,
        requiredToolName: shouldRetryToolExecution ? params.requiredToolName : undefined,
      });
      latestContent = retryResult.content;
      latestCompactionOnly = isContextCompactionOnlyContent(latestContent);
      combinedToolCalls = [...combinedToolCalls, ...(retryResult.tool_calls || [])];
      const successfulCombinedToolCalls = combinedToolCalls.filter(isSuccessfulToolCall);
      const retryHasRequiredToolCall = params.requiredToolName
        ? successfulCombinedToolCalls.some((toolCall) => toolCall.name === params.requiredToolName)
        : requireActionEvidence
          ? combinedToolCalls.some(isEvidenceToolCall)
          : successfulCombinedToolCalls.length > 0;
      const retryIsSubstantive =
        !latestCompactionOnly &&
        !shouldRecoverNonSubstantiveAssistantCompletion(
          params.userMessage,
          visibleAssistantContent(latestContent),
          successfulCombinedToolCalls.length
        );
      latestEvidenceIssue = findAssistantEvidenceIssue(
        visibleAssistantContent(latestContent),
        combinedToolCalls,
        {
          allowPlanOnly: params.allowPlanOnly,
          requireActionEvidence,
          userMessage: params.userMessage,
        }
      );
      if (
        !latestEvidenceIssue &&
        ((shouldRetryToolExecution && retryHasRequiredToolCall) ||
          (!shouldRetryToolExecution && retryIsSubstantive))
      ) {
        return {
          result: retryResult,
          responseContent: latestContent,
          toolResults: combinedToolCalls,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  return {
    error: lastError,
    responseContent: latestEvidenceIssue
      ? buildUnsupportedAssistantClaimMessage(latestEvidenceIssue)
      : shouldRecoverCompletion
        ? buildNoUsableAssistantResponseMessage()
        : evidenceIssue
          ? buildUnsupportedAssistantClaimMessage(evidenceIssue)
          : latestContent,
    toolResults: combinedToolCalls,
  };
}
