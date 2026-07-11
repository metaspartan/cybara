import { createHash } from "crypto";
import { loadPersistedSession } from "../session-context";
import { buildTrajectoryStructure } from "./structure";
import { getTrajectoryBySessionTurn, upsertTrajectory } from "./store";
import type { AgentTrajectory, EvalMessage } from "./types";

function trajectoryId(sessionId: string, turnIndex: number): string {
  const hash = createHash("sha256").update(`${sessionId}:${turnIndex}`).digest("hex").slice(0, 32);
  return `trajectory_${hash}`;
}

function userTurnIndex(messages: EvalMessage[], messageIndex: number): number {
  return (
    messages.slice(0, messageIndex + 1).filter((message) => message.role === "user").length - 1
  );
}

export function buildTrajectoryForMessage(input: {
  sessionId: string;
  agentId: string;
  messages: EvalMessage[];
  messageIndex: number;
  workspaceDir?: string | null;
  provider?: string | null;
  model?: string | null;
  includeContext?: boolean;
}): AgentTrajectory {
  const assistantIndex =
    input.messages[input.messageIndex]?.role === "assistant"
      ? input.messageIndex
      : input.messages.findIndex(
          (message, index) => index > input.messageIndex && message.role === "assistant"
        );
  if (assistantIndex < 0) throw new Error("The selected turn does not have an assistant response");
  let userIndex = assistantIndex - 1;
  while (userIndex >= 0 && input.messages[userIndex]?.role !== "user") userIndex -= 1;
  if (userIndex < 0) throw new Error("The selected assistant response has no user request");
  const response = input.messages[assistantIndex];
  const turnIndex = userTurnIndex(input.messages, userIndex);
  const requestMessages = input.messages.slice(0, userIndex + 1);
  const contextHash = createHash("sha256")
    .update(
      requestMessages.map((message) => `${message.role}\u0000${message.content}`).join("\u0001")
    )
    .digest("hex");
  return {
    id: trajectoryId(input.sessionId, turnIndex),
    sessionId: input.sessionId,
    turnIndex,
    agentId: input.agentId,
    provider: input.provider?.trim() || response.provider?.trim() || null,
    model: input.model?.trim() || response.model?.trim() || null,
    request: {
      messages: input.includeContext === false ? [] : requestMessages,
      userMessage: input.messages[userIndex],
      userMessageIndex: userIndex,
      contextMessageCount: requestMessages.length,
      contextHash,
      workspaceDir: input.workspaceDir?.trim() || null,
    },
    response,
    structure: buildTrajectoryStructure(response),
    createdAt: new Date().toISOString(),
  };
}

export function recordCompletedTrajectory(input: {
  sessionId: string;
  agentId: string;
  messages: EvalMessage[];
  workspaceDir?: string | null;
  provider?: string | null;
  model?: string | null;
}): AgentTrajectory | null {
  const assistantIndex = input.messages.findLastIndex((message) => message.role === "assistant");
  if (assistantIndex < 0) return null;
  const trajectory = buildTrajectoryForMessage({
    ...input,
    messageIndex: assistantIndex,
    includeContext: false,
  });
  return upsertTrajectory(trajectory);
}

export async function ensureSessionTrajectory(
  sessionId: string,
  messageIndex?: number
): Promise<AgentTrajectory> {
  const session = await loadPersistedSession(sessionId);
  if (!session) throw new Error("Session not found");
  const targetIndex =
    typeof messageIndex === "number" && Number.isInteger(messageIndex)
      ? messageIndex
      : session.messages.findLastIndex((message) => message.role === "assistant");
  if (targetIndex < 0 || targetIndex >= session.messages.length) {
    throw new Error("Message index is outside the session transcript");
  }
  const turnIndex = userTurnIndex(
    session.messages as EvalMessage[],
    session.messages[targetIndex]?.role === "assistant" ? targetIndex - 1 : targetIndex
  );
  const existing = getTrajectoryBySessionTurn(sessionId, turnIndex);
  if (existing?.request.messages.length) return existing;
  return upsertTrajectory(
    buildTrajectoryForMessage({
      sessionId,
      agentId: session.agentId,
      messages: session.messages as EvalMessage[],
      messageIndex: targetIndex,
      workspaceDir: session.workspaceDir,
      provider: existing?.provider,
      model: existing?.model,
      includeContext: true,
    })
  );
}
