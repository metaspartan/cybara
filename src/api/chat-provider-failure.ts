import type { AgentExecutionFailure } from "../core/agent";
import { formatLlmFailure } from "../core/agent-error-format";
import { classifyApiError } from "../core/error-classifier";
import { extractLatestSessionPlan } from "../core/session-plan";
import { broadcastStatus } from "../core/status";
import { persistChatSessionSnapshot, type InMemoryChatSession } from "./chat-runtime-state";
import type { ChatMessage, ChatResponse } from "./chat-types";

export function normalizeAgentExecutionFailure(error: unknown): {
  content: string;
  failure: AgentExecutionFailure;
} {
  const classified = classifyApiError({ error });
  return {
    content: classified.retryable ? "" : formatLlmFailure(error),
    failure: {
      category: classified.category,
      retryable: classified.retryable,
    },
  };
}

export async function finishRetryableProviderFailure(options: {
  session: InMemoryChatSession;
  userMessage: ChatMessage;
  agent: { id: string; name: string };
  failure: AgentExecutionFailure;
}): Promise<ChatResponse> {
  const { session, userMessage, agent, failure } = options;
  broadcastStatus({
    status: "idle",
    timestamp: Date.now(),
    detail: "Idle",
    sessionId: session.id,
    agentId: agent.id,
  });
  session.persisted = await persistChatSessionSnapshot(session, userMessage);
  return {
    sessionId: session.id,
    workspaceDir: session.workspaceDir ?? null,
    interrupted: true,
    failure,
    plan: extractLatestSessionPlan(session.id, session.messages),
    message: {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      interrupted: true,
    },
    agent,
  };
}
