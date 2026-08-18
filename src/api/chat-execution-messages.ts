import { type AgentMessage } from "../core/agent";
import { buildAgentHandoffInstruction, stripAgentAttributionTag } from "./chat-agent-handoff";
import { truncateToolResultContentForContext } from "../core/agent-context-guard";
import {
  compactChatContentForPrompt,
  TOOL_RESULT_PROMPT_MAX_CHARS,
} from "../core/chat-token-optimization";
import { hydrateImageDataFromPath } from "../core/chat/attachments";
import { getActiveGoalContextLine } from "../core/session-goals";
import { INTERRUPTED_RESPONSE } from "./chat-interruption";
import type { ChatMessage } from "./chat-types";
export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
interface ReplayableToolCall {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
}

const toolResultPreviewCache = new WeakMap<object, string>();

function previewToolResult(toolCall: ReplayableToolCall, sessionId?: string): string {
  const cached = toolResultPreviewCache.get(toolCall);
  if (cached !== undefined) return cached;
  const preview = truncateToolResultContentForContext(
    toolCall.result ?? { error: toolCall.error },
    TOOL_RESULT_PROMPT_MAX_CHARS,
    sessionId ? { sessionId, toolName: toolCall.name, toolCallId: toolCall.id } : undefined
  );
  toolResultPreviewCache.set(toolCall, preview);
  return preview;
}

export function buildChatExecutionMessagesForAgent(
  sessionMessages: ChatMessage[],
  options?: {
    sessionId?: string;
    materializedSteeringTurn?: boolean;
    supportsImages?: boolean;
    activeAgentId?: string;
  }
): AgentMessage[] {
  const supportsImages = options?.supportsImages !== false;
  const latestUserIndex = sessionMessages.findLastIndex((message) => message.role === "user");
  const previousUserIndex = sessionMessages.findLastIndex(
    (message, index) => message.role === "user" && index < latestUserIndex
  );
  const executionSource =
    options?.materializedSteeringTurn &&
    previousUserIndex >= 0 &&
    latestUserIndex > previousUserIndex
      ? [...sessionMessages.slice(0, previousUserIndex), ...sessionMessages.slice(latestUserIndex)]
      : sessionMessages;
  const latestTransfer = sessionMessages
    .flatMap((sessionMessage) => sessionMessage.agent_transfers || [])
    .findLast((transfer) => transfer.toAgentId === options?.activeAgentId);
  const handoffInstruction = latestTransfer
    ? undefined
    : buildAgentHandoffInstruction(sessionMessages, options?.activeAgentId);
  const executionMessages: AgentMessage[] = executionSource.flatMap((sessionMessage) => {
    if (
      sessionMessage.role === "assistant" &&
      sessionMessage.interrupted === true &&
      !sessionMessage.tool_calls?.length &&
      sessionMessage.content === INTERRUPTED_RESPONSE
    ) {
      return [];
    }
    const compacted = compactChatContentForPrompt(sessionMessage);
    const content =
      sessionMessage.role === "assistant" ? stripAgentAttributionTag(compacted) : compacted;
    const imageContext = sessionMessage.image_context?.trim();
    const message: AgentMessage = {
      role: sessionMessage.role,
      content:
        !supportsImages && sessionMessage.images?.length
          ? `${content}\n\n${
              imageContext
                ? `[Attached image analysis]\n${imageContext}`
                : "[Attached image unavailable to this text-only model]"
            }`
          : content,
      ...(supportsImages && sessionMessage.images
        ? { images: sessionMessage.images.map(hydrateImageDataFromPath) }
        : {}),
    };

    if (sessionMessage.role !== "assistant" || !sessionMessage.tool_calls?.length) {
      return [message];
    }

    const replayableToolCalls = sessionMessage.tool_calls.filter(
      (toolCall) => toolCall.result !== undefined || Boolean(toolCall.error)
    );
    if (replayableToolCalls.length === 0) {
      return message.content.trim() || message.images?.length ? [message] : [];
    }

    const toolRequest: AgentMessage = {
      role: "assistant",
      content: "",
      tool_calls: replayableToolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.args,
      })),
    };
    const toolResults: AgentMessage[] = replayableToolCalls.map((toolCall) => ({
      role: "tool",
      content: previewToolResult(toolCall, options?.sessionId),
      tool_call_id: toolCall.id,
    }));
    return message.content.trim()
      ? [toolRequest, ...toolResults, message]
      : [toolRequest, ...toolResults];
  });

  if (latestTransfer) {
    const transferInstruction: AgentMessage = {
      role: "system",
      content: `The session transfer from ${latestTransfer.fromAgentName} to ${latestTransfer.toAgentName} is complete. You are ${latestTransfer.toAgentName}, the current active agent. Continue with the shared conversation and do not deny or simulate the completed transfer.`,
    };
    if (executionMessages[0]?.role === "system") {
      executionMessages.splice(1, 0, transferInstruction);
    } else {
      executionMessages.unshift(transferInstruction);
    }
  } else {
    if (handoffInstruction) {
      const handoffMessage: AgentMessage = { role: "system", content: handoffInstruction };
      if (executionMessages[0]?.role === "system") {
        executionMessages.splice(1, 0, handoffMessage);
      } else {
        executionMessages.unshift(handoffMessage);
      }
    }
  }

  const activeGoalLine = options?.sessionId ? getActiveGoalContextLine(options.sessionId) : null;
  if (activeGoalLine) {
    const goalInstruction: AgentMessage = {
      role: "system",
      content: activeGoalLine,
    };
    if (executionMessages[0]?.role === "system") {
      executionMessages.splice(1, 0, goalInstruction);
    } else {
      executionMessages.unshift(goalInstruction);
    }
  }

  if (options?.materializedSteeringTurn) {
    const steeringInstruction: AgentMessage = {
      role: "system",
      content:
        "The previous assistant turn was interrupted by user steering. Treat the latest user message as the active instruction. Do not continue abandoned earlier work unless the latest user message explicitly asks for it.",
    };
    if (executionMessages[0]?.role === "system") {
      executionMessages.splice(1, 0, steeringInstruction);
    } else {
      executionMessages.unshift(steeringInstruction);
    }
  }

  return executionMessages;
}
