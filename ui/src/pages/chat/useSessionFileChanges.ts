import { useCallback, useEffect, useMemo, useState } from "react";
import { chatApi } from "@/lib/api";
import type { LiveActivityItem } from "@/lib/chatActivities";
import { type ChatMessage, type FileChangeSummary, summarizeSessionFileChanges } from "./chatModel";

interface SessionFileChangesState {
  summary: FileChangeSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function messageRevision(messages: ChatMessage[]): string {
  const lastMessage = messages[messages.length - 1];
  const toolCallCount = messages.reduce(
    (total, message) => total + (message.tool_calls?.length ?? 0),
    0
  );
  return `${messages.length}:${toolCallCount}:${lastMessage?.timestamp ?? ""}`;
}

export function useSessionFileChanges(
  sessionId: string | null,
  messages: ChatMessage[],
  liveActivities: LiveActivityItem[],
  enabled: boolean
): SessionFileChangesState {
  const compactSummary = useMemo(
    () => summarizeSessionFileChanges(messages, liveActivities),
    [liveActivities, messages]
  );
  const [fullMessages, setFullMessages] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const revision = messageRevision(messages);

  useEffect(() => {
    setFullMessages(null);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void chatApi
      .getSession(sessionId, { includeFullToolCalls: true, signal: controller.signal })
      .then((response) => {
        if (!response.success || !response.data) {
          throw new Error(response.error || "Failed to load complete file diffs");
        }
        setFullMessages(response.data.messagesList as ChatMessage[]);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Failed to load complete file diffs");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, refreshToken, revision, sessionId]);

  const summary = useMemo(
    () =>
      fullMessages
        ? summarizeSessionFileChanges(fullMessages, liveActivities) || compactSummary
        : compactSummary,
    [compactSummary, fullMessages, liveActivities]
  );
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  return { summary, loading: loading && !fullMessages, error, refresh };
}
