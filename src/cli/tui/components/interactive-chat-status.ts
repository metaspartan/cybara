import React from "react";
import {
  isDelegatedWaitStatusLabel,
  isProviderRecoveryStatusLabel,
} from "../../../../shared/chat-status";
import {
  maintainTUIStatusStream,
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
  queuedTurnHandoff: QueuedTurnHandoff | null;
}

export interface QueuedTurnHandoff {
  sessionId: string;
  pendingChatId: string;
  phase: "started" | "completed";
  timestamp: number;
}

export function reconcileQueuedTurnHandoff(
  current: QueuedTurnHandoff | null,
  event: TUIStatusStreamEvent,
  activeSessionId: string
): QueuedTurnHandoff | null {
  if (!activeSessionId) return current;
  if (event.type === "snapshot") {
    if (
      current?.sessionId === activeSessionId &&
      current.phase === "started" &&
      !event.activeSessions.some((session) => session.sessionId === activeSessionId)
    ) {
      return { ...current, phase: "completed", timestamp: event.timestamp };
    }
    return current;
  }
  if (event.type !== "status" || event.sessionId !== activeSessionId) return current;
  if (event.pendingChatId || event.detail?.trim().toLowerCase() === "starting queued follow-up") {
    return {
      sessionId: activeSessionId,
      pendingChatId: event.pendingChatId || `${activeSessionId}-${event.timestamp}`,
      phase: "started",
      timestamp: event.timestamp,
    };
  }
  if (event.status === "idle" && current?.sessionId === activeSessionId) {
    return { ...current, phase: "completed", timestamp: event.timestamp };
  }
  return current;
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
  const [queuedTurnHandoff, setQueuedTurnHandoff] = React.useState<QueuedTurnHandoff | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    const appendStatusActivity = (event: TUIStatusStreamEvent): void => {
      const activeSessionId = sessionIdRef.current;
      if (event.type === "snapshot") {
        setQueuedTurnHandoff((current) =>
          reconcileQueuedTurnHandoff(current, event, activeSessionId)
        );
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
      setQueuedTurnHandoff((current) =>
        reconcileQueuedTurnHandoff(current, event, activeSessionId)
      );
      setStreamStatus(event.status);
      setStreamDetail(
        event.detail && !isProviderRecoveryStatusLabel(event.detail) ? event.detail : ""
      );
      if (isDelegatedWaitStatusLabel(event.detail)) setStreamingText("");
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
    void maintainTUIStatusStream({
      apiBase,
      apiKey,
      gatewayPassword,
      signal: controller.signal,
      onEvent: appendStatusActivity,
      onConnectionState: (state, detail) => {
        if (state === "connected") {
          setStreamDetail("");
          return;
        }
        setStreamDetail(detail || "Reconnecting to gateway");
      },
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
