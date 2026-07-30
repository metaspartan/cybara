import type { AgentExecutionFailure } from "../core/agent";
import { formatLlmFailure } from "../core/agent-error-format";
import { classifyApiError } from "../core/error-classifier";
import { logSessionMessage } from "../core/logging";
import { resolveSessionModelMetadata } from "../core/session-context";
import {
  getActiveSessionRunId,
  getActiveSessionRunStartedAtMs,
} from "../core/session-event-ledger";
import { extractLatestSessionPlan } from "../core/session-plan";
import { broadcastStatus } from "../core/status";
import { INTERRUPTED_RESPONSE } from "./chat-interruption";
import { appendAssistantMessage } from "./chat-pending-state";
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
  agent: { id: string; name: string };
  failure: AgentExecutionFailure;
}): Promise<ChatResponse> {
  const { session, agent, failure } = options;
  const timestamp = new Date().toISOString();
  const timestampMs = Date.parse(timestamp);
  const modelMetadata = resolveSessionModelMetadata(agent.id);
  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: INTERRUPTED_RESPONSE,
    timestamp,
    ...(modelMetadata ?? {}),
    run_id: getActiveSessionRunId(session.id),
    worked_duration_ms: Math.max(
      0,
      timestampMs - (getActiveSessionRunStartedAtMs(session.id) ?? timestampMs)
    ),
    interrupted: true,
  };
  appendAssistantMessage(session, assistantMessage);
  await logSessionMessage(session.id, "assistant", assistantMessage.content, {
    agentId: agent.id,
    createdAt: assistantMessage.timestamp,
    metadata: {
      source: "chat_api",
      ...(modelMetadata ?? {}),
      run_id: assistantMessage.run_id,
      worked_duration_ms: assistantMessage.worked_duration_ms,
      interrupted: true,
    },
  });
  session.persisted = await persistChatSessionSnapshot(session, assistantMessage);
  broadcastStatus({
    status: "idle",
    timestamp: Date.now(),
    detail: "Idle",
    sessionId: session.id,
    agentId: agent.id,
  });
  return {
    sessionId: session.id,
    workspaceDir: session.workspaceDir ?? null,
    interrupted: true,
    failure,
    plan: extractLatestSessionPlan(session.id, session.messages),
    message: assistantMessage,
    agent,
  };
}
