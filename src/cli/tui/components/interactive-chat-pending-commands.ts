import type { Dispatch, SetStateAction } from "react";
import {
  isRecord,
  pendingFrom,
  resolvePendingId,
  resolvePendingIds,
  type InteractiveChatProps,
} from "../interactive-chat-data";
import type { PendingMessage } from "./interactive-chat-view";

interface PendingChatCommandInput {
  argument: string;
  command: string;
  fetchAPI: InteractiveChatProps["fetchAPI"];
  loadMessages: () => Promise<void>;
  loadPending: () => Promise<void>;
  localSessionId: string;
  modelOverride: string;
  pendingMessages: PendingMessage[];
  rest: string[];
  selectedAgentId: string;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setPendingMessages: Dispatch<SetStateAction<PendingMessage[]>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  useModelRouter: boolean;
  workspaceDir: string;
}

function pendingEndpoint(sessionId: string, pendingId: string): string {
  return `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(pendingId)}`;
}

function replacePendingMessages(
  response: unknown,
  setPendingMessages: Dispatch<SetStateAction<PendingMessage[]>>
): void {
  setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
}

export async function executePendingChatCommand(input: PendingChatCommandInput): Promise<boolean> {
  const {
    argument,
    command,
    fetchAPI,
    loadMessages,
    loadPending,
    localSessionId,
    modelOverride,
    pendingMessages,
    rest,
    selectedAgentId,
    setNotice,
    setPendingMessages,
    setSending,
    useModelRouter,
    workspaceDir,
  } = input;

  if (command === "pending") {
    await loadPending();
    setNotice("Pending queue refreshed.");
    return true;
  }
  if (command === "queue") {
    if (!localSessionId) {
      setNotice("Send the first turn before queueing follow-ups.");
      return true;
    }
    if (!argument) {
      setNotice("Usage: /queue <message>");
      return true;
    }
    const response = await fetchAPI<unknown>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: selectedAgentId || undefined,
        message: argument,
        modelOverride: useModelRouter ? undefined : modelOverride || undefined,
        queueMode: "queue",
        sessionId: localSessionId,
        useModelRouter,
        workspaceDir: workspaceDir || undefined,
      }),
    });
    replacePendingMessages(response, setPendingMessages);
    setNotice("Queued follow-up.");
    return true;
  }
  if (command === "steer") {
    const pendingId = resolvePendingId(rest[0], pendingMessages);
    if (!localSessionId || !pendingId) {
      setNotice("Usage: /steer <id|#n>");
      return true;
    }
    const response = await fetchAPI<unknown>(
      `${pendingEndpoint(localSessionId, pendingId)}/steer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );
    replacePendingMessages(response, setPendingMessages);
    await loadMessages();
    setNotice("Steered queued message.");
    return true;
  }
  if (command === "edit") {
    const pendingId = resolvePendingId(rest[0], pendingMessages);
    const content = rest.slice(1).join(" ").trim();
    if (!localSessionId || !pendingId || !content) {
      setNotice("Usage: /edit <id|#n> <message>");
      return true;
    }
    const response = await fetchAPI<unknown>(pendingEndpoint(localSessionId, pendingId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    replacePendingMessages(response, setPendingMessages);
    setNotice("Edited queued follow-up.");
    return true;
  }
  if (command === "delete") {
    const pendingId = resolvePendingId(rest[0], pendingMessages);
    if (!localSessionId || !pendingId) {
      setNotice("Usage: /delete <id|#n>");
      return true;
    }
    const response = await fetchAPI<unknown>(pendingEndpoint(localSessionId, pendingId), {
      method: "DELETE",
    });
    replacePendingMessages(response, setPendingMessages);
    setNotice("Deleted queued follow-up.");
    return true;
  }
  if (command === "reorder") {
    const pendingMessageIds = resolvePendingIds(rest, pendingMessages);
    if (!localSessionId || pendingMessageIds.length === 0) {
      setNotice("Usage: /reorder <id|#n>...");
      return true;
    }
    const response = await fetchAPI<unknown>(
      `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/reorder`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingMessageIds }),
      }
    );
    replacePendingMessages(response, setPendingMessages);
    setNotice("Reordered queued follow-ups.");
    return true;
  }
  if (command === "stop") {
    if (!localSessionId) {
      setNotice("No active session to stop.");
      return true;
    }
    await fetchAPI(`/api/chat/sessions/${encodeURIComponent(localSessionId)}/stop`, {
      method: "POST",
    });
    setSending(false);
    setNotice("Stop requested.");
    return true;
  }
  return false;
}
