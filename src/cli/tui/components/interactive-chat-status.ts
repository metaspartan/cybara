import React from "react";
import { isProviderRecoveryStatusLabel } from "../../../../shared/chat-status";
import {
  consumeTUIStatusStream,
  reconcileTUIStreamingText,
  type TUIStatusStreamEvent,
  type TUIStreamActivity,
  type TUIStreamStatus,
} from "../status-stream";

interface InteractiveChatStatusOptions {
  apiBase: string;
  apiKey?: string | null;
  gatewayPassword?: string | null;
  sessionIdRef: React.RefObject<string>;
}

interface InteractiveChatStatusState {
  liveActivities: TUIStreamActivity[];
  setLiveActivities: React.Dispatch<React.SetStateAction<TUIStreamActivity[]>>;
  setStreamDetail: React.Dispatch<React.SetStateAction<string>>;
  setStreamStatus: React.Dispatch<React.SetStateAction<TUIStreamStatus>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  streamDetail: string;
  streamingText: string;
  streamStatus: TUIStreamStatus;
  queuedTurnHandoff: { sessionId: string; pendingChatId: string; timestamp: number } | null;
}

export function useInteractiveChatStatus({
  apiBase,
  apiKey,
  gatewayPassword,
  sessionIdRef,
}: InteractiveChatStatusOptions): InteractiveChatStatusState {
  const [streamStatus, setStreamStatus] = React.useState<TUIStreamStatus>("idle");
  const [streamDetail, setStreamDetail] = React.useState("");
  const [streamingText, setStreamingText] = React.useState("");
  const [liveActivities, setLiveActivities] = React.useState<TUIStreamActivity[]>([]);
  const [queuedTurnHandoff, setQueuedTurnHandoff] = React.useState<{
    sessionId: string;
    pendingChatId: string;
    timestamp: number;
  } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    const appendStatusActivity = (event: TUIStatusStreamEvent): void => {
      const activeSessionId = sessionIdRef.current;
      if (event.type === "snapshot") {
        setStreamingText((current) => reconcileTUIStreamingText(current, event, activeSessionId));
        const active = event.activeSessions.find(
          (session) => session.sessionId === activeSessionId
        );
        if (!active) {
          setStreamStatus("idle");
          setStreamDetail("");
          setLiveActivities([]);
          return;
        }
        setStreamStatus(active.status);
        setStreamDetail(
          active.detail && !isProviderRecoveryStatusLabel(active.detail) ? active.detail : ""
        );
        setLiveActivities(active.activities || []);
        return;
      }
      if (event.sessionId !== activeSessionId) return;
      if (event.type === "assistant_token") {
        setStreamingText((current) => current + event.delta);
        return;
      }
      if (
        event.pendingChatId ||
        event.detail?.trim().toLowerCase() === "starting queued follow-up"
      ) {
        setQueuedTurnHandoff({
          sessionId: activeSessionId,
          pendingChatId: event.pendingChatId || `${activeSessionId}-${event.timestamp}`,
          timestamp: event.timestamp,
        });
      }
      setStreamStatus(event.status);
      setStreamDetail(
        event.detail && !isProviderRecoveryStatusLabel(event.detail) ? event.detail : ""
      );
      if (!event.toolPhase && !event.toolName) return;
      const phase = event.toolPhase || (event.status === "error" ? "error" : "result");
      const id = event.toolCallId || `${event.toolName || "activity"}-${event.timestamp}`;
      const activity: TUIStreamActivity = {
        id,
        phase,
        text: event.detail || event.toolName || "Tool activity",
        timestamp: event.timestamp,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
      };
      setLiveActivities((current) => [
        ...current.filter(
          (item) =>
            item.id !== id &&
            (!event.toolCallId || item.toolCallId !== event.toolCallId || item.phase === phase)
        ),
        activity,
      ]);
    };
    void consumeTUIStatusStream({
      apiBase,
      apiKey,
      gatewayPassword,
      signal: controller.signal,
      onEvent: appendStatusActivity,
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setStreamDetail(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => controller.abort();
  }, [apiBase, apiKey, gatewayPassword, sessionIdRef]);

  return {
    liveActivities,
    setLiveActivities,
    setStreamDetail,
    setStreamStatus,
    setStreamingText,
    streamDetail,
    streamingText,
    streamStatus,
    queuedTurnHandoff,
  };
}
