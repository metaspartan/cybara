import { type AgentMessage } from "../core/agent";
import {
  attributeInheritedAssistantContent,
  buildAgentHandoffInstruction,
} from "./chat-agent-handoff";
import { truncateToolResultContentForContext } from "../core/agent-context-guard";
import {
  compactChatContentForPrompt,
  TOOL_RESULT_PROMPT_MAX_CHARS,
} from "../core/chat-token-optimization";
import { hydrateImageDataFromPath } from "../core/chat/attachments";
import { getActiveGoalContextLine } from "../core/session-goals";
import type { ChatMessage } from "./chat-types";
export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
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
    const compacted = compactChatContentForPrompt(sessionMessage);
    const content = handoffInstruction
      ? attributeInheritedAssistantContent(
          { ...sessionMessage, content: compacted },
          options?.activeAgentId
        )
      : compacted;
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

    const toolRequest: AgentMessage = {
      role: "assistant",
      content: "",
      tool_calls: sessionMessage.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.args,
      })),
    };
    const toolResults: AgentMessage[] = sessionMessage.tool_calls.map((toolCall) => ({
      role: "tool",
      content: truncateToolResultContentForContext(
        toolCall.result ??
          (toolCall.error ? { error: toolCall.error } : { status: toolCall.status }),
        TOOL_RESULT_PROMPT_MAX_CHARS
      ),
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
