import type { LoadedChatSession } from "@/hooks/useChat";
import { chatApi } from "@/lib/api";
import type { LiveActivityItem } from "@/lib/chatActivities";
import { mergeActivityLists } from "@/lib/chatActivities";
import { loadPersistedCompletion } from "@/lib/chatCompletion";
import {
  connectStatusStream,
  type PendingChatMessage,
  type StatusSessionSnapshot,
  type StatusStreamStatusEvent,
  type StatusStreamTokenEvent,
} from "@/lib/status-stream";
import type { SessionContextUsage, SessionTokenUsage } from "@/types";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { SessionEventIdentity } from "../../../../shared/session-event-order";
import {
  applyLiveActivityEvent,
  type ChatMessage,
  formatToolIntent,
  getLatestInFlightStep,
  isGenericStatusLabel,
  isMeaningfulThoughtDetail,
  isSessionStatusSnapshotCurrent,
  normalizeSessionStatus,
  normalizeSnapshotActivities,
  pruneCanonicalizedLiveActivities,
  resolveStatusSnapshotActivities,
  type SessionStatusResponse,
  type SessionStatusSnapshot,
  toLiveActivityItems,
} from "./chatModel";
import {
  clearCachedLiveSessionState,
  readCachedLiveSessionState,
  resolveLiveSessionStartedAtMs,
  writeCachedLiveSessionState,
} from "./liveSessionState";
import { writeCachedSessionMessages } from "./messageCache";
import {
  clearCachedOptimisticPendingMessages,
  readCachedOptimisticPendingMessages,
  writeCachedOptimisticPendingMessages,
} from "./pendingQueueCache";
import { materializedPendingChatIds, mergePendingChatMessages } from "./pendingQueueState";

type LiveStatusSnapshotLike = StatusSessionSnapshot | SessionStatusSnapshot;
type LiveStatus = "thinking" | "generating" | "compacting" | "idle";

interface UseChatLiveSessionRuntimeOptions {
  sessionId: string | null;
  typedMessages: ChatMessage[];
  isLoading: boolean;
  currentSessionIsWorking: boolean;
  activeSessionIds: string[];
  setActiveSessionIds: Dispatch<SetStateAction<string[]>>;
  liveStatus: LiveStatus;
  setLiveStatus: Dispatch<SetStateAction<LiveStatus>>;
  liveActivities: LiveActivityItem[];
  setLiveActivities: Dispatch<SetStateAction<LiveActivityItem[]>>;
  liveCurrentStep: string | null;
  setLiveCurrentStep: Dispatch<SetStateAction<string | null>>;
  streamingContent: string | null;
  setStreamingContent: Dispatch<SetStateAction<string | null>>;
  liveRunStartedAtMs: number | null;
  setLiveRunStartedAtMs: Dispatch<SetStateAction<number | null>>;
  pendingMessages: PendingChatMessage[];
  setPendingMessages: Dispatch<SetStateAction<PendingChatMessage[]>>;
  setSessionContextUsage: Dispatch<SetStateAction<SessionContextUsage | null>>;
  setSessionTokenUsage: Dispatch<SetStateAction<SessionTokenUsage | null>>;
  setTimeToFirstTokenMs: Dispatch<SetStateAction<number | null>>;
  ttftStartRef: RefObject<number | null>;
  activeSessionRef: RefObject<string | null>;
  loadingRef: RefObject<boolean>;
  acceptEventsUntilRef: RefObject<number>;
  runStartSyncedSessionsRef: RefObject<Set<string>>;
  runActivityBufferRef: RefObject<LiveActivityItem[]>;
  liveActivitiesRef: RefObject<LiveActivityItem[]>;
  liveRunStartedAtMsRef: RefObject<number | null>;
  latestStatusTimestampBySessionRef: RefObject<Record<string, number>>;
  latestRunIdBySessionRef: RefObject<Record<string, string>>;
  eventCursorBySessionRef: RefObject<
    Record<string, { runId: string | null; sequence: number; timestamp: number }>
  >;
  refreshSessionMessagesRef: RefObject<(sessionId: string) => Promise<boolean>>;
  isSessionStopSuppressed: (sessionId?: string | null, runId?: string | null) => boolean;
  acceptSessionEvent: (
    sessionId: string | null | undefined,
    identity: SessionEventIdentity
  ) => boolean;
  loadFreshSession: (sessionId: string) => Promise<LoadedChatSession>;
  loadSession: (
    sessionId: string,
    messages: ChatMessage[],
    workspaceDir?: string | null,
    preserveReferenceTail?: boolean
  ) => void;
}

export function useChatLiveSessionRuntime({
  sessionId,
  typedMessages,
  isLoading,
  currentSessionIsWorking,
  activeSessionIds,
  setActiveSessionIds,
  liveStatus,
  setLiveStatus,
  liveActivities,
  setLiveActivities,
  liveCurrentStep,
  setLiveCurrentStep,
  streamingContent,
  setStreamingContent,
  liveRunStartedAtMs,
  setLiveRunStartedAtMs,
  pendingMessages,
  setPendingMessages,
  setSessionContextUsage,
  setSessionTokenUsage,
  setTimeToFirstTokenMs,
  ttftStartRef,
  activeSessionRef,
  loadingRef,
  acceptEventsUntilRef,
  runStartSyncedSessionsRef,
  runActivityBufferRef,
  liveActivitiesRef,
  liveRunStartedAtMsRef,
  latestStatusTimestampBySessionRef,
  latestRunIdBySessionRef,
  eventCursorBySessionRef,
  refreshSessionMessagesRef,
  isSessionStopSuppressed,
  acceptSessionEvent,
  loadFreshSession,
  loadSession,
}: UseChatLiveSessionRuntimeOptions): {
  hydrateSessionStatus: (targetSessionId?: string | null) => Promise<void>;
} {
  const typedMessagesRef = useRef(typedMessages);
  const currentSessionIsWorkingRef = useRef(currentSessionIsWorking);

  useEffect(() => {
    typedMessagesRef.current = typedMessages;
    currentSessionIsWorkingRef.current = currentSessionIsWorking;
  }, [currentSessionIsWorking, typedMessages]);

  const markFirstTokenLatency = useCallback((forSessionId?: string | null) => {
    if (ttftStartRef.current === null) return;
    if (forSessionId && activeSessionRef.current && forSessionId !== activeSessionRef.current) {
      return;
    }
    const elapsed = Math.round(performance.now() - ttftStartRef.current);
    ttftStartRef.current = null;
    setTimeToFirstTokenMs(elapsed);
  }, []);

  const appendLiveActivity = useCallback(
    (
      phase: "start" | "result" | "error" | "blocked",
      text: string,
      toolName?: string,
      eventTimestamp?: number,
      toolCallId?: string,
      sandboxProvider?: string
    ) => {
      const applyEvent = (previous: LiveActivityItem[]): LiveActivityItem[] =>
        applyLiveActivityEvent(previous, {
          phase,
          text,
          timestamp: eventTimestamp,
          toolName,
          toolCallId,
          sandboxProvider,
        });

      runActivityBufferRef.current = applyEvent(runActivityBufferRef.current);
      setLiveActivities((previous) => applyEvent(previous));
    },
    []
  );

  const snapshotLatestTimestamp = useCallback((snapshot: LiveStatusSnapshotLike): number => {
    let latest =
      typeof snapshot.timestamp === "number" && Number.isFinite(snapshot.timestamp)
        ? snapshot.timestamp
        : 0;
    if (Array.isArray(snapshot.activities)) {
      for (const activity of snapshot.activities) {
        if (
          activity &&
          typeof activity.timestamp === "number" &&
          Number.isFinite(activity.timestamp) &&
          activity.timestamp > latest
        ) {
          latest = activity.timestamp;
        }
      }
    }
    return latest;
  }, []);

  const resolveSnapshotLiveState = useCallback(
    (snapshot: LiveStatusSnapshotLike, localActivities: LiveActivityItem[]) => {
      const normalizedStatus = normalizeSessionStatus(snapshot.status);
      const snapshotActivities = normalizeSnapshotActivities(
        mergeActivityLists([], toLiveActivityItems(snapshot.activities)),
        snapshot.status
      );
      const activities = resolveStatusSnapshotActivities(
        snapshotActivities,
        localActivities,
        normalizedStatus
      );
      const activeStep = getLatestInFlightStep(activities);
      let currentStep: string | null = null;
      if (activeStep && !isGenericStatusLabel(activeStep)) {
        currentStep = activeStep;
      } else {
        const detail = typeof snapshot.detail === "string" ? snapshot.detail.trim() : "";
        if (isMeaningfulThoughtDetail(detail)) {
          currentStep = detail;
        } else if (normalizedStatus === "generating") {
          currentStep = "Generating response...";
        } else if (normalizedStatus === "compacting") {
          currentStep = "Compacting earlier context...";
        } else if (normalizedStatus === "thinking") {
          currentStep = "Thinking...";
        }
      }
      return { status: normalizedStatus, activities, currentStep };
    },
    []
  );

  const cacheLiveStatusSnapshot = useCallback(
    (snapshot: LiveStatusSnapshotLike) => {
      const snapshotSessionId =
        typeof snapshot.sessionId === "string" && snapshot.sessionId.trim()
          ? snapshot.sessionId.trim()
          : null;
      if (!snapshotSessionId) return false;
      const snapshotStatus = typeof snapshot.status === "string" ? snapshot.status : "";
      if (
        isSessionStopSuppressed(snapshotSessionId, snapshot.runId) &&
        snapshotStatus !== "idle" &&
        snapshotStatus !== "error"
      ) {
        return false;
      }
      const latestTimestamp = snapshotLatestTimestamp(snapshot);
      if (
        !acceptSessionEvent(snapshotSessionId, {
          runId: snapshot.runId,
          sequence: snapshot.sequence,
          timestamp: latestTimestamp,
        })
      ) {
        return false;
      }
      const cached = readCachedLiveSessionState(snapshotSessionId);
      const localActivities = cached?.activities || [];
      const next = resolveSnapshotLiveState(snapshot, localActivities);
      const startedAtMs = cached?.startedAtMs ?? resolveLiveSessionStartedAtMs(snapshot);
      if (latestTimestamp > 0) {
        const previousTimestamp = latestStatusTimestampBySessionRef.current[snapshotSessionId] || 0;
        if (latestTimestamp > previousTimestamp) {
          latestStatusTimestampBySessionRef.current[snapshotSessionId] = latestTimestamp;
        }
      }
      writeCachedLiveSessionState(snapshotSessionId, {
        status: next.status,
        activities: next.activities,
        currentStep: next.currentStep,
        streamingContent: cached?.streamingContent ?? null,
        runId: eventCursorBySessionRef.current[snapshotSessionId]?.runId ?? null,
        sequence:
          eventCursorBySessionRef.current[snapshotSessionId]?.sequence ?? cached?.sequence ?? 0,
        startedAtMs,
      });
      if (
        activeSessionRef.current === snapshotSessionId &&
        (liveRunStartedAtMsRef.current === null || startedAtMs < liveRunStartedAtMsRef.current)
      ) {
        liveRunStartedAtMsRef.current = startedAtMs;
        setLiveRunStartedAtMs(startedAtMs);
      }
      return true;
    },
    [acceptSessionEvent, isSessionStopSuppressed, resolveSnapshotLiveState, snapshotLatestTimestamp]
  );

  const cacheAssistantToken = useCallback(
    (payload: StatusStreamTokenEvent) => {
      const tokenSessionId =
        typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : null;
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!tokenSessionId || !delta) return false;
      if (isSessionStopSuppressed(tokenSessionId, payload.runId)) return false;
      if (
        !acceptSessionEvent(tokenSessionId, {
          runId: payload.runId,
          sequence: payload.sequence,
          timestamp: payload.timestamp,
        })
      ) {
        return false;
      }
      markFirstTokenLatency(tokenSessionId);
      const cached = readCachedLiveSessionState(tokenSessionId);
      writeCachedLiveSessionState(tokenSessionId, {
        status: "generating",
        activities: cached?.activities || [],
        currentStep: cached?.currentStep || "Generating response...",
        streamingContent: `${cached?.streamingContent || ""}${delta}`,
        runId: eventCursorBySessionRef.current[tokenSessionId]?.runId ?? null,
        sequence:
          eventCursorBySessionRef.current[tokenSessionId]?.sequence ?? cached?.sequence ?? 0,
        startedAtMs: cached?.startedAtMs ?? (payload.timestamp || Date.now()),
      });
      return true;
    },
    [acceptSessionEvent, isSessionStopSuppressed, markFirstTokenLatency]
  );

  const cacheLiveStatusEvent = useCallback(
    (payload: StatusStreamStatusEvent) => {
      const payloadSessionId =
        typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : null;
      if (!payloadSessionId) return false;
      const status = typeof payload.status === "string" ? payload.status : "";
      if (!status) return false;
      if (
        isSessionStopSuppressed(payloadSessionId, payload.runId) &&
        status !== "idle" &&
        status !== "error"
      ) {
        return false;
      }
      if (
        !acceptSessionEvent(payloadSessionId, {
          runId: payload.runId,
          sequence: payload.sequence,
          timestamp: payload.timestamp,
        })
      ) {
        return false;
      }
      const statusDetail = typeof payload.detail === "string" ? payload.detail.trim() : "";
      const isSteeringHandoff =
        status === "idle" && statusDetail.toLowerCase() === "steering to follow-up...";
      if (status === "error") {
        clearCachedLiveSessionState(payloadSessionId);
        return true;
      }
      if (status === "idle" && !isSteeringHandoff) {
        clearCachedLiveSessionState(payloadSessionId);
        return true;
      }

      const cached = readCachedLiveSessionState(payloadSessionId);
      const eventTimestamp =
        typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
          ? payload.timestamp
          : undefined;
      let activities = cached?.activities || [];
      let currentStep = cached?.currentStep || null;
      const normalizedStatus = normalizeSessionStatus(status);

      if (status === "thinking" || status === "generating" || status === "compacting") {
        const activeToolStep = getLatestInFlightStep(activities);
        if (!payload.toolName) {
          const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
          if (status === "compacting") {
            currentStep = activeToolStep || detail || "Compacting earlier context...";
          } else if (isMeaningfulThoughtDetail(detail)) {
            const text = detail;
            activities = applyLiveActivityEvent(activities, {
              phase: "result",
              text,
              timestamp: eventTimestamp,
              toolName: "__thought",
            });
            currentStep = activeToolStep || text;
          } else {
            currentStep =
              activeToolStep ||
              (status === "generating"
                ? "Generating response..."
                : status === "thinking"
                  ? "Thinking..."
                  : null);
          }
        }
        writeCachedLiveSessionState(payloadSessionId, {
          status: normalizedStatus,
          activities,
          currentStep,
          streamingContent: cached?.streamingContent ?? null,
          runId: eventCursorBySessionRef.current[payloadSessionId]?.runId ?? null,
          sequence:
            eventCursorBySessionRef.current[payloadSessionId]?.sequence ?? cached?.sequence ?? 0,
          startedAtMs: cached?.startedAtMs ?? (eventTimestamp || Date.now()),
        });
        return true;
      }

      if (isSteeringHandoff) {
        activities = applyLiveActivityEvent(activities, {
          phase: "result",
          text: statusDetail,
          timestamp: eventTimestamp,
          toolName: "__thought",
        });
        writeCachedLiveSessionState(payloadSessionId, {
          status: "thinking",
          activities,
          currentStep: statusDetail,
          streamingContent: cached?.streamingContent ?? null,
          runId: eventCursorBySessionRef.current[payloadSessionId]?.runId ?? null,
          sequence:
            eventCursorBySessionRef.current[payloadSessionId]?.sequence ?? cached?.sequence ?? 0,
          startedAtMs: cached?.startedAtMs ?? (eventTimestamp || Date.now()),
        });
        return true;
      }

      if (status === "tool_executing" || status === "tool_completed") {
        const phase: "start" | "result" = status === "tool_executing" ? "start" : "result";
        const toolName = payload.toolName || "tool";
        const text = formatToolIntent(toolName, {}, phase, payload.detail);
        activities = applyLiveActivityEvent(activities, {
          phase,
          text,
          timestamp: eventTimestamp,
          toolName: payload.toolName,
          toolCallId: payload.toolCallId,
          sandboxProvider: payload.sandboxProvider,
        });
        writeCachedLiveSessionState(payloadSessionId, {
          status: phase === "start" ? "thinking" : normalizedStatus,
          activities,
          currentStep:
            phase === "start"
              ? isGenericStatusLabel(text)
                ? "Thinking..."
                : text
              : getLatestInFlightStep(activities),
          streamingContent: cached?.streamingContent ?? null,
          runId: eventCursorBySessionRef.current[payloadSessionId]?.runId ?? null,
          sequence:
            eventCursorBySessionRef.current[payloadSessionId]?.sequence ?? cached?.sequence ?? 0,
          startedAtMs: cached?.startedAtMs ?? (eventTimestamp || Date.now()),
        });
      }
      return true;
    },
    [acceptSessionEvent, isSessionStopSuppressed]
  );

  const hydrateSessionStatus = useCallback(
    async (targetSessionId?: string | null) => {
      const resolvedSessionId =
        typeof targetSessionId === "string" && targetSessionId.trim().length > 0
          ? targetSessionId.trim()
          : null;

      try {
        const response = await chatApi.getSessionStatus(resolvedSessionId || undefined);
        if (!response.success || !response.data) return;
        const payload = response.data as SessionStatusResponse;
        const rawActiveIds = Array.isArray(payload.activeSessionIds)
          ? payload.activeSessionIds
          : [];
        const visibleActiveIds = rawActiveIds.filter(
          (candidateId) => !isSessionStopSuppressed(candidateId)
        );

        if (!resolvedSessionId) return;
        const snapshot = payload.session;
        const stopSuppressed = isSessionStopSuppressed(resolvedSessionId);
        const serverReportsActive =
          payload.active === true || visibleActiveIds.includes(resolvedSessionId);
        const snapshotFresh = isSessionStatusSnapshotCurrent(
          snapshot?.timestamp,
          serverReportsActive
        );
        const nextActiveIds =
          snapshot && !snapshotFresh
            ? visibleActiveIds.filter((candidateId) => candidateId !== resolvedSessionId)
            : visibleActiveIds;
        const bufferedBeforeHydrate = readCachedLiveSessionState(resolvedSessionId);
        const hasBufferedBeforeHydrate =
          !!bufferedBeforeHydrate &&
          (bufferedBeforeHydrate.activities.length > 0 ||
            bufferedBeforeHydrate.status !== "idle" ||
            !!bufferedBeforeHydrate.streamingContent);
        const preserveVisibleCompletion =
          !serverReportsActive &&
          !loadingRef.current &&
          activeSessionRef.current === resolvedSessionId &&
          hasBufferedBeforeHydrate;
        setActiveSessionIds(
          preserveVisibleCompletion && !nextActiveIds.includes(resolvedSessionId)
            ? [...nextActiveIds, resolvedSessionId]
            : nextActiveIds
        );
        if (stopSuppressed) {
          if (activeSessionRef.current === resolvedSessionId) {
            setLiveStatus("idle");
            setLiveActivities([]);
            liveActivitiesRef.current = [];
            setLiveCurrentStep(null);
            runActivityBufferRef.current = [];
          }
          clearCachedLiveSessionState(resolvedSessionId);
          return;
        }
        const isActive =
          !!snapshot &&
          snapshotFresh &&
          (payload.active === true ||
            snapshot.status === "thinking" ||
            snapshot.status === "generating" ||
            snapshot.status === "compacting" ||
            snapshot.status === "tool_executing" ||
            snapshot.status === "tool_completed");
        const transcriptPendingIds = materializedPendingChatIds(typedMessagesRef.current);
        setPendingMessages((current) =>
          mergePendingChatMessages(snapshot?.pendingMessages, current, {
            preserveAcknowledged: true,
            materializedPendingIds: transcriptPendingIds,
          })
        );
        if (snapshot && snapshotFresh) {
          const snapshotAccepted = cacheLiveStatusSnapshot(snapshot);
          if (
            !snapshotAccepted &&
            snapshot.runId &&
            latestRunIdBySessionRef.current[resolvedSessionId] &&
            snapshot.runId !== latestRunIdBySessionRef.current[resolvedSessionId]
          ) {
            return;
          }
        }

        if (!isActive || !snapshot) {
          const bufferedLive = bufferedBeforeHydrate;
          const hasBufferedLive =
            !!bufferedLive &&
            (bufferedLive.activities.length > 0 ||
              bufferedLive.status !== "idle" ||
              !!bufferedLive.streamingContent);
          if (
            hasBufferedLive &&
            loadingRef.current &&
            activeSessionRef.current === resolvedSessionId
          ) {
            return;
          }
          if (
            hasBufferedLive &&
            !loadingRef.current &&
            activeSessionRef.current === resolvedSessionId
          ) {
            const refreshed = await refreshSessionMessagesRef.current(resolvedSessionId);
            if (!refreshed) {
              setActiveSessionIds((previous) =>
                previous.includes(resolvedSessionId) ? previous : [...previous, resolvedSessionId]
              );
              setLiveStatus("generating");
              setLiveCurrentStep("Finalizing response...");
              return;
            }
          }
          if (
            !loadingRef.current &&
            activeSessionRef.current === resolvedSessionId &&
            !nextActiveIds.includes(resolvedSessionId)
          ) {
            setLiveStatus("idle");
            setLiveActivities([]);
            liveActivitiesRef.current = [];
            setLiveCurrentStep(null);
            runActivityBufferRef.current = [];
            setStreamingContent(null);
          }
          if (!nextActiveIds.includes(resolvedSessionId)) {
            clearCachedLiveSessionState(resolvedSessionId);
          }
          return;
        }

        if (activeSessionRef.current !== resolvedSessionId) return;
        const snapshotLatest = snapshotLatestTimestamp(snapshot);
        const latestKnownTimestamp =
          latestStatusTimestampBySessionRef.current[resolvedSessionId] || 0;
        if (
          snapshotLatest > 0 &&
          latestKnownTimestamp > 0 &&
          snapshotLatest + 25 < latestKnownTimestamp
        ) {
          return;
        }
        if (snapshotLatest > latestKnownTimestamp) {
          latestStatusTimestampBySessionRef.current[resolvedSessionId] = snapshotLatest;
        }
        const localActivities = mergeActivityLists(
          runActivityBufferRef.current,
          liveActivitiesRef.current
        );
        const resolved = resolveSnapshotLiveState(snapshot, localActivities);
        setLiveStatus(resolved.status);
        setLiveActivities(resolved.activities);
        liveActivitiesRef.current = resolved.activities.map((activity) => ({
          ...activity,
        }));
        runActivityBufferRef.current = resolved.activities.map((activity) => ({
          ...activity,
        }));
        setLiveCurrentStep(resolved.currentStep);
      } catch (error) {
        console.error("Failed to hydrate session status:", error);
      }
    },
    [
      cacheLiveStatusSnapshot,
      isSessionStopSuppressed,
      resolveSnapshotLiveState,
      snapshotLatestTimestamp,
    ]
  );

  const refreshPendingMessages = useCallback(async (targetSessionId?: string | null) => {
    const resolvedSessionId =
      typeof targetSessionId === "string" && targetSessionId.trim().length > 0
        ? targetSessionId.trim()
        : null;
    if (!resolvedSessionId) return;
    try {
      const response = await chatApi.getPendingMessages(resolvedSessionId);
      if (!response.success || !response.data) return;
      if (activeSessionRef.current !== resolvedSessionId) return;
      const serverMessages = response.data?.pendingMessages;
      const transcriptPendingIds = materializedPendingChatIds(typedMessagesRef.current);
      const preservePending = currentSessionIsWorkingRef.current;
      setPendingMessages((current) =>
        mergePendingChatMessages(serverMessages, current, {
          preserveOptimistic: preservePending,
          preserveAcknowledged: true,
          materializedPendingIds: transcriptPendingIds,
        })
      );
      if (Array.isArray(serverMessages) && serverMessages.length === 0 && !preservePending) {
        clearCachedOptimisticPendingMessages(resolvedSessionId);
      }
    } catch {}
  }, []);

  useEffect(() => {
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const cached = readCachedLiveSessionState(sessionId);
    if (cached) {
      if (sessionId) {
        eventCursorBySessionRef.current[sessionId] = {
          runId: cached.runId,
          sequence: cached.sequence,
          timestamp: cached.updatedAt,
        };
        if (cached.runId) latestRunIdBySessionRef.current[sessionId] = cached.runId;
      }
      liveRunStartedAtMsRef.current = cached.startedAtMs;
      setLiveRunStartedAtMs(cached.startedAtMs);
      setLiveStatus(cached.status);
      setLiveActivities(cached.activities);
      liveActivitiesRef.current = cached.activities.map((activity) => ({
        ...activity,
      }));
      setStreamingContent(cached.streamingContent);
      setLiveCurrentStep(cached.currentStep);
      runActivityBufferRef.current = cached.activities.map((activity) => ({
        ...activity,
      }));
    } else {
      liveRunStartedAtMsRef.current = null;
      setLiveRunStartedAtMs(null);
      setLiveStatus("idle");
      setLiveActivities([]);
      liveActivitiesRef.current = [];
      setStreamingContent(null);
      setLiveCurrentStep(null);
      runActivityBufferRef.current = [];
    }
    acceptEventsUntilRef.current = 0;
    if (!sessionId) {
      setPendingMessages([]);
      return;
    }

    const cachedOptimistic = readCachedOptimisticPendingMessages(sessionId);
    if (cachedOptimistic.length > 0) {
      setPendingMessages((current) => mergePendingChatMessages(current, cachedOptimistic));
    }

    void refreshPendingMessages(sessionId);
    void hydrateSessionStatus(sessionId);
    return;
  }, [hydrateSessionStatus, refreshPendingMessages, sessionId]);

  useEffect(() => {
    liveActivitiesRef.current = liveActivities.map((activity) => ({
      ...activity,
    }));
  }, [liveActivities]);

  useEffect(() => {
    if (!sessionId || liveActivities.length === 0 || typedMessages.length === 0) return;
    const prunedActivities = pruneCanonicalizedLiveActivities(typedMessages, liveActivities);
    const prunedBuffer = pruneCanonicalizedLiveActivities(
      typedMessages,
      runActivityBufferRef.current
    );
    const activitiesChanged = prunedActivities.length !== liveActivities.length;
    const bufferChanged = prunedBuffer.length !== runActivityBufferRef.current.length;
    if (!activitiesChanged && !bufferChanged) return;

    if (bufferChanged) {
      runActivityBufferRef.current = prunedBuffer.map((activity) => ({
        ...activity,
      }));
    }
    if (activitiesChanged) {
      setLiveActivities(prunedActivities);
    }
    if (
      prunedActivities.length === 0 &&
      prunedBuffer.length === 0 &&
      !isLoading &&
      !activeSessionIds.includes(sessionId)
    ) {
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      clearCachedLiveSessionState(sessionId);
    }
  }, [activeSessionIds, isLoading, liveActivities, sessionId, typedMessages]);

  useEffect(() => {
    if (!sessionId) return;
    writeCachedOptimisticPendingMessages(sessionId, pendingMessages);
  }, [pendingMessages, sessionId]);

  useEffect(() => {
    const transcriptPendingIds = materializedPendingChatIds(typedMessages);
    if (transcriptPendingIds.size === 0) return;
    setPendingMessages((current) =>
      current.filter((message) => !transcriptPendingIds.has(message.id))
    );
  }, [typedMessages]);

  useEffect(() => {
    if (!sessionId || typedMessages.length === 0) return;
    writeCachedSessionMessages(sessionId, typedMessages);
  }, [sessionId, typedMessages]);

  useEffect(() => {
    if (!sessionId) return;
    if (!currentSessionIsWorking) {
      clearCachedLiveSessionState(sessionId);
      return;
    }
    writeCachedLiveSessionState(sessionId, {
      status: liveStatus,
      activities: liveActivities,
      currentStep: liveCurrentStep,
      streamingContent,
      runId: latestRunIdBySessionRef.current[sessionId] ?? null,
      sequence: eventCursorBySessionRef.current[sessionId]?.sequence,
      startedAtMs: liveRunStartedAtMs,
    });
  }, [
    activeSessionIds,
    currentSessionIsWorking,
    liveActivities,
    liveCurrentStep,
    liveRunStartedAtMs,
    liveStatus,
    sessionId,
    streamingContent,
  ]);

  useEffect(() => {
    refreshSessionMessagesRef.current = async (sid: string) => {
      try {
        const result = await loadPersistedCompletion(() => loadFreshSession(sid));
        if (result?.messagesList && activeSessionRef.current === sid) {
          loadSession(
            sid,
            result.messagesList as ChatMessage[],
            (result as { workspace_dir?: string | null }).workspace_dir || null
          );
          setSessionContextUsage(
            (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
          );
          setSessionTokenUsage(
            (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
          );
          return true;
        }
      } catch {
        return false;
      }
      return false;
    };
  });

  useEffect(() => {
    const disconnect = connectStatusStream({
      replayBufferedSessionEvents: true,
      onEvent: (payload) => {
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "snapshot") {
          const snapshotIds = Array.isArray(payload.activeSessionIds)
            ? payload.activeSessionIds.filter(
                (candidate): candidate is string =>
                  typeof candidate === "string" &&
                  candidate.trim().length > 0 &&
                  !isSessionStopSuppressed(
                    candidate,
                    payload.activeSessions?.find((snapshot) => snapshot.sessionId === candidate)
                      ?.runId
                  )
              )
            : [];
          for (const snapshot of payload.activeSessions || []) {
            cacheLiveStatusSnapshot(snapshot);
          }
          setActiveSessionIds(snapshotIds);
          const activeSession = activeSessionRef.current;
          if (activeSession) {
            void hydrateSessionStatus(activeSession);
          }
          return;
        }
        if (payload.type !== "status") {
          if (payload.type === "assistant_token") {
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            if (delta) {
              const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
              if (isSessionStopSuppressed(sessionId, payload.runId)) return;
              if (!cacheAssistantToken(payload)) return;
              const activeSession = activeSessionRef.current;
              if (activeSession && sessionId === activeSession) {
                setStreamingContent((prev) => (prev === null ? delta : prev + delta));
              }
            }
          }
          return;
        }
        const status = typeof payload.status === "string" ? payload.status : "";
        if (!status) return;
        const statusDetail = typeof payload.detail === "string" ? payload.detail.trim() : "";
        const isSteeringHandoff =
          status === "idle" && statusDetail.toLowerCase() === "steering to follow-up...";
        const payloadSessionId =
          typeof payload.sessionId === "string" && payload.sessionId.trim()
            ? payload.sessionId
            : null;
        const statusIsActive =
          status === "thinking" ||
          status === "generating" ||
          status === "compacting" ||
          status === "tool_executing" ||
          status === "tool_completed";
        if (
          payloadSessionId &&
          isSessionStopSuppressed(payloadSessionId, payload.runId) &&
          statusIsActive
        ) {
          setActiveSessionIds((previous) => previous.filter((id) => id !== payloadSessionId));
          if (payloadSessionId === activeSessionRef.current) {
            setLiveStatus("idle");
            setLiveCurrentStep(null);
            setLiveActivities([]);
            liveActivitiesRef.current = [];
            runActivityBufferRef.current = [];
          }
          clearCachedLiveSessionState(payloadSessionId);
          runStartSyncedSessionsRef.current.delete(payloadSessionId);
          return;
        }
        if (!cacheLiveStatusEvent(payload)) return;
        const payloadTimestamp =
          typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
            ? payload.timestamp
            : 0;
        if (payloadSessionId && payloadTimestamp > 0) {
          const previousTimestamp =
            latestStatusTimestampBySessionRef.current[payloadSessionId] || 0;
          if (payloadTimestamp > previousTimestamp) {
            latestStatusTimestampBySessionRef.current[payloadSessionId] = payloadTimestamp;
          }
        }

        if (payloadSessionId) {
          if (statusIsActive) {
            setActiveSessionIds((previous) =>
              previous.includes(payloadSessionId) ? previous : [...previous, payloadSessionId]
            );
          }
          const visibleCompletion =
            status === "idle" &&
            !isSteeringHandoff &&
            payloadSessionId === activeSessionRef.current;
          if (
            ((status === "idle" && !isSteeringHandoff) || status === "error") &&
            !visibleCompletion
          ) {
            setActiveSessionIds((previous) => previous.filter((id) => id !== payloadSessionId));
            runStartSyncedSessionsRef.current.delete(payloadSessionId);
          }
        }

        const activeSession = activeSessionRef.current;
        const isEventForVisibleSession =
          !!activeSession && !!payloadSessionId && payloadSessionId === activeSession;
        if (
          !loadingRef.current &&
          Date.now() > acceptEventsUntilRef.current &&
          !isEventForVisibleSession
        ) {
          return;
        }

        if (activeSession && payload.sessionId && payload.sessionId !== activeSession) return;
        if (activeSession && !payload.sessionId) return;

        if (
          statusIsActive &&
          activeSession &&
          !loadingRef.current &&
          Date.now() > acceptEventsUntilRef.current &&
          !runStartSyncedSessionsRef.current.has(activeSession)
        ) {
          runStartSyncedSessionsRef.current.add(activeSession);
          void refreshSessionMessagesRef.current(activeSession);
        }

        if (status === "thinking") {
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            if (isMeaningfulThoughtDetail(detail)) {
              appendLiveActivity("result", detail, "__thought", eventTimestamp);
              setLiveCurrentStep(activeToolStep || detail);
            } else {
              setLiveCurrentStep(activeToolStep || "Thinking...");
            }
          }
          setLiveStatus("thinking");
          return;
        }
        if (status === "generating") {
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            if (isMeaningfulThoughtDetail(detail)) {
              appendLiveActivity("result", detail, "__thought", eventTimestamp);
              setLiveCurrentStep(activeToolStep || detail);
            } else {
              setLiveCurrentStep(activeToolStep || "Generating response...");
            }
          }
          setLiveStatus("generating");
          return;
        }
        if (status === "compacting") {
          if (!payload.toolName) {
            const activeToolStep = getLatestInFlightStep(runActivityBufferRef.current);
            const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
            const compactingDetail = isMeaningfulThoughtDetail(detail)
              ? detail
              : "Compacting earlier context...";
            setLiveCurrentStep(activeToolStep || compactingDetail);
          }
          setLiveStatus("compacting");
          return;
        }
        if (status === "idle") {
          if (isSteeringHandoff) {
            const eventTimestamp =
              typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
                ? payload.timestamp
                : undefined;
            appendLiveActivity("result", statusDetail, "__thought", eventTimestamp);
            setLiveStatus("thinking");
            setLiveCurrentStep(statusDetail);
            return;
          }
          const sessionToRefresh = payloadSessionId || activeSession;
          const finalizeLiveState = () => {
            if (sessionToRefresh) {
              setActiveSessionIds((previous) => previous.filter((id) => id !== sessionToRefresh));
              runStartSyncedSessionsRef.current.delete(sessionToRefresh);
            }
            setLiveStatus("idle");
            setLiveCurrentStep(null);
            setStreamingContent(null);
            liveRunStartedAtMsRef.current = null;
            setLiveRunStartedAtMs(null);
            setLiveActivities([]);
            runActivityBufferRef.current = [];
            clearCachedLiveSessionState(sessionToRefresh);
          };
          if (loadingRef.current) {
            finalizeLiveState();
            return;
          }
          if (sessionToRefresh && sessionToRefresh === activeSessionRef.current) {
            setLiveCurrentStep("Finalizing response...");
            void refreshSessionMessagesRef.current(sessionToRefresh).then((refreshed) => {
              if (refreshed) {
                finalizeLiveState();
                return;
              }
              if (activeSessionRef.current !== sessionToRefresh) return;
              setLiveStatus("generating");
              setLiveCurrentStep("Finalizing response...");
              writeCachedLiveSessionState(sessionToRefresh, {
                status: "generating",
                activities: runActivityBufferRef.current,
                currentStep: "Finalizing response...",
                streamingContent,
                runId: latestRunIdBySessionRef.current[sessionToRefresh] ?? null,
                sequence: eventCursorBySessionRef.current[sessionToRefresh]?.sequence,
                startedAtMs: liveRunStartedAtMsRef.current,
              });
              window.setTimeout(() => {
                if (activeSessionRef.current !== sessionToRefresh) return;
                void refreshSessionMessagesRef.current(sessionToRefresh).then((retryRefreshed) => {
                  if (retryRefreshed) finalizeLiveState();
                });
              }, 1_000);
            });
          } else {
            finalizeLiveState();
          }
          return;
        }
        if (status === "tool_executing" || status === "tool_completed" || status === "error") {
          const phase =
            payload.toolPhase ||
            (status === "tool_executing"
              ? "start"
              : status === "tool_completed"
                ? "result"
                : "error");
          const toolName = payload.toolName || "tool";
          const text = formatToolIntent(toolName, {}, phase, payload.detail);
          const eventTimestamp =
            typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
              ? payload.timestamp
              : undefined;
          appendLiveActivity(
            phase,
            text,
            payload.toolName,
            eventTimestamp,
            payload.toolCallId,
            payload.sandboxProvider
          );
          if (phase === "start") {
            setLiveStatus("thinking");
            setLiveCurrentStep(isGenericStatusLabel(text) ? "Thinking..." : text);
          } else {
            const nextActiveStep = getLatestInFlightStep(runActivityBufferRef.current);
            if (nextActiveStep) {
              setLiveCurrentStep(nextActiveStep);
            } else {
              setLiveCurrentStep(null);
            }
          }
        }
      },
    });

    return () => {
      disconnect();
    };
  }, [
    appendLiveActivity,
    cacheAssistantToken,
    cacheLiveStatusEvent,
    cacheLiveStatusSnapshot,
    hydrateSessionStatus,
    isSessionStopSuppressed,
    markFirstTokenLatency,
  ]);

  return { hydrateSessionStatus };
}
