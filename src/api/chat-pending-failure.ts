import { formatLlmFailure } from "../core/agent-error-format";
import { upsertPersistedSessionMessage } from "../core/session-context";
import { findMaterializedPendingMessage, removePendingChatQueueItem } from "./chat-pending-state";
import {
  type InMemoryChatSession,
  persistActiveSessionContext,
  persistChatSessionSnapshot,
  type PendingChatItem,
} from "./chat-runtime-state";
import type { ChatMessage } from "./chat-types";

export async function settlePendingChatFailure(
  session: InMemoryChatSession,
  item: PendingChatItem,
  error: unknown
): Promise<unknown | undefined> {
  const pendingMessage = findMaterializedPendingMessage(session, item.id);
  const pendingIndex = pendingMessage ? session.messages.indexOf(pendingMessage) : -1;
  const timestamp = new Date(
    Math.max(Date.now(), Date.parse(pendingMessage?.timestamp || "") + 1 || 0)
  ).toISOString();
  const failureMessage: ChatMessage = {
    role: "assistant",
    content: formatLlmFailure(error),
    timestamp,
  };
  await upsertPersistedSessionMessage(session.id, session.agentId, failureMessage, {
    stableKey: `queued-failure:${item.id}`,
    metadata: { source: "chat_queue_failure" },
  });
  if (pendingIndex >= 0) session.messages.splice(pendingIndex + 1, 0, failureMessage);
  else session.messages.push(failureMessage);
  session.updatedAt = timestamp;
  await persistChatSessionSnapshot(session, failureMessage);
  persistActiveSessionContext(session);
  try {
    removePendingChatQueueItem(session.id, item.id);
    return undefined;
  } catch (cleanupError) {
    return cleanupError;
  }
}
