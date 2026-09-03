import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatApi } from "@/lib/api";
import {
  connectStatusStream,
  type PendingChatMessage,
  type StatusSessionSnapshot,
  type StatusStreamEvent,
} from "@/lib/status-stream";
import {
  resolveSessionEventOrder,
  type SessionEventCursor,
} from "../../../../shared/session-event-order";
import {
  clearCachedLiveSessionState,
  readCachedLiveSessionState,
  writeCachedLiveSessionState,
} from "./liveSessionState";
import {
  MULTI_CHAT_ACTIVE_STATUSES,
  type MultiChatLiveState,
  multiChatStateFromCache,
  projectMultiChatSnapshot,
  projectMultiChatStatusEvent,
  projectMultiChatToken,
} from "./multiChatLiveStatus";
import { isRunEndingStatus } from "./sessionRunStatus";

interface UseMultiChatLiveStatusesOptions {
  sessionIds: string[];
  onRefresh: (sessionId: string, includeSessionList?: boolean) => void;
  onPendingMessages: (sessionId: string, messages?: PendingChatMessage[]) => void;
}

function snapshotIdentity(snapshot: StatusSessionSnapshot): {
  runId?: string;
  sequence?: number;
  timestamp: number;
} {
  return {
    runId: snapshot.runId,
    sequence: snapshot.sequence,
    timestamp: snapshot.timestamp,
  };
}

export function useMultiChatLiveStatuses({
  sessionIds,
  onRefresh,
  onPendingMessages,
}: UseMultiChatLiveStatusesOptions): Record<string, MultiChatLiveState> {
  const [statuses, setStatuses] = useState<Record<string, MultiChatLiveState>>({});
  const cursorsRef = useRef<Record<string, SessionEventCursor>>({});
  const sessionIdSet = useMemo(() => new Set(sessionIds), [sessionIds]);
  const sessionIdSetRef = useRef(sessionIdSet);

  useEffect(() => {
    sessionIdSetRef.current = sessionIdSet;
    setStatuses((current) => {
      const next: Record<string, MultiChatLiveState> = {};
      for (const sessionId of sessionIds) {
        const existing = current[sessionId];
        if (existing) {
          next[sessionId] = existing;
          continue;
        }
        const cached = readCachedLiveSessionState(sessionId);
        if (cached && cached.status !== "idle") {
          next[sessionId] = multiChatStateFromCache(cached);
        }
      }
      return next;
    });
  }, [sessionIdSet, sessionIds]);

  const acceptEvent = useCallback(
    (sessionId: string, identity: Parameters<typeof resolveSessionEventOrder>[1]): boolean => {
      const decision = resolveSessionEventOrder(cursorsRef.current[sessionId], identity);
      if (!decision.accepted) return false;
      cursorsRef.current[sessionId] = decision.cursor;
      return true;
    },
    []
  );

  const storeStatus = useCallback((sessionId: string, state: MultiChatLiveState | null): void => {
    setStatuses((current) => {
      if (!state) {
        if (!current[sessionId]) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      }
      return { ...current, [sessionId]: state };
    });
    if (!state) {
      clearCachedLiveSessionState(sessionId);
      return;
    }
    writeCachedLiveSessionState(sessionId, {
      status: state.liveStatus,
      activities: state.activities,
      currentStep: state.currentStep,
      streamingContent: state.streamingContent,
      runId: state.runId,
      sequence: state.sequence,
      startedAtMs: state.startedAtMs,
      updatedAt: state.observedAt,
    });
  }, []);

  const applySnapshot = useCallback(
    (snapshot: StatusSessionSnapshot, observedAt = Date.now()): void => {
      const sessionId = snapshot.sessionId.trim();
      if (!sessionId || !sessionIdSetRef.current.has(sessionId)) return;
      if (snapshot.pendingMessages) onPendingMessages(sessionId, snapshot.pendingMessages);
      if (!MULTI_CHAT_ACTIVE_STATUSES.has(snapshot.status)) return;
      if (!acceptEvent(sessionId, snapshotIdentity(snapshot))) return;
      setStatuses((current) => {
        const next = projectMultiChatSnapshot(snapshot, current[sessionId], observedAt);
        writeCachedLiveSessionState(sessionId, {
          status: next.liveStatus,
          activities: next.activities,
          currentStep: next.currentStep,
          streamingContent: next.streamingContent,
          runId: next.runId,
          sequence: next.sequence,
          startedAtMs: next.startedAtMs,
          updatedAt: next.observedAt,
        });
        return { ...current, [sessionId]: next };
      });
      onRefresh(sessionId);
    },
    [acceptEvent, onPendingMessages, onRefresh]
  );

  const hydrate = useCallback(async (): Promise<void> => {
    const requestedAt = Date.now();
    try {
      const response = await chatApi.getSessionStatus();
      if (!response.success || !response.data) return;
      const activeIds = new Set(
        (response.data.activeSessionIds || []).filter(
          (sessionId): sessionId is string => typeof sessionId === "string" && !!sessionId.trim()
        )
      );
      for (const snapshot of response.data.activeSessions || []) {
        applySnapshot(snapshot);
      }
      setStatuses((current) => {
        let changed = false;
        const next = { ...current };
        for (const [sessionId, state] of Object.entries(current)) {
          if (
            sessionIdSetRef.current.has(sessionId) &&
            !activeIds.has(sessionId) &&
            state.observedAt <= requestedAt
          ) {
            delete next[sessionId];
            clearCachedLiveSessionState(sessionId);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    } catch {
      return;
    }
  }, [applySnapshot]);

  useEffect(() => {
    void hydrate();
  }, [hydrate, sessionIdSet]);

  useEffect(() => {
    const handleEvent = (event: StatusStreamEvent): void => {
      if (event.type === "snapshot") {
        for (const snapshot of event.activeSessions) applySnapshot(snapshot);
        return;
      }
      if (event.type === "task_completed") {
        const sessionId = event.sessionId?.trim();
        if (!sessionId || !sessionIdSetRef.current.has(sessionId)) return;
        storeStatus(sessionId, null);
        onPendingMessages(sessionId);
        onRefresh(sessionId, true);
        return;
      }
      const sessionId = event.sessionId?.trim();
      if (!sessionId || !sessionIdSetRef.current.has(sessionId)) return;
      if (event.type === "session_message") {
        onRefresh(sessionId, false);
        return;
      }
      if (!acceptEvent(sessionId, event)) return;
      if (event.type === "assistant_token") {
        setStatuses((current) => {
          const previous = current[sessionId];
          const next = projectMultiChatToken(previous, event);
          writeCachedLiveSessionState(sessionId, {
            status: next.liveStatus,
            activities: next.activities,
            currentStep: next.currentStep,
            streamingContent: next.streamingContent,
            runId: next.runId,
            sequence: next.sequence,
            startedAtMs: next.startedAtMs,
            updatedAt: next.observedAt,
          });
          return { ...current, [sessionId]: next };
        });
        return;
      }
      setStatuses((current) => {
        const next = projectMultiChatStatusEvent(current[sessionId], event);
        if (!next) {
          if (!current[sessionId]) return current;
          const updated = { ...current };
          delete updated[sessionId];
          clearCachedLiveSessionState(sessionId);
          return updated;
        }
        writeCachedLiveSessionState(sessionId, {
          status: next.liveStatus,
          activities: next.activities,
          currentStep: next.currentStep,
          streamingContent: next.streamingContent,
          runId: next.runId,
          sequence: next.sequence,
          startedAtMs: next.startedAtMs,
          updatedAt: next.observedAt,
        });
        return { ...current, [sessionId]: next };
      });
      if (event.pendingChatId || event.clientPendingId || isRunEndingStatus(event)) {
        onPendingMessages(sessionId);
      }
      onRefresh(sessionId, isRunEndingStatus(event));
    };

    return connectStatusStream({
      replayBufferedSessionEvents: true,
      onOpen: () => void hydrate(),
      onEvent: handleEvent,
    });
  }, [acceptEvent, applySnapshot, hydrate, onPendingMessages, onRefresh, storeStatus]);

  return statuses;
}
