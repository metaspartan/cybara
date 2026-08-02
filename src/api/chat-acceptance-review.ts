import type { AgentExecutionResult, AgentMessage } from "../core/agent";
import type { AgentToolCallResult } from "../core/agent-internals";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { stripThinkingTags } from "./chat-formatting";
import { isSuccessfulToolCall, requiresToolEvidenceForMessage } from "./chat-tool-summary";

const MUTATION_TOOLS = new Set(["apply_patch", "edit", "write"]);
const MINIMUM_SUCCESSFUL_TOOL_CALLS = 3;
const MAXIMUM_REVIEW_TOOL_CALLS = 24;
const COMPLETION_CLAIM_PATTERN =
  /\b(?:complete|completed|done|finished|fixed|implemented|created|built|updated|resolved|verified|passes|working)\b/i;
const BLOCKED_RESPONSE_PATTERN =
  /\b(?:blocked|cannot|can't|could not|couldn't|need(?:s)? (?:your|user) (?:input|approval)|requires? (?:your|user) (?:input|approval))\b/i;

interface AgentExecuteOptions {
  allowedToolNames?: string[];
  maxToolCalls?: number;
  requireToolUse?: boolean;
  useTools?: boolean;
}

export interface AcceptanceReviewCandidate {
  allowPlanOnly?: boolean;
  responseContent: string;
  toolResults: AgentToolCallResult[];
  toolsEnabled?: boolean;
  userMessage: string;
}

export interface AcceptanceReviewParams extends AcceptanceReviewCandidate {
  agentId: string;
  execute: (
    agentId: string,
    messages: AgentMessage[],
    options: AgentExecuteOptions
  ) => Promise<AgentExecutionResult>;
  executeOptions: AgentExecuteOptions;
  executionMessages: AgentMessage[];
}

export interface AcceptanceReviewResult {
  result?: AgentExecutionResult;
  responseContent: string;
  reviewed: boolean;
  toolResults: AgentToolCallResult[];
}

function visibleAssistantContent(content: string): string {
  return sanitizeAssistantContent(stripThinkingTags(content).content).trim();
}

function hasWorkspaceMutation(toolResults: AgentToolCallResult[]): boolean {
  return toolResults.some(
    (toolCall) => MUTATION_TOOLS.has(toolCall.name) && isSuccessfulToolCall(toolCall)
  );
}

export function shouldRunAcceptanceReview(candidate: AcceptanceReviewCandidate): boolean {
  if (candidate.allowPlanOnly === true || candidate.toolsEnabled !== true) return false;
  if (!requiresToolEvidenceForMessage(candidate.userMessage)) return false;
  const visibleContent = visibleAssistantContent(candidate.responseContent);
  if (!visibleContent || !COMPLETION_CLAIM_PATTERN.test(visibleContent)) return false;
  if (BLOCKED_RESPONSE_PATTERN.test(visibleContent)) return false;
  const successfulToolCalls = candidate.toolResults.filter(isSuccessfulToolCall);
  return (
    successfulToolCalls.length >= MINIMUM_SUCCESSFUL_TOOL_CALLS &&
    hasWorkspaceMutation(successfulToolCalls)
  );
}

function buildAcceptanceReviewInstruction(userMessage: string): string {
  return [
    "Perform one final acceptance review of the work before returning it to the user.",
    "Re-read the original request literally and inspect the current workspace instead of trusting the previous completion claims.",
    "Use the available tools to validate exact inputs, boundary cases, output formats, and observable side effects with an independent check or the real project test suite.",
    "If you find a concrete mismatch, fix it and rerun the relevant check. Do not redo correct work or repeat external side effects.",
    "Return the corrected final response, or a concise final response stating what you independently verified.",
    `Original request:\n${userMessage}`,
  ].join("\n\n");
}

function reviewMessages(params: AcceptanceReviewParams): AgentMessage[] {
  return [
    ...params.executionMessages,
    {
      role: "assistant",
      content: visibleAssistantContent(params.responseContent),
    },
    {
      role: "user",
      content: buildAcceptanceReviewInstruction(params.userMessage),
    },
  ];
}

function reviewToolCallLimit(options: AgentExecuteOptions): number {
  const requested = options.maxToolCalls;
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return MAXIMUM_REVIEW_TOOL_CALLS;
  }
  return Math.min(Math.floor(requested), MAXIMUM_REVIEW_TOOL_CALLS);
}

export async function reviewAssistantAcceptance(
  params: AcceptanceReviewParams
): Promise<AcceptanceReviewResult> {
  const unchanged = (): AcceptanceReviewResult => ({
    responseContent: params.responseContent,
    reviewed: false,
    toolResults: params.toolResults,
  });
  if (!shouldRunAcceptanceReview(params)) return unchanged();

  try {
    const result = await params.execute(params.agentId, reviewMessages(params), {
      ...params.executeOptions,
      maxToolCalls: reviewToolCallLimit(params.executeOptions),
      requireToolUse: true,
      useTools: true,
    });
    const content = visibleAssistantContent(result.content);
    const reviewToolResults = result.tool_calls || [];
    if (
      result.failure ||
      !content ||
      !reviewToolResults.some((toolCall) => isSuccessfulToolCall(toolCall))
    ) {
      return unchanged();
    }
    return {
      result,
      responseContent: content,
      reviewed: true,
      toolResults: [...params.toolResults, ...reviewToolResults],
    };
  } catch {
    return unchanged();
  }
}
