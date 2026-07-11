import { normalizeSessionTitle } from "../session-title";
import {
  loadPersistedSession,
  persistSession,
  upsertPersistedSessionMessage,
} from "../session-context";
import type { EvalMessage } from "./types";

export interface SessionForkResult {
  sessionId: string;
  sourceSessionId: string;
  agentId: string;
  messageCount: number;
  workspaceDir: string | null;
  title: string | null;
}

export async function forkSessionFromMessages(input: {
  sourceSessionId: string;
  messages: EvalMessage[];
  workspaceDir?: string | null;
  agentId: string;
  title?: string;
}): Promise<SessionForkResult> {
  const sessionId = crypto.randomUUID();
  const title = normalizeSessionTitle(input.title) || "Forked chat";
  const messages = input.messages;
  const persisted = await persistSession(
    sessionId,
    input.agentId,
    messages,
    input.workspaceDir,
    title
  );
  if (!persisted) throw new Error("Failed to persist forked session");
  for (const [index, message] of messages.entries()) {
    if (message.role === "system") continue;
    await upsertPersistedSessionMessage(sessionId, input.agentId, message, {
      stableKey: `fork:${input.sourceSessionId}:${index}`,
      createdAtOffsetMs: index,
      metadata: {
        source: "session_fork",
        source_session_id: input.sourceSessionId,
        source_message_index: index,
      },
    });
  }
  return {
    sessionId,
    sourceSessionId: input.sourceSessionId,
    agentId: input.agentId,
    messageCount: messages.length,
    workspaceDir: input.workspaceDir?.trim() || null,
    title,
  };
}

export async function forkSession(input: {
  sourceSessionId: string;
  throughMessageIndex?: number;
  agentId?: string;
  title?: string;
}): Promise<SessionForkResult> {
  const source = await loadPersistedSession(input.sourceSessionId);
  if (!source) throw new Error("Source session not found");
  const lastIndex = source.messages.length - 1;
  const through =
    typeof input.throughMessageIndex === "number" && Number.isInteger(input.throughMessageIndex)
      ? Math.max(-1, Math.min(lastIndex, input.throughMessageIndex))
      : lastIndex;
  const messages = source.messages.slice(0, through + 1);
  const agentId = input.agentId?.trim() || source.agentId;
  const title =
    normalizeSessionTitle(input.title) ||
    normalizeSessionTitle(source.title ? `${source.title} fork` : "Forked chat");
  return forkSessionFromMessages({
    sourceSessionId: input.sourceSessionId,
    messages,
    workspaceDir: source.workspaceDir,
    agentId,
    title: title ?? undefined,
  });
}
