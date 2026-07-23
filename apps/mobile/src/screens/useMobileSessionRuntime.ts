import {
  resolveSessionEventOrder,
  type SessionEventCursor,
  type SessionEventIdentity,
} from "cybara-shared/session-event-order";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ScrollView } from "react-native";
import type {
  CybaraMobileApi,
  MobilePendingChatMessage,
  SessionDetailSummary,
  SessionSummary,
} from "../lib/api";
import { haptics } from "../lib/haptics";
import {
  clearCachedMobileLiveAssistant,
  isMobileSessionSnapshotCurrent,
  liveActivityFromStatusEvent,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  mergeLiveActivity,
  prunePersistedMobileLiveAssistant,
  readCachedMobileLiveAssistant,
  subscribeCachedMobileLiveAssistant,
  writeCachedMobileLiveAssistant,
} from "./dashboardLiveChat";
import {
  mergeCachedMobileOptimisticTranscript,
  readCachedMobileOptimisticTranscript,
} from "./dashboardOptimisticTranscript";
import {
  clearCachedMobileOptimisticPendingMessages,
  mergeMobilePendingMessages,
  readCachedMobileOptimisticPendingMessages,
  writeCachedMobileOptimisticPendingMessages,
} from "./dashboardPendingQueue";

function optimisticMobileSessionDetail(
  sessionId: string,
  sessionSummary?: SessionSummary | null
): SessionDetailSummary | null {
  const messages = readCachedMobileOptimisticTranscript(sessionId);
  if (messages.length === 0 && !readCachedMobileLiveAssistant(sessionId)) return null;
  return {
    id: sessionId,
    title: sessionSummary?.title ?? null,
    agentId: sessionSummary?.agent_id,
    provider: sessionSummary?.provider,
    providerId: sessionSummary?.provider_id,
    providerName: sessionSummary?.provider_name,
    model: sessionSummary?.model,
    workspaceDir: sessionSummary?.workspace_dir,
    createdAt: sessionSummary?.created_at,
    updatedAt: sessionSummary?.updated_at,
    pinned: sessionSummary?.pinned,
    messages,
  };
}

interface MobileSessionRuntimeOptions {
  api: CybaraMobileApi;
  sessionId: string;
  sessionSummary?: SessionSummary | null;
  sending: boolean;
  setPinned: Dispatch<SetStateAction<boolean>>;
  setPendingSessionAgentId: Dispatch<SetStateAction<string | null>>;
  scrollRef: RefObject<ScrollView | null>;
  onSessionUpdated: (detail: SessionDetailSummary) => void;
}

interface MobileSessionRuntimeController {
  detail: SessionDetailSummary | null;
  setDetail: Dispatch<SetStateAction<SessionDetailSummary | null>>;
  loading: boolean;
  loadError: string | null;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  pendingMessages: MobilePendingChatMessage[];
  setPendingMessages: Dispatch<SetStateAction<MobilePendingChatMessage[]>>;
  sessionActive: boolean;
  liveAssistant: SessionDetailSummary["messages"][number] | null;
  liveNowMs: number;
  loadSession: (showLoading?: boolean) => Promise<void>;
  commitLiveAssistant: (
    updater: (
      current: SessionDetailSummary["messages"][number] | null
    ) => SessionDetailSummary["messages"][number] | null,
    nowMs?: number
  ) => void;
  responseHapticActiveRef: RefObject<boolean>;
  optimisticPendingGraceUntilRef: RefObject<number>;
  optimisticPendingCounterRef: RefObject<number>;
}

export function useMobileSessionRuntime({
  api,
  sessionId,
  sessionSummary,
  sending,
  setPinned,
  setPendingSessionAgentId,
  scrollRef,
  onSessionUpdated,
}: MobileSessionRuntimeOptions): MobileSessionRuntimeController {
  const [detail, setDetail] = useState<SessionDetailSummary | null>(() =>
    optimisticMobileSessionDetail(sessionId, sessionSummary)
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<MobilePendingChatMessage[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [statusStreamConnected, setStatusStreamConnected] = useState(false);
  const currentSessionIdRef = useRef(sessionId);
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  useEffect(() => {
    currentSessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    onSessionUpdatedRef.current = onSessionUpdated;
  }, [onSessionUpdated]);
  const sessionRefreshInFlight = useRef<{
    sessionId: string;
    token: symbol;
    promise: Promise<void>;
  } | null>(null);
  const sendingRef = useRef(false);
  const responseHapticActiveRef = useRef(false);
  const optimisticPendingGraceUntilRef = useRef(0);
  const optimisticPendingCounterRef = useRef(0);
  const cachedLiveAssistant = readCachedMobileLiveAssistant(sessionId);
  const [liveAssistant, setLiveAssistant] = useState<
    SessionDetailSummary["messages"][number] | null
  >(() => cachedLiveAssistant?.message ?? null);
  const [liveNowMs, setLiveNowMs] = useState(() => cachedLiveAssistant?.nowMs ?? Date.now());
  const liveEventCursorRef = useRef<SessionEventCursor | undefined>(
    cachedLiveAssistant
      ? {
          runId: cachedLiveAssistant.runId,
          sequence: cachedLiveAssistant.sequence,
          timestamp: cachedLiveAssistant.updatedAt,
        }
      : undefined
  );

  const commitLiveAssistant = useCallback(
    (
      updater: (
        current: SessionDetailSummary["messages"][number] | null
      ) => SessionDetailSummary["messages"][number] | null,
      nowMs = Date.now()
    ) => {
      setLiveNowMs(nowMs);
      setLiveAssistant((current) => {
        const next = updater(current);
        if (next) {
          writeCachedMobileLiveAssistant(sessionId, next, nowMs, liveEventCursorRef.current);
        } else {
          clearCachedMobileLiveAssistant(sessionId);
        }
        return next;
      });
    },
    [sessionId]
  );

  const acceptLiveEvent = useCallback(
    (identity: SessionEventIdentity): boolean => {
      const decision = resolveSessionEventOrder(liveEventCursorRef.current, identity);
      if (!decision.accepted) return false;
      liveEventCursorRef.current = decision.cursor;
      if (decision.runChanged) commitLiveAssistant(() => null);
      return true;
    },
    [commitLiveAssistant]
  );

  const applySessionDetail = useCallback(
    (nextDetail: SessionDetailSummary) => {
      const reconciledDetail = {
        ...nextDetail,
        messages: mergeCachedMobileOptimisticTranscript(sessionId, nextDetail.messages),
      };
      setDetail(reconciledDetail);
      onSessionUpdatedRef.current(reconciledDetail);
      commitLiveAssistant((current) =>
        prunePersistedMobileLiveAssistant(current, reconciledDetail.messages)
      );
      if (typeof reconciledDetail.pinned === "boolean") {
        setPinned(reconciledDetail.pinned);
      }
    },
    [commitLiveAssistant, sessionId]
  );

  const loadSession = useCallback(
    (showLoading = false): Promise<void> => {
      const requestedSessionId = sessionId;
      const existing = sessionRefreshInFlight.current;
      if (existing?.sessionId === requestedSessionId) return existing.promise;
      const token = Symbol(requestedSessionId);
      const promise = (async (): Promise<void> => {
        if (showLoading) setLoading(true);
        setLoadError(null);
        try {
          const nextDetail = await api.session(requestedSessionId);
          if (currentSessionIdRef.current !== requestedSessionId) return;
          applySessionDetail(nextDetail);
        } catch (error) {
          if (currentSessionIdRef.current === requestedSessionId) {
            const optimistic = optimisticMobileSessionDetail(requestedSessionId);
            if (optimistic) {
              setDetail((current) => current ?? optimistic);
              setLoadError(null);
            } else {
              setLoadError(error instanceof Error ? error.message : String(error));
            }
          }
        } finally {
          if (sessionRefreshInFlight.current?.token === token) {
            sessionRefreshInFlight.current = null;
          }
          if (showLoading && currentSessionIdRef.current === requestedSessionId) setLoading(false);
        }
      })();
      sessionRefreshInFlight.current = {
        sessionId: requestedSessionId,
        token,
        promise,
      };
      return promise;
    },
    [api, applySessionDetail, sessionId]
  );

  const shouldPreserveOptimisticPending = useCallback(
    () => sendingRef.current || Date.now() < optimisticPendingGraceUntilRef.current,
    []
  );

  const hydrateLiveAssistant = useCallback(async () => {
    try {
      const status = await api.sessionStatus(sessionId);
      const snapshot =
        status.session || status.activeSessions.find((entry) => entry.sessionId === sessionId);
      const serverReportsActive =
        status.active === true || status.activeSessionIds.includes(sessionId);
      const snapshotFresh = isMobileSessionSnapshotCurrent(
        snapshot?.timestamp,
        serverReportsActive
      );
      if (snapshot && snapshotFresh) {
        const snapshotAccepted = acceptLiveEvent(snapshot);
        if (
          !snapshotAccepted &&
          snapshot.runId &&
          liveEventCursorRef.current?.runId &&
          snapshot.runId !== liveEventCursorRef.current.runId
        ) {
          return;
        }
      }
      const snapshotStatus = String(snapshot?.status || "").toLowerCase();
      const active =
        !!snapshot &&
        snapshotFresh &&
        (serverReportsActive ||
          snapshotStatus === "thinking" ||
          snapshotStatus === "generating" ||
          snapshotStatus === "tool_executing" ||
          snapshotStatus === "compacting");
      setSessionActive(active);
      const snapshotPendingMessages = snapshot?.pendingMessages ?? [];
      const preserveOptimisticPending = shouldPreserveOptimisticPending();
      if (!preserveOptimisticPending && snapshotPendingMessages.length === 0) {
        clearCachedMobileOptimisticPendingMessages(sessionId);
      }
      setPendingMessages((current) =>
        mergeMobilePendingMessages(snapshotPendingMessages, current, {
          preserveOptimistic: preserveOptimisticPending,
        })
      );
      if (!active || !snapshot) {
        if (!sendingRef.current) {
          const cached = readCachedMobileLiveAssistant(sessionId);
          if (cached) {
            setLiveNowMs(cached.nowMs);
            setLiveAssistant((current) => current ?? cached.message);
          } else {
            commitLiveAssistant(() => null);
          }
          if (!preserveOptimisticPending) {
            clearCachedMobileOptimisticPendingMessages(sessionId);
          }
        }
        return;
      }
      commitLiveAssistant(
        (current) => liveAssistantFromStatusSnapshot(sessionId, current, snapshot),
        snapshot.timestamp
      );
    } catch {
      /* best effort */
    }
  }, [acceptLiveEvent, api, commitLiveAssistant, sessionId, shouldPreserveOptimisticPending]);

  const hydratePendingMessages = useCallback(async () => {
    try {
      const pending = await api.pendingChatMessages(sessionId);
      const pendingMessages = pending.pendingMessages ?? [];
      const preserveOptimisticPending = shouldPreserveOptimisticPending();
      if (!preserveOptimisticPending && pendingMessages.length === 0) {
        clearCachedMobileOptimisticPendingMessages(sessionId);
      }
      setPendingMessages((current) =>
        mergeMobilePendingMessages(pendingMessages, current, {
          preserveOptimistic: preserveOptimisticPending,
        })
      );
    } catch {
      /* best effort */
    }
  }, [api, sessionId, shouldPreserveOptimisticPending]);

  useEffect(() => {
    if (typeof sessionSummary?.pinned === "boolean") {
      setPinned(sessionSummary.pinned);
    }
  }, [sessionId, sessionSummary?.pinned]);

  useEffect(() => {
    setPendingSessionAgentId(null);
    setSessionActive(false);
    setStatusStreamConnected(false);
    responseHapticActiveRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    const cached = readCachedMobileLiveAssistant(sessionId);
    liveEventCursorRef.current = cached
      ? {
          runId: cached.runId,
          sequence: cached.sequence,
          timestamp: cached.updatedAt,
        }
      : undefined;
    setLiveAssistant(cached?.message ?? null);
    setLiveNowMs(cached?.nowMs ?? Date.now());
    const cachedOptimistic = readCachedMobileOptimisticPendingMessages(sessionId);
    if (cachedOptimistic.length > 0) {
      optimisticPendingGraceUntilRef.current = Date.now() + 15_000;
      setPendingMessages((current) => mergeMobilePendingMessages(cachedOptimistic, current));
    } else {
      setPendingMessages([]);
    }
    void hydratePendingMessages();
    void hydrateLiveAssistant();
  }, [hydrateLiveAssistant, hydratePendingMessages, sessionId]);

  useEffect(
    () =>
      subscribeCachedMobileLiveAssistant(sessionId, (cached) => {
        setLiveAssistant(cached?.message ?? null);
        setLiveNowMs(cached?.nowMs ?? Date.now());
      }),
    [sessionId]
  );

  useEffect(() => {
    if (!sessionId) return;
    writeCachedMobileOptimisticPendingMessages(sessionId, pendingMessages);
  }, [pendingMessages, sessionId]);

  useEffect(() => {
    setDetail((current) =>
      current?.id === sessionId ? current : optimisticMobileSessionDetail(sessionId, sessionSummary)
    );
    void loadSession(true);
  }, [loadSession, sessionId, sessionSummary]);

  useEffect(() => {
    const disconnect = api.connectStatusStream(
      {
        onOpen: () => {
          setStatusStreamConnected(true);
          void hydrateLiveAssistant();
        },
        onClose: () => {
          setStatusStreamConnected(false);
          void hydrateLiveAssistant();
        },
        onError: () => {
          setStatusStreamConnected(false);
        },
        onEvent: (event) => {
          if (event.type === "assistant_token") {
            if (event.sessionId !== sessionId) return;
            if (!acceptLiveEvent(event)) return;
            if (!responseHapticActiveRef.current) {
              responseHapticActiveRef.current = true;
              haptics.agentStarted();
            }
            haptics.agentProgress();
            commitLiveAssistant((current) => {
              const base = liveAssistantMessage(sessionId, current, event.timestamp);
              return {
                ...base,
                content: `${base.content || ""}${event.delta}`,
              };
            }, event.timestamp);
            return;
          }

          if (event.type === "snapshot") {
            const snapshot = event.activeSessions.find((entry) => entry.sessionId === sessionId);
            if (!snapshot) {
              setSessionActive(false);
              const preserveOptimisticPending = shouldPreserveOptimisticPending();
              if (!preserveOptimisticPending) {
                clearCachedMobileOptimisticPendingMessages(sessionId);
              }
              setPendingMessages((current) =>
                mergeMobilePendingMessages([], current, {
                  preserveOptimistic: preserveOptimisticPending,
                })
              );
              return;
            }
            const snapshotAccepted = acceptLiveEvent(snapshot);
            if (
              !snapshotAccepted &&
              snapshot.runId &&
              liveEventCursorRef.current?.runId &&
              snapshot.runId !== liveEventCursorRef.current.runId
            ) {
              return;
            }
            setSessionActive(true);
            const pendingMessages = snapshot.pendingMessages ?? [];
            const preserveOptimisticPending = shouldPreserveOptimisticPending();
            if (!preserveOptimisticPending && pendingMessages.length === 0) {
              clearCachedMobileOptimisticPendingMessages(sessionId);
            }
            setPendingMessages((current) =>
              mergeMobilePendingMessages(pendingMessages, current, {
                preserveOptimistic: preserveOptimisticPending,
              })
            );
            commitLiveAssistant(
              (current) => liveAssistantFromStatusSnapshot(sessionId, current, snapshot),
              snapshot.timestamp
            );
            return;
          }

          if (event.type !== "status" || event.sessionId !== sessionId) return;
          if (!acceptLiveEvent(event)) return;
          const queuedTurnHandoff =
            typeof event.pendingChatId === "string" ||
            (event.detail || "").trim().toLowerCase() === "starting queued follow-up";
          if (queuedTurnHandoff) {
            setSessionActive(true);
            void loadSession(false).finally(() => {
              void hydratePendingMessages();
            });
          }
          if (event.status === "idle") {
            const steeringHandoff =
              (event.detail || "").trim().toLowerCase() === "steering to follow-up...";
            if (steeringHandoff) {
              setSessionActive(true);
              void loadSession(false);
              return;
            }
            setSessionActive(false);
            if (responseHapticActiveRef.current) {
              responseHapticActiveRef.current = false;
              haptics.agentCompleted();
            }
            if (!sendingRef.current) {
              void loadSession(false).finally(() => {
                void hydrateLiveAssistant();
              });
            }
            return;
          }
          setSessionActive(event.status !== "error");
          const activity = liveActivityFromStatusEvent(event);
          if (!activity) return;
          if (!responseHapticActiveRef.current) {
            responseHapticActiveRef.current = true;
            haptics.agentStarted();
          } else {
            haptics.agentProgress();
          }
          commitLiveAssistant((current) => {
            const base = liveAssistantMessage(sessionId, current, event.timestamp);
            return {
              ...base,
              processActivities: mergeLiveActivity(base.processActivities || [], activity),
            };
          }, event.timestamp);
        },
      },
      { replayBufferedEvents: true }
    );
    return disconnect;
  }, [
    acceptLiveEvent,
    api,
    commitLiveAssistant,
    hydrateLiveAssistant,
    hydratePendingMessages,
    loadSession,
    sessionId,
    shouldPreserveOptimisticPending,
  ]);

  useEffect(() => {
    if (statusStreamConnected && (sending || sessionActive || liveAssistant)) return;
    const delay =
      !statusStreamConnected && (sending || sessionActive || liveAssistant) ? 1200 : 5000;
    const interval = setInterval(() => {
      void loadSession(false);
      if (!statusStreamConnected) void hydrateLiveAssistant();
    }, delay);
    return () => clearInterval(interval);
  }, [
    hydrateLiveAssistant,
    loadSession,
    liveAssistant,
    sending,
    sessionActive,
    statusStreamConnected,
  ]);

  useEffect(() => {
    if (!statusStreamConnected || (!sending && !sessionActive && !liveAssistant)) return;
    const interval = setInterval(() => {
      void hydrateLiveAssistant();
    }, 4000);
    return () => clearInterval(interval);
  }, [hydrateLiveAssistant, liveAssistant, sending, sessionActive, statusStreamConnected]);

  useEffect(() => {
    if (!liveAssistant) return;
    const interval = setInterval(() => setLiveNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [liveAssistant]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [
    detail?.messages.length,
    liveAssistant?.content,
    liveAssistant?.processActivities?.length,
    pendingMessages.length,
    sending,
  ]);

  return {
    detail,
    setDetail,
    loading,
    loadError,
    setLoadError,
    pendingMessages,
    setPendingMessages,
    sessionActive,
    liveAssistant,
    liveNowMs,
    loadSession,
    commitLiveAssistant,
    responseHapticActiveRef,
    optimisticPendingGraceUntilRef,
    optimisticPendingCounterRef,
  };
}
