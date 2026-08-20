import { LocalFolderPickerModal } from "@/components/LocalFolderPickerModal";
import { Button, Modal } from "@/components/ui";
import { useAgentSummaries, useInfo, useSubagents, useUpdateAgentReasoning } from "@/hooks/useApi";
import {
  type LoadedChatSession,
  useChat,
  useLoadSession,
  useUpdateSessionAgent,
} from "@/hooks/useChat";
import { canShareNearbySession, useNearbyStatus } from "@/hooks/useNearbyStatus";
import { chatApi, providerPlansApi, settingsApi } from "@/lib/api";
import {
  APP_HOTKEY_EVENT,
  type AppHotkeyActionId,
  consumePendingChatHotkey,
} from "@/lib/appHotkeys";
import { apiFetch } from "@/lib/auth";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  type LiveActivityItem,
  mergeActivityLists,
  suppressRecoveredWebFailureActivities,
} from "@/lib/chatActivities";
import { useI18n } from "@/lib/i18n";
import { type PendingChatMessage, type StatusSessionSnapshot } from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import type { ProviderPlanStatusResponse, SessionContextUsage, SessionTokenUsage } from "@/types";
import { openExternal } from "@/utils/openExternal";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  resolveSessionEventOrder,
  type SessionEventCursor,
  type SessionEventIdentity,
} from "../../../shared/session-event-order";
import { ArtifactViewerPanel } from "./chat/ArtifactViewerPanel";
import { parseTimestampMs } from "./chat/assistantMetaModel";
import { MODEL_ROUTER_SELECTOR_VALUE } from "./chat/ChatAgentControls";
import { ChatComposer, type ChatComposerProps } from "./chat/ChatComposer";
import { ChatEmptyState } from "./chat/ChatEmptyState";
import { GoalPanel } from "./chat/GoalPanel";
import { useSessionGoal } from "./chat/useSessionGoal";
import { normalizeToolApprovalMode, type ToolApprovalMode } from "./chat/ChatFollowUpControls";
import { ChatImageLightbox } from "./chat/ChatImageLightbox";
import { chatHorizontalPaddingClassName } from "./chat/chatAppearanceLayout";
import { type ChatLinkOpenOptions, routeChatLink } from "./chat/chatLinkRouting";
import { ChatMessageTimeline } from "./chat/ChatMessageTimeline";
import {
  type ChatMessage,
  extractLatestPlanFromMessages,
  formatToolIntent,
  getLegacyMessageProcessKey,
  getMessageProcessKey,
  isAgentUsingBrowser,
  normalizeMessageProcessActivities,
  PENDING_CAPTURE_TIMEOUT_MS,
  type PendingProcessCapture,
  persistMessageProcessMap,
  persistSessionId,
  persistWorkspaceDir,
  readPersistedMessageProcessMap,
  readPersistedSessionId,
  readPersistedWorkspaceDir,
  type RevertTarget,
  type SessionStatusResponse,
  type SessionStatusSnapshot,
  shouldShowSessionPlanInComposer,
} from "./chat/chatModel";
import { ChatPageHeader } from "./chat/ChatPageHeader";
import { buildMultiChatPath } from "./chat/multiChatLayout";
import { parseInitialChatRoute } from "./chat/chatRoute";
import { ChatSessionLoadingState } from "./chat/ChatSessionLoadingState";
import { ChatWorkspaceDock } from "./chat/ChatWorkspaceDock";
import { hasMixedAssistantAuthors } from "./chat/assistantAuthors";
import { clearCachedLiveSessionState, isLiveSessionRunning } from "./chat/liveSessionState";
import { NearbyShareModal } from "./chat/NearbyShareModal";
import { PendingApprovalsBanner } from "./chat/PendingApprovalsBanner";
import { normalizePendingChatMessages } from "./chat/pendingQueueState";
import {
  isStoppedRunSuppressed,
  markStoppedRun,
  type StoppedRunSuppressions,
} from "./chat/stopSuppression";
import { useArtifactViewer } from "./chat/useArtifactViewer";
import { useChatAttachments } from "./chat/useChatAttachments";
import { useChatCapabilityPicker } from "./chat/useChatCapabilityPicker";
import { useChatDictation } from "./chat/useChatDictation";
import { useChatLiveSessionRuntime } from "./chat/useChatLiveSessionRuntime";
import { useChatMessageActions } from "./chat/useChatMessageActions";
import { useChatPendingMutations } from "./chat/useChatPendingMutations";
import { useChatScroll } from "./chat/useChatScroll";
import { useChatWorkspaceActions } from "./chat/useChatWorkspaceActions";
import { useChatWorkspaceTabs } from "./chat/useChatWorkspaceTabs";
import { useEnvironmentGitBranches } from "./chat/useEnvironmentGitBranches";
import { useSessionFileChanges } from "./chat/useSessionFileChanges";

type LiveStatusSnapshotLike = StatusSessionSnapshot | SessionStatusSnapshot;

const STOPPED_SESSION_STATUS_SUPPRESSION_MS = 12_000;

export function Chat() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: agents = [] } = useAgentSummaries();
  const updateAgentReasoning = useUpdateAgentReasoning();
  const { data: info } = useInfo();
  const [initialChatRoute] = useState(() => parseInitialChatRoute(window.location.search));
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    initialChatRoute.agentId ?? undefined
  );
  const [sessionAgentId, setSessionAgentId] = useState<string | null>(null);
  const [modelRouterEnabled, setModelRouterEnabled] = useState(false);
  const [useModelRouter, setUseModelRouter] = useState(false);
  const [lastWorkspaceDir, setLastWorkspaceDir] = useState<string | null>(null);
  const [workspaceFallbackSuppressed, setWorkspaceFallbackSuppressed] = useState(false);
  const chatAgentId = useModelRouter
    ? selectedAgentId || sessionAgentId || undefined
    : selectedAgentId;
  const {
    messages,
    isLoading,
    sendMessage,
    stopGenerating,
    clearChat,
    loadSession,
    sessionId,
    workspaceDir,
    setWorkspaceDir,
    revertToMessage,
  } = useChat(chatAgentId, { useModelRouter });
  const goalController = useSessionGoal(sessionId || undefined);
  const { data: environmentSubagents = [] } = useSubagents(sessionId);
  const typedMessages = messages as ChatMessage[];
  const turnStartedAtMsByIndex = useMemo(() => {
    const lookup = new Map<number, number | undefined>();
    let latestUserTimestampMs: number | undefined;
    for (let index = 0; index < typedMessages.length; index += 1) {
      const message = typedMessages[index];
      lookup.set(index, latestUserTimestampMs);
      if (message?.role === "user") {
        const timestampMs = parseTimestampMs(message.timestamp);
        if (typeof timestampMs === "number") {
          latestUserTimestampMs = timestampMs;
        }
      }
    }
    return lookup;
  }, [typedMessages]);
  const visibleMessageEntries = useMemo(
    () =>
      typedMessages
        .map((message, originalIndex) => ({
          message,
          originalIndex,
          turnStartedAtMs: turnStartedAtMsByIndex.get(originalIndex),
        }))
        .filter((entry) => entry.message.role !== "system"),
    [typedMessages, turnStartedAtMsByIndex]
  );
  const loadSessionMutation = useLoadSession();
  const updateSessionAgent = useUpdateSessionAgent();
  const refreshSessionMessagesRef = useRef<
    (
      sid: string,
      pendingChatIds?: readonly string[],
      mode?: "completion" | "latest"
    ) => Promise<ChatMessage[] | null>
  >(() => Promise.resolve(null));
  const [input, setInput] = useState("");
  const {
    dictating,
    error: dictationError,
    handleToggle: handleToggleDictation,
    runtime: dictationRuntime,
    status: dictationStatus,
    transcribing: dictationTranscribing,
  } = useChatDictation(setInput);
  const {
    addAttachmentFiles,
    consumeAttachments,
    handleComposerDrop,
    handleComposerPaste,
    imageDragActive,
    pendingFiles,
    pendingImages,
    removePendingFile,
    removePendingImage,
    setImageDragActive,
  } = useChatAttachments();
  const {
    copiedMessageIndex,
    handleCopyMessage,
    handleReadAloud,
    imageLightbox,
    messagesContainerRef,
    openChatImage,
    setImageLightbox,
    speakingMessageIndex,
  } = useChatMessageActions();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [forkingMessageIndex, setForkingMessageIndex] = useState<number | null>(null);
  const [showNearbyShare, setShowNearbyShare] = useState(false);
  const [savingGoldenMessageIndex, setSavingGoldenMessageIndex] = useState<number | null>(null);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const { data: nearbyStatus } = useNearbyStatus(Boolean(sessionId));
  const nearbySharingEnabled = canShareNearbySession(sessionId, nearbyStatus);
  const [reverting, setReverting] = useState(false);
  const chatAppearance = useUIStore((state) => state.chatAppearance);
  const showEnvironmentOverview = useUIStore((state) => state.chatEnvironmentOpen);
  const setShowEnvironmentOverview = useUIStore((state) => state.setChatEnvironmentOpen);
  const {
    activeKind: activeWorkspaceKind,
    activeTabId: activeWorkspaceTab,
    closeTab: closeWorkspaceTab,
    isOpen: showWorkspacePanel,
    openTab: openWorkspaceTab,
    openFile: openWorkspaceFile,
    openBrowser: openWorkspaceBrowser,
    openSubagent: openWorkspaceSubagent,
    selectTab: setActiveWorkspaceTab,
    setOpen: setShowWorkspacePanel,
    tabs: workspaceTabs,
    toggleTab: toggleWorkspaceTab,
    updateTabTitle: updateWorkspaceTabTitle,
  } = useChatWorkspaceTabs({ sessionId });
  const handleOpenChatLink = useCallback(
    (href: string, options: ChatLinkOpenOptions): boolean => {
      const route = routeChatLink(href, options);
      if (route.kind === "preview") {
        openWorkspaceBrowser(route.url);
        return true;
      }
      if (route.kind === "external") {
        void openExternal(route.url);
        return true;
      }
      return route.kind === "blocked";
    },
    [openWorkspaceBrowser]
  );
  const [hiddenComposerPlanKey, setHiddenComposerPlanKey] = useState<string | null>(null);
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const {
    closeArtifactViewer,
    content: artifactViewerContent,
    error: artifactViewerError,
    loading: artifactViewerLoading,
    openArtifactViewer,
    rawView: artifactViewerRawView,
    setRawView: setArtifactViewerRawView,
    target: artifactViewerTarget,
  } = useArtifactViewer();
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "compacting" | "idle">(
    "idle"
  );
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const { refreshScrollToBottomVisibility, scrollToBottom, showScrollToBottomButton } =
    useChatScroll({
      artifactViewerOpen: artifactViewerTarget !== null,
      isLoading,
      liveActivities,
      liveCurrentStep,
      messages: typedMessages,
      messagesContainerRef,
      streamingContent,
    });
  const [liveRunStartedAtMs, setLiveRunStartedAtMs] = useState<number | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingChatMessage[]>([]);
  const [sessionContextUsage, setSessionContextUsage] = useState<SessionContextUsage | null>(null);
  const [sessionTokenUsage, setSessionTokenUsage] = useState<SessionTokenUsage | null>(null);
  const [timeToFirstTokenMs, setTimeToFirstTokenMs] = useState<number | null>(null);
  const ttftStartRef = useRef<number | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [restoringInitialSession, setRestoringInitialSession] = useState(
    !initialChatRoute.startFresh
  );
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalMode>("always_allow");
  const [followUpBehaviorEnabled, setFollowUpBehaviorEnabled] = useState(true);
  const [goldenTurnsEnabled, setGoldenTurnsEnabled] = useState(true);
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const [codexFastMode, setCodexFastMode] = useState(false);
  const [savingCodexFastMode, setSavingCodexFastMode] = useState(false);
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [composerHeight, setComposerHeight] = useState(88);
  const [messageProcessMap, setMessageProcessMap] = useState<Record<string, LiveActivityItem[]>>(
    () => readPersistedMessageProcessMap()
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const restoreSessionGenerationRef = useRef(0);
  const suppressAutoRestoreRef = useRef(false);
  const loadingRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const optimisticPendingMessageCounterRef = useRef(0);
  const acceptEventsUntilRef = useRef(0);
  const runStartSyncedSessionsRef = useRef<Set<string>>(new Set());
  const pendingProcessCaptureRef = useRef<PendingProcessCapture | null>(null);
  const runActivityBufferRef = useRef<LiveActivityItem[]>([]);
  const liveActivitiesRef = useRef<LiveActivityItem[]>([]);
  const liveRunStartedAtMsRef = useRef<number | null>(null);
  const latestStatusTimestampBySessionRef = useRef<Record<string, number>>({});
  const latestRunIdBySessionRef = useRef<Record<string, string>>({});
  const eventCursorBySessionRef = useRef<Record<string, SessionEventCursor>>({});
  const stoppedRunSuppressionsRef = useRef<StoppedRunSuppressions>({});
  const configuredWorkspaceDir =
    typeof info?.defaultWorkspaceDir === "string" && info.defaultWorkspaceDir.trim().length > 0
      ? info.defaultWorkspaceDir.trim()
      : null;
  const homeWorkspaceDir =
    typeof info?.homeDir === "string" && info.homeDir.trim().length > 0
      ? info.homeDir.trim()
      : null;
  const fallbackWorkspaceDir =
    !sessionId &&
    !workspaceFallbackSuppressed &&
    (lastWorkspaceDir || configuredWorkspaceDir || homeWorkspaceDir)
      ? lastWorkspaceDir || configuredWorkspaceDir || homeWorkspaceDir
      : null;
  const effectiveWorkspaceDir = workspaceDir || fallbackWorkspaceDir || null;
  const markSessionStopped = useCallback((targetSessionId?: string | null) => {
    const key = typeof targetSessionId === "string" ? targetSessionId.trim() : "";
    markStoppedRun(
      stoppedRunSuppressionsRef.current,
      key,
      latestRunIdBySessionRef.current[key],
      Date.now(),
      STOPPED_SESSION_STATUS_SUPPRESSION_MS
    );
  }, []);
  const acceptSessionEvent = useCallback(
    (targetSessionId: string | null | undefined, identity: SessionEventIdentity): boolean => {
      const key = typeof targetSessionId === "string" ? targetSessionId.trim() : "";
      if (!key) return false;
      const decision = resolveSessionEventOrder(eventCursorBySessionRef.current[key], identity);
      if (!decision.accepted) return false;
      eventCursorBySessionRef.current[key] = decision.cursor;
      if (decision.cursor.runId) {
        latestRunIdBySessionRef.current[key] = decision.cursor.runId;
      }
      const visible = activeSessionRef.current === key;
      if (decision.runChanged) {
        clearCachedLiveSessionState(key);
        runStartSyncedSessionsRef.current.delete(key);
        if (visible) {
          const startedAt = decision.cursor.timestamp || Date.now();
          liveRunStartedAtMsRef.current = startedAt;
          setLiveRunStartedAtMs(startedAt);
          setLiveActivities([]);
          liveActivitiesRef.current = [];
          runActivityBufferRef.current = [];
          pendingProcessCaptureRef.current = null;
          setStreamingContent(null);
          setLiveCurrentStep(null);
          void refreshSessionMessagesRef.current(key, [], "latest");
        }
      } else if (visible && liveRunStartedAtMsRef.current === null) {
        const startedAt = decision.cursor.timestamp || Date.now();
        liveRunStartedAtMsRef.current = startedAt;
        setLiveRunStartedAtMs(startedAt);
      }
      return true;
    },
    []
  );
  const isSessionStopSuppressed = useCallback(
    (targetSessionId?: string | null, runId?: string | null) =>
      isStoppedRunSuppressed(stoppedRunSuppressionsRef.current, targetSessionId, runId, Date.now()),
    []
  );
  const {
    summary: sessionFileChanges,
    loading: sessionFileChangesLoading,
    error: sessionFileChangesError,
    refresh: refreshSessionFileChanges,
  } = useSessionFileChanges(
    sessionId,
    typedMessages,
    liveActivities,
    showWorkspacePanel && activeWorkspaceKind === "review"
  );
  const currentSessionPlan = useMemo(
    () => extractLatestPlanFromMessages(typedMessages, sessionId),
    [typedMessages, sessionId]
  );
  const currentSessionPlanKey = useMemo(() => {
    if (!currentSessionPlan) return null;
    return [
      sessionId || "new-chat",
      currentSessionPlan.updatedAt || "",
      currentSessionPlan.summary.completed,
      currentSessionPlan.summary.inProgress,
      currentSessionPlan.summary.pending,
      currentSessionPlan.summary.total,
      currentSessionPlan.items.map((item) => `${item.status}:${item.content}`).join("|"),
    ].join(":");
  }, [currentSessionPlan, sessionId]);
  const currentSessionIsActive = !!sessionId && activeSessionIds.includes(sessionId);
  const currentSessionIsWorking = isLiveSessionRunning(
    sessionId,
    activeSessionIds,
    isLoading,
    loadingSessionId
  );
  const showComposerPlan =
    shouldShowSessionPlanInComposer(
      currentSessionPlan,
      currentSessionIsWorking,
      liveRunStartedAtMs
    ) && currentSessionPlanKey !== hiddenComposerPlanKey;
  const [dismissedEnvironmentPlanKey, setDismissedEnvironmentPlanKey] = useState<string | null>(
    null
  );
  const environmentPlan =
    currentSessionPlanKey && currentSessionPlanKey === dismissedEnvironmentPlanKey
      ? null
      : currentSessionPlan;
  const dismissEnvironmentPlan = useCallback(() => {
    if (currentSessionPlanKey) setDismissedEnvironmentPlanKey(currentSessionPlanKey);
  }, [currentSessionPlanKey]);
  const environmentToolNames = useMemo(() => {
    const names = new Set<string>();
    for (const message of typedMessages) {
      for (const toolCall of message.tool_calls || []) {
        if (toolCall.name.trim().length > 0) {
          names.add(toolCall.name);
        }
      }
    }
    return Array.from(names).slice(0, 24);
  }, [typedMessages]);
  const agentUsingBrowser = useMemo(() => {
    const sessionActive = !!sessionId && activeSessionIds.includes(sessionId);
    return isAgentUsingBrowser(liveActivities, sessionActive);
  }, [activeSessionIds, liveActivities, sessionId]);
  const resolveSelectableSessionAgentId = useCallback(
    (agentId?: string | null): string | undefined => {
      if (typeof agentId !== "string") return undefined;
      const trimmed = agentId.trim();
      if (!trimmed || trimmed === "default") return undefined;
      return agents.some((agent) => agent.id === trimmed) ? trimmed : undefined;
    },
    [agents]
  );
  const activeAgentForPlan = useMemo(
    () => agents.find((agent) => agent.id === (selectedAgentId || sessionAgentId || "")) ?? null,
    [agents, selectedAgentId, sessionAgentId]
  );
  const activeProviderPlan = useMemo(() => {
    if (useModelRouter) return null;
    if (!providerPlanStatus || !activeAgentForPlan) return null;
    const keys = new Set(
      [
        activeAgentForPlan.provider_id,
        activeAgentForPlan.provider,
        activeAgentForPlan.fallback_provider_id,
      ].filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    return (
      providerPlanStatus.providers.find((plan) =>
        [plan.configuredProviderId, plan.providerId, plan.providerType].some(
          (key) => typeof key === "string" && keys.has(key)
        )
      ) ?? null
    );
  }, [activeAgentForPlan, providerPlanStatus, useModelRouter]);
  const environmentGit = useEnvironmentGitBranches(effectiveWorkspaceDir);
  const syncSessionAgentSelection = useCallback(
    (agentId?: string | null) => {
      const normalized = typeof agentId === "string" && agentId.trim() ? agentId.trim() : null;
      setSessionAgentId(normalized);
      setSelectedAgentId(resolveSelectableSessionAgentId(normalized));
    },
    [resolveSelectableSessionAgentId]
  );

  const handleForkSession = useCallback(
    async (messageIndex: number) => {
      if (!sessionId || forkingMessageIndex !== null) return;
      setForkingMessageIndex(messageIndex);
      try {
        const response = await chatApi.forkSession(sessionId, {
          throughMessageIndex: messageIndex,
        });
        if (!response.success || !response.data?.fork) {
          throw new Error(response.error || "Failed to fork chat");
        }
        const fork = response.data.fork;
        const detail = await loadSessionMutation.loadFresh(fork.sessionId);
        if (!detail?.messagesList) throw new Error("Forked chat could not be loaded");
        loadSession(fork.sessionId, detail.messagesList as ChatMessage[], fork.workspaceDir);
        syncSessionAgentSelection(fork.agentId);
        navigate(`/chat?session=${encodeURIComponent(fork.sessionId)}`, {
          replace: true,
        });
        useUIStore.getState().addToast("success", "Forked chat from this point");
      } catch (error) {
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Failed to fork chat");
      } finally {
        setForkingMessageIndex(null);
      }
    },
    [
      forkingMessageIndex,
      loadSession,
      loadSessionMutation,
      navigate,
      sessionId,
      syncSessionAgentSelection,
    ]
  );

  const handleSaveGolden = useCallback(
    async (messageIndex: number) => {
      if (!sessionId || savingGoldenMessageIndex !== null) return;
      setSavingGoldenMessageIndex(messageIndex);
      try {
        const response = await chatApi.saveGolden(sessionId, { messageIndex });
        if (!response.success || !response.data?.golden) {
          throw new Error(response.error || "Failed to save golden test");
        }
        void queryClient.invalidateQueries({ queryKey: ["agent-evals"] });
        useUIStore.getState().addToast("success", "Saved turn as a golden test");
      } catch (error) {
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Failed to save golden test");
      } finally {
        setSavingGoldenMessageIndex(null);
      }
    },
    [queryClient, savingGoldenMessageIndex, sessionId]
  );

  useEffect(() => {
    setLastWorkspaceDir(readPersistedWorkspaceDir());
  }, []);

  useEffect(() => {
    if (!workspaceDir) return;
    setWorkspaceFallbackSuppressed(false);
    persistWorkspaceDir(workspaceDir);
    setLastWorkspaceDir(workspaceDir);
  }, [workspaceDir]);

  useEffect(() => {
    if (sessionId) {
      persistSessionId(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    const loadRouterConfig = async () => {
      try {
        const response = await apiFetch("/api/router/config");
        if (!active) return;
        const data = await response.json();
        setModelRouterEnabled(data?.enabled === true);
        if (data?.enabled !== true) {
          setUseModelRouter(false);
        }
      } catch {
        if (active) {
          setModelRouterEnabled(false);
          setUseModelRouter(false);
        }
      }
    };
    const loadProviderPlans = async () => {
      const response = await providerPlansApi.status();
      if (!active) return;
      setProviderPlanStatus(response.success ? (response.data ?? null) : null);
    };
    void loadRouterConfig();
    void loadProviderPlans();
    const interval = window.setInterval(loadProviderPlans, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!sessionAgentId) return;
    const nextSelected = resolveSelectableSessionAgentId(sessionAgentId);
    if (!nextSelected) return;
    if (selectedAgentId === nextSelected) return;
    setSelectedAgentId(nextSelected);
  }, [resolveSelectableSessionAgentId, selectedAgentId, sessionAgentId]);

  const handleSelectAgent = useCallback(
    async (agentId?: string) => {
      if (agentId === MODEL_ROUTER_SELECTOR_VALUE) {
        if (!modelRouterEnabled) return;
        const previousUseModelRouter = useModelRouter;
        setUseModelRouter(true);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        if (!sessionId) return;
        try {
          const updated = await updateSessionAgent.mutateAsync({
            sessionId,
            useModelRouter: true,
          });
          setSessionContextUsage(updated.contextUsage ?? null);
          setSessionTokenUsage(updated.tokenUsage ?? null);
        } catch (error) {
          setUseModelRouter(previousUseModelRouter);
          console.error("Failed to update session routing:", error);
        }
        return;
      }
      const previousUseModelRouter = useModelRouter;
      const previousSelectedAgentId = selectedAgentId;
      const previousSessionAgentId = sessionAgentId;
      const nextAgentId = resolveSelectableSessionAgentId(agentId);
      setUseModelRouter(false);
      setSelectedAgentId(nextAgentId);
      setSessionAgentId(nextAgentId ?? null);

      if (!nextAgentId) {
        if (sessionId) {
          setSelectedAgentId(previousSelectedAgentId);
          setSessionAgentId(previousSessionAgentId);
          return;
        }
        setSessionAgentId(null);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        return;
      }

      if (!sessionId) {
        setSessionAgentId(nextAgentId);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        return;
      }

      try {
        const updated = await updateSessionAgent.mutateAsync({
          sessionId,
          agentId: nextAgentId,
        });
        syncSessionAgentSelection(updated.agentId);
        setSessionContextUsage(updated.contextUsage ?? null);
        setSessionTokenUsage(updated.tokenUsage ?? null);
      } catch (error) {
        setUseModelRouter(previousUseModelRouter);
        setSelectedAgentId(previousSelectedAgentId);
        setSessionAgentId(previousSessionAgentId);
        console.error("Failed to update session agent:", error);
      }
    },
    [
      resolveSelectableSessionAgentId,
      modelRouterEnabled,
      useModelRouter,
      selectedAgentId,
      sessionAgentId,
      sessionId,
      syncSessionAgentSelection,
      updateSessionAgent,
    ]
  );

  const updateCodexFastMode = useCallback(
    async (next: boolean) => {
      if (savingCodexFastMode) return;
      const previous = codexFastMode;
      setCodexFastMode(next);
      setSavingCodexFastMode(true);
      try {
        const result = await settingsApi.updateConfig({ codex_fast_mode: next });
        if (!result.success || !result.data?.success) {
          throw new Error(result.error || "Config update failed");
        }
        useUIStore.getState().addToast("success", next ? "Fast mode on" : "Fast mode off");
      } catch (error) {
        setCodexFastMode(previous);
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Failed to update fast mode");
      } finally {
        setSavingCodexFastMode(false);
      }
    },
    [codexFastMode, savingCodexFastMode]
  );

  const updateToolApprovalMode = useCallback(
    async (nextMode: ToolApprovalMode) => {
      if (nextMode === toolApprovalMode || savingToolApprovalMode) return;
      const previousMode = toolApprovalMode;
      setToolApprovalMode(nextMode);
      setSavingToolApprovalMode(true);
      try {
        const result = await settingsApi.updateConfig({
          tool_approval_mode: nextMode,
        });
        if (!result.success || !result.data?.success) {
          throw new Error(result.error || "Config update failed");
        }
        useUIStore
          .getState()
          .addToast(
            "success",
            nextMode === "ask"
              ? "Tool approvals set to Ask Me"
              : "Tool approvals set to Always Allow"
          );
      } catch (error) {
        setToolApprovalMode(previousMode);
        useUIStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Failed to update tool approval mode"
          );
      } finally {
        setSavingToolApprovalMode(false);
      }
    },
    [savingToolApprovalMode, toolApprovalMode]
  );

  useEffect(() => {
    let mounted = true;
    const loadChatSettings = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        setToolApprovalMode(normalizeToolApprovalMode(result.data?.tool_approval_mode));
        setFollowUpBehaviorEnabled(result.data?.follow_up_behavior_enabled !== false);
        setCodexFastMode(result.data?.codex_fast_mode === true);
        const lab = result.data?.lab;
        const labRecord =
          lab && typeof lab === "object" && !Array.isArray(lab)
            ? (lab as Record<string, unknown>)
            : {};
        setGoldenTurnsEnabled(
          labRecord.enabled !== false && labRecord.goldenTurnsEnabled !== false
        );
      } catch {}
    };
    void loadChatSettings();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    persistMessageProcessMap(messageProcessMap);
  }, [messageProcessMap]);

  useEffect(() => {
    if (!sessionId || typedMessages.length === 0) return;
    setMessageProcessMap((previous) => {
      let changed = false;
      const next: Record<string, LiveActivityItem[]> = { ...previous };
      for (let index = 0; index < typedMessages.length; index += 1) {
        const message = typedMessages[index];
        if (!message || message.role !== "assistant") continue;
        const canonicalKey = getMessageProcessKey(sessionId, message, index);
        if (Array.isArray(next[canonicalKey]) && next[canonicalKey].length > 0) {
          continue;
        }
        const legacyKey = getLegacyMessageProcessKey(sessionId, message, index);
        const legacy = next[legacyKey];
        if (!Array.isArray(legacy) || legacy.length === 0) continue;
        next[canonicalKey] = legacy.map((activity) => ({ ...activity }));
        changed = true;
        continue;
      }

      for (let index = 0; index < typedMessages.length; index += 1) {
        const message = typedMessages[index];
        if (!message || message.role !== "assistant") continue;
        const canonicalKey = getMessageProcessKey(sessionId, message, index);
        if (Array.isArray(next[canonicalKey]) && next[canonicalKey].length > 0) {
          continue;
        }
        const messageTimestampMs = parseTimestampMs(message.timestamp);
        const turnStartedAtMs = turnStartedAtMsByIndex.get(index);
        const embedded = normalizeMessageProcessActivities(
          message.process_activities,
          messageTimestampMs ?? turnStartedAtMs
        );
        if (embedded.length === 0) continue;
        next[canonicalKey] = embedded;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [sessionId, typedMessages, turnStartedAtMsByIndex]);

  useEffect(() => {
    activeSessionRef.current = sessionId;
    loadingRef.current = isLoading;
  }, [sessionId, isLoading]);

  useEffect(() => {
    const assistantCount = typedMessages.reduce(
      (count, message) => count + (message.role === "assistant" ? 1 : 0),
      0
    );

    if (isLoading && !wasLoadingRef.current) {
      const startedAt = Date.now();
      liveRunStartedAtMsRef.current = startedAt;
      setLiveRunStartedAtMs(startedAt);
      setLoadingSessionId(sessionId ?? null);
      runActivityBufferRef.current = [];
      setLiveActivities([]);
      setLiveStatus("thinking");
      setLiveCurrentStep("Thinking...");
      acceptEventsUntilRef.current = 0;
      pendingProcessCaptureRef.current = {
        assistantCountBefore: assistantCount,
        activities: [],
        sessionId,
        agentId: selectedAgentId,
        createdAt: Date.now(),
      };
    }

    if (!isLoading && wasLoadingRef.current) {
      setLoadingSessionId(null);
      acceptEventsUntilRef.current = Date.now() + 1500;
      const pendingActivities = pendingProcessCaptureRef.current?.activities || [];
      const runActivities = mergeActivityLists(
        mergeActivityLists(pendingActivities, runActivityBufferRef.current),
        liveActivities
      );
      if (pendingProcessCaptureRef.current) {
        pendingProcessCaptureRef.current = {
          ...pendingProcessCaptureRef.current,
          activities: runActivities.map((activity) => ({ ...activity })),
          createdAt: Date.now(),
        };
      } else if (runActivities.length > 0) {
        pendingProcessCaptureRef.current = {
          assistantCountBefore: assistantCount,
          activities: runActivities.map((activity) => ({ ...activity })),
          sessionId,
          agentId: selectedAgentId,
          createdAt: Date.now(),
        };
      }
    }

    wasLoadingRef.current = isLoading;
  }, [isLoading, liveActivities, sessionId, selectedAgentId, typedMessages]);

  useEffect(() => {
    const pending = pendingProcessCaptureRef.current;
    if (!pending) return;
    if (currentSessionIsWorking && !isLoading) return;

    if (!isLoading && Date.now() - pending.createdAt > PENDING_CAPTURE_TIMEOUT_MS) {
      pendingProcessCaptureRef.current = null;
      return;
    }

    const sessionMismatch = !!pending.sessionId && !!sessionId && pending.sessionId !== sessionId;
    if (sessionMismatch) {
      pendingProcessCaptureRef.current = null;
      return;
    }

    const assistantEntries = typedMessages
      .map((message, index) => ({ message, index }))
      .filter((entry) => entry.message.role === "assistant");

    let target =
      assistantEntries.length > pending.assistantCountBefore
        ? assistantEntries[pending.assistantCountBefore]
        : undefined;
    if (!target && !isLoading && assistantEntries.length > 0) {
      const cutoffTimestamp = pending.createdAt - 5000;
      target =
        assistantEntries.find((entry) => {
          const messageTimestamp = parseTimestampMs(entry.message.timestamp);
          return typeof messageTimestamp === "number" && messageTimestamp >= cutoffTimestamp;
        }) || assistantEntries[assistantEntries.length - 1];
    }
    if (!target) {
      return;
    }

    const processKey = getMessageProcessKey(sessionId, target.message, target.index);
    const legacyProcessKey = getLegacyMessageProcessKey(sessionId, target.message, target.index);
    const targetTurnStartedAtMs = turnStartedAtMsByIndex.get(target.index);
    const embeddedActivities = normalizeMessageProcessActivities(
      target.message.process_activities,
      parseTimestampMs(target.message.timestamp) ?? targetTurnStartedAtMs
    );
    const captureActivities = suppressRecoveredWebFailureActivities(
      mergeActivityLists(
        mergeActivityLists(pending.activities, runActivityBufferRef.current),
        liveActivities
      ),
      target.message.tool_calls
    );
    const fallbackToolActivities =
      embeddedActivities.length === 0
        ? buildActivitiesFromToolCalls(target.message.tool_calls, formatToolIntent, {
            baseTimestampMs:
              parseTimestampMs(target.message.timestamp) ?? targetTurnStartedAtMs ?? 0,
          })
        : [];
    const mergedActivities =
      embeddedActivities.length > 0
        ? mergeActivityLists(captureActivities, embeddedActivities)
        : mergeActivityLists(captureActivities, fallbackToolActivities);
    const finalizedActivities = finalizeCompletedActivities(mergedActivities);

    if (finalizedActivities.length > 0) {
      setMessageProcessMap((previous) => {
        const next: Record<string, LiveActivityItem[]> = {
          ...previous,
          [processKey]: finalizedActivities,
        };
        if (legacyProcessKey in next && legacyProcessKey !== processKey) {
          delete next[legacyProcessKey];
        }
        return next;
      });
    }

    pendingProcessCaptureRef.current = null;
    runActivityBufferRef.current = [];
    setLiveActivities([]);
    setLiveCurrentStep(null);
  }, [
    currentSessionIsWorking,
    isLoading,
    liveActivities,
    sessionId,
    typedMessages,
    turnStartedAtMsByIndex,
  ]);

  const { hydrateSessionStatus } = useChatLiveSessionRuntime({
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
    loadFreshSession: loadSessionMutation.loadFresh,
    loadSession,
    syncSessionAgentSelection,
    setUseModelRouter,
  });

  const resetChatSession = useCallback(
    (options?: { resetAgentSelection?: boolean }) => {
      suppressAutoRestoreRef.current = true;
      activeSessionRef.current = null;
      restoreSessionGenerationRef.current += 1;
      loadingRef.current = false;
      setLoadingSessionId(null);
      setLiveActivities([]);
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      setStreamingContent("");
      liveRunStartedAtMsRef.current = null;
      setLiveRunStartedAtMs(null);
      setPendingMessages([]);
      setSessionContextUsage(null);
      setSessionTokenUsage(null);
      setTimeToFirstTokenMs(null);
      ttftStartRef.current = null;
      persistSessionId(null);
      clearChat();
      if (options?.resetAgentSelection) {
        setSessionAgentId(null);
        setSelectedAgentId(undefined);
        setUseModelRouter(false);
      }
    },
    [clearChat]
  );

  useEffect(() => {
    const handleAction = (action: AppHotkeyActionId) => {
      if (action === "newChat") {
        resetChatSession({ resetAgentSelection: true });
        window.requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      if (action === "focusComposer") {
        inputRef.current?.focus();
        return;
      }
      if (action === "toggleWorkspace") {
        setShowWorkspacePanel((value) => !value);
      }
    };
    const onHotkey = (event: Event) => {
      handleAction((event as CustomEvent<AppHotkeyActionId>).detail);
    };
    window.addEventListener(APP_HOTKEY_EVENT, onHotkey);
    const pending = consumePendingChatHotkey();
    if (pending) window.requestAnimationFrame(() => handleAction(pending));
    return () => window.removeEventListener(APP_HOTKEY_EVENT, onHotkey);
  }, [resetChatSession]);

  useEffect(() => {
    const inputEl = inputRef.current;
    if (!inputEl) return;
    inputEl.style.height = "0px";
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 220)}px`;
  }, [input]);

  useEffect(() => {
    const composerEl = composerRef.current;
    if (!composerEl) return;

    const updateComposerHeight = () => {
      const nextHeight = composerEl.offsetHeight;
      setComposerHeight((previous) => (previous === nextHeight ? previous : nextHeight));
    };

    updateComposerHeight();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        updateComposerHeight();
      });
      observer.observe(composerEl);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateComposerHeight);
    return () => window.removeEventListener("resize", updateComposerHeight);
  }, []);

  const canQueueCurrentMessage = useCallback(() => {
    return isLiveSessionRunning(
      sessionId,
      activeSessionIds,
      loadingRef.current || isLoading,
      loadingSessionId
    );
  }, [activeSessionIds, isLoading, loadingSessionId, sessionId]);

  const handleSend = async () => {
    suppressAutoRestoreRef.current = false;
    const trimmedInput = input.trim();
    const isGoalCommand =
      /^\/(?:goal|loop)\b/i.test(trimmedInput) || /^\/(?:goal|loop)\s+/i.test(trimmedInput);
    const currentMessageWouldQueue =
      !isGoalCommand && (canQueueCurrentMessage() || pendingMessages.length > 0);
    const requestedQueueMode =
      followUpBehaviorEnabled && currentMessageWouldQueue ? "queue" : undefined;
    const requestSessionId = requestedQueueMode
      ? sessionId || activeSessionRef.current
      : sessionId || activeSessionRef.current || crypto.randomUUID();
    const queueMode = requestedQueueMode && requestSessionId ? "queue" : undefined;
    const hasAttachments = pendingImages.length > 0 || pendingFiles.length > 0;
    if (
      (!input.trim() && !hasAttachments) ||
      (currentMessageWouldQueue && !queueMode) ||
      (isLoading && !queueMode)
    )
      return;
    const { images, message } = consumeAttachments(input);
    setInput("");
    let optimisticPendingMessageId: string | null = null;
    if (queueMode && requestSessionId) {
      const now = Date.now();
      optimisticPendingMessageCounterRef.current += 1;
      optimisticPendingMessageId = `optimistic-${now}-${optimisticPendingMessageCounterRef.current}`;
      setPendingMessages((previous) =>
        normalizePendingChatMessages([
          ...previous,
          {
            id: optimisticPendingMessageId!,
            sessionId: requestSessionId,
            clientPendingId: optimisticPendingMessageId,
            content: message,
            createdAt: now,
            updatedAt: now,
            mode: "queued",
            sequence:
              previous.reduce((max, pending) => Math.max(max, pending.sequence || 0), 0) + 1,
          },
        ])
      );
    } else if (!queueMode) {
      loadingRef.current = true;
      activeSessionRef.current = requestSessionId;
      ttftStartRef.current = performance.now();
      setTimeToFirstTokenMs(null);
      if (requestSessionId) {
        persistSessionId(requestSessionId);
      }
      setLoadingSessionId(requestSessionId);
    }
    try {
      const response = await sendMessage(message, {
        workspaceDir: effectiveWorkspaceDir,
        queueMode,
        sessionId: requestSessionId || undefined,
        clientPendingId: optimisticPendingMessageId || undefined,
        images: images.length ? images : undefined,
      });
      if (requestSessionId && activeSessionRef.current !== requestSessionId) return;
      if (response?.queued) {
        setPendingMessages(normalizePendingChatMessages(response.pendingMessages));
        return;
      }
      if (optimisticPendingMessageId) {
        setPendingMessages((previous) =>
          previous.filter((pending) => pending.id !== optimisticPendingMessageId)
        );
      }
      if (isGoalCommand) {
        await goalController.refresh();
      }
      if (response && typeof response === "object" && "agent" in response) {
        const responseRecord = response as Record<string, unknown>;
        const responseAgent =
          responseRecord.agent && typeof responseRecord.agent === "object"
            ? (responseRecord.agent as Record<string, unknown>)
            : null;
        const resolvedAgentId =
          responseAgent && typeof responseAgent.id === "string" ? responseAgent.id : null;
        syncSessionAgentSelection(resolvedAgentId);
      }
      if (response && typeof response === "object" && "contextUsage" in response) {
        const usage = (response as { contextUsage?: SessionContextUsage }).contextUsage;
        setSessionContextUsage(usage ?? null);
      }
      if (response && typeof response === "object" && "tokenUsage" in response) {
        const usage = (response as { tokenUsage?: SessionTokenUsage }).tokenUsage;
        setSessionTokenUsage(usage ?? null);
      }
    } catch (error) {
      if (optimisticPendingMessageId) {
        setPendingMessages((previous) =>
          previous.filter((pending) => pending.id !== optimisticPendingMessageId)
        );
      }
      if (isGoalCommand) {
        await goalController.refresh();
      }
      throw error;
    }
  };

  const {
    steeringMessageId,
    pendingMessageMutationId,
    handleSteerPendingMessage,
    handleReorderPendingMessages,
    handleUpdatePendingMessage,
    handleDeletePendingMessage,
  } = useChatPendingMutations({
    sessionId,
    pendingMessages,
    setPendingMessages,
    liveActivities,
    setLiveActivities,
    runActivityBufferRef,
    pendingProcessCaptureRef,
    loadSteeredSession: loadSessionMutation.mutateAsync,
    loadSession,
    syncSessionAgentSelection,
    setSessionContextUsage,
    setSessionTokenUsage,
  });

  const handleGoalStatus = useCallback(
    async (action: "pause" | "resume" | "complete" | "clear") => {
      if (!sessionId) return;
      try {
        await goalController.updateStatus(action);
      } catch (error) {
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Failed to update goal");
      }
    },
    [sessionId, goalController]
  );

  useEffect(() => {
    if (!streamingContent || isLoading) return;
    const latestMessage = typedMessages[typedMessages.length - 1];
    if (latestMessage?.role === "assistant") {
      setStreamingContent(null);
    }
  }, [isLoading, streamingContent, typedMessages]);

  const handleStopActive = useCallback(async () => {
    const activeChatSessionId = sessionId || activeSessionRef.current;
    if (!activeChatSessionId || isStoppingSession) return;
    setIsStoppingSession(true);
    markSessionStopped(activeChatSessionId);
    stopGenerating(activeChatSessionId);
    try {
      const stopped = await chatApi.stopSession(activeChatSessionId);
      if (!stopped.success || !stopped.data?.stopped) {
        throw new Error(stopped.error || stopped.data?.error || "No active response was found");
      }
      const refreshed = await refreshSessionMessagesRef.current(activeChatSessionId);
      if (!refreshed) {
        throw new Error("Stopped response could not be reloaded");
      }
      setActiveSessionIds((previous) => previous.filter((id) => id !== activeChatSessionId));
      clearCachedLiveSessionState(activeChatSessionId);
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      setLiveActivities([]);
      setLoadingSessionId(null);
      runActivityBufferRef.current = [];
      pendingProcessCaptureRef.current = null;
    } catch (error) {
      console.error("Failed to stop active chat session:", error);
      useUIStore
        .getState()
        .addToast("error", error instanceof Error ? error.message : "Failed to stop response");
    } finally {
      setIsStoppingSession(false);
    }
  }, [isStoppingSession, markSessionStopped, sessionId, stopGenerating]);

  const {
    workspaceSaving,
    showWorkspacePicker,
    setShowWorkspacePicker,
    diffPanelWidth,
    selectedDiffPath,
    setSelectedDiffPath,
    applySessionWorkspace,
    handleSelectWorkspace,
    handleOpenWorkspaceInCybaraIde,
    handleOpenPathInIde,
    handleOpenDiffFileInWorkspace,
    handleDiffPanelResizeStart,
  } = useChatWorkspaceActions({
    sessionId,
    workspaceDir,
    setWorkspaceDir,
    setLastWorkspaceDir,
    effectiveWorkspaceDir,
    navigate,
    openWorkspaceFile,
    sessionFileChanges,
  });
  const handleClearWorkspace = useCallback(() => {
    setWorkspaceFallbackSuppressed(true);
    void applySessionWorkspace(null);
  }, [applySessionWorkspace]);

  const handleViewSubagentSession = useCallback(
    async (sessionKey: string): Promise<void> => {
      try {
        const result = await loadSessionMutation.mutateAsync(sessionKey);
        if (!result?.messagesList) return;
        activeSessionRef.current = sessionKey;
        setUseModelRouter(false);
        loadSession(
          sessionKey,
          result.messagesList as ChatMessage[],
          (result as { workspace_dir?: string | null }).workspace_dir || null
        );
        syncSessionAgentSelection((result as { agent_id?: string | null }).agent_id || null);
        setSessionContextUsage(
          (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
        );
        setSessionTokenUsage(
          (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
        );
        setShowWorkspacePanel(false);
      } catch (error) {
        console.error("Failed to load subagent session:", error);
      }
    },
    [loadSession, loadSessionMutation, syncSessionAgentSelection]
  );

  const capabilityPicker = useChatCapabilityPicker({
    input,
    setInput,
    inputRef,
    workspaceDir: effectiveWorkspaceDir,
    onSend: handleSend,
  });

  const handleConfirmRevert = useCallback(async () => {
    if (!revertTarget) return;
    try {
      setReverting(true);
      const result = await revertToMessage({
        index: revertTarget.index,
        content: revertTarget.content,
        timestamp: revertTarget.timestamp,
      });
      setInput(result.revertedMessage?.content ?? revertTarget.content);
      setLiveActivities([]);
      setMessageProcessMap({});
      pendingProcessCaptureRef.current = null;
      setLiveStatus("idle");
      setLiveCurrentStep(null);
      setLoadingSessionId(null);
      setRevertTarget(null);
      inputRef.current?.focus();
    } catch (error) {
      console.error("Failed to revert session:", error);
    } finally {
      setReverting(false);
    }
  }, [revertTarget, revertToMessage]);

  useEffect(() => {
    const sessionParam = initialChatRoute.sessionId;
    const persistedSessionId = readPersistedSessionId();
    const restoreGeneration = restoreSessionGenerationRef.current;
    const isRestorableChatSessionId = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0 && !value.startsWith("agent:");
    const restoreSessionFromId = async (
      targetSessionId: string,
      options?: { replaceRoute?: boolean }
    ) => {
      if (!targetSessionId || targetSessionId === sessionId) return true;
      const applyRestoredSession = (result: LoadedChatSession) => {
        activeSessionRef.current = targetSessionId;
        loadSession(
          targetSessionId,
          result.messagesList as ChatMessage[],
          result.workspace_dir || null
        );
        syncSessionAgentSelection(result.agent_id || null);
        setUseModelRouter(result.use_model_router === true);
        setSessionContextUsage(
          (result as { contextUsage?: SessionContextUsage | null }).contextUsage || null
        );
        setSessionTokenUsage(
          (result as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
        );
      };
      try {
        const cached = loadSessionMutation.getCached(targetSessionId);
        if (cached?.messagesList) applyRestoredSession(cached);
        const statusHydration = hydrateSessionStatus(targetSessionId);
        const result = await loadSessionMutation.loadFresh(targetSessionId);
        if (!result?.messagesList) return false;
        if (
          restoreSessionGenerationRef.current !== restoreGeneration ||
          (activeSessionRef.current !== null && activeSessionRef.current !== targetSessionId)
        ) {
          return true;
        }
        applyRestoredSession(result);
        await statusHydration;
        if (options?.replaceRoute) {
          window.history.replaceState({}, "", "/chat");
        }
        return true;
      } catch (error) {
        console.error("Failed to restore chat session:", error);
        return false;
      }
    };
    const resolveFreshestActiveSessionId = async () => {
      try {
        const response = await chatApi.getSessionStatus();
        if (!response.success || !response.data) return null;
        const payload = response.data as SessionStatusResponse;
        const activeSnapshots = Array.isArray(payload.activeSessions) ? payload.activeSessions : [];
        const activeIds = Array.isArray(payload.activeSessionIds) ? payload.activeSessionIds : [];
        setActiveSessionIds(activeIds.filter(isRestorableChatSessionId));
        if (restoreSessionGenerationRef.current !== restoreGeneration || activeSessionRef.current) {
          return null;
        }
        return (
          activeSnapshots
            .filter((snapshot) => isRestorableChatSessionId(snapshot.sessionId))
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]?.sessionId ||
          activeIds.find(isRestorableChatSessionId) ||
          null
        );
      } catch (error) {
        console.error("Failed to inspect active chat sessions:", error);
        return null;
      }
    };

    void (async () => {
      try {
        if (initialChatRoute.startFresh) {
          suppressAutoRestoreRef.current = true;
          persistSessionId(null);
          if (initialChatRoute.workspaceDir) {
            setWorkspaceDir(initialChatRoute.workspaceDir);
            persistWorkspaceDir(initialChatRoute.workspaceDir);
            setLastWorkspaceDir(initialChatRoute.workspaceDir);
          }
          window.history.replaceState({}, "", "/chat");
          return;
        }
        if (sessionParam) {
          await restoreSessionFromId(sessionParam, { replaceRoute: true });
          return;
        }
        if (suppressAutoRestoreRef.current) return;
        if (sessionId) return;
        const activeSessionLookup = resolveFreshestActiveSessionId();
        if (persistedSessionId) {
          const restored = await restoreSessionFromId(persistedSessionId);
          if (restored) return;
          if (readPersistedSessionId() === persistedSessionId) {
            persistSessionId(null);
          }
        }
        const freshestActiveSessionId = await activeSessionLookup;
        if (!freshestActiveSessionId) return;
        persistSessionId(freshestActiveSessionId);
        await restoreSessionFromId(freshestActiveSessionId);
      } finally {
        setRestoringInitialSession(false);
      }
    })();
  }, []);

  const revertRemovedCount = revertTarget
    ? Math.max(0, typedMessages.length - revertTarget.index)
    : 0;
  const revertFollowingCount = Math.max(0, revertRemovedCount - 1);
  const pendingCapture = pendingProcessCaptureRef.current;
  const pendingCaptureForCurrentSession =
    !!pendingCapture &&
    (sessionId
      ? !pendingCapture.sessionId || pendingCapture.sessionId === sessionId
      : !pendingCapture.sessionId);
  const showWorkingTimeline = currentSessionIsWorking;
  const transcriptHasMixedAgents = hasMixedAssistantAuthors(typedMessages);
  const composerHasDraft =
    input.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0;
  const sendQueuesFollowUp =
    followUpBehaviorEnabled && (showWorkingTimeline || pendingMessages.length > 0);
  const showStopComposerButton = showWorkingTimeline && (!composerHasDraft || !sendQueuesFollowUp);
  const timelineActivities =
    liveActivities.length > 0
      ? liveActivities
      : pendingCaptureForCurrentSession
        ? pendingCapture?.activities || []
        : [];
  const timelineStatus =
    currentSessionIsActive && liveStatus === "idle" ? ("thinking" as const) : liveStatus;
  const timelineStartedAtMs = [
    liveRunStartedAtMs ?? undefined,
    pendingCaptureForCurrentSession ? pendingCapture?.createdAt : undefined,
    ...timelineActivities.map((activity) =>
      liveRunStartedAtMs && activity.timestamp + 1_000 < liveRunStartedAtMs
        ? undefined
        : activity.timestamp
    ),
  ]
    .filter(
      (timestamp): timestamp is number =>
        typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
    )
    .reduce<number | undefined>(
      (earliest, timestamp) => (earliest === undefined ? timestamp : Math.min(earliest, timestamp)),
      undefined
    );
  const chatComposerProps: ChatComposerProps = {
    activeAgent: activeAgentForPlan,
    agents,
    agentUpdating: updateSessionAgent.isPending,
    approvalMode: toolApprovalMode,
    approvalUpdating: savingToolApprovalMode,
    capabilityPicker,
    composerHasDraft,
    composerRef,
    contextUsage: sessionContextUsage,
    currentPlan: currentSessionPlan,
    currentPlanKey: currentSessionPlanKey,
    dictating,
    dictationEngine: dictationRuntime.engine,
    dictationError,
    dictationLabel: dictationRuntime.label,
    dictationStatus,
    dictationTranscribing,
    dictationUnsupportedReason: dictationRuntime.unsupportedReason,
    followUpBehaviorEnabled,
    imageDragActive,
    imageInputRef,
    horizontalPadding: chatAppearance.horizontalPadding,
    input,
    inputRef,
    isLoading,
    isStopping: isStoppingSession,
    modelRouterEnabled,
    mutatingMessageId: pendingMessageMutationId,
    pendingFiles,
    pendingImages,
    pendingMessages,
    placeholder: t("chat.composer.placeholder"),
    providerPlan: activeProviderPlan,
    queueing: sendQueuesFollowUp,
    reasoningUpdating: updateAgentReasoning.isPending,
    codexFastMode,
    codexFastModeUpdating: savingCodexFastMode,
    onCodexFastModeChange: updateCodexFastMode,
    selectedAgentId,
    showPlan: showComposerPlan,
    showStop: showStopComposerButton,
    showWorkingTimeline,
    steeringMessageId,
    useModelRouter,
    onAddAttachmentFiles: addAttachmentFiles,
    onApprovalChange: (mode) => void updateToolApprovalMode(mode),
    onDeletePendingMessage: (id) => void handleDeletePendingMessage(id),
    onDismissPlan: () => {
      if (currentSessionPlanKey) setHiddenComposerPlanKey(currentSessionPlanKey);
    },
    onDragActiveChange: setImageDragActive,
    onDrop: handleComposerDrop,
    onPaste: handleComposerPaste,
    onReasoningChange: (effort) => {
      if (!activeAgentForPlan) return;
      updateAgentReasoning.mutate(
        { id: activeAgentForPlan.id, effort },
        {
          onError: (error) => {
            useUIStore.getState().addToast("error", error.message || "Failed to update reasoning");
          },
        }
      );
    },
    onRemovePendingFile: removePendingFile,
    onRemovePendingImage: removePendingImage,
    onReorderPendingMessages: (orderedIds) => void handleReorderPendingMessages(orderedIds),
    onSelectAgent: (agentId) => void handleSelectAgent(agentId),
    onSend: handleSend,
    onSteerPendingMessage: (id) => void handleSteerPendingMessage(id),
    onStop: () => void handleStopActive(),
    onToggleDictation: () => void handleToggleDictation(),
    onUpdatePendingMessage: (id, content) => void handleUpdatePendingMessage(id, content),
  };

  return (
    <div className="h-screen flex flex-col bg-[#050508]">
      <LocalFolderPickerModal
        isOpen={showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        onSelect={applySessionWorkspace}
        defaultPath={effectiveWorkspaceDir}
        title="Select Session Workspace"
        description="Choose the local folder this chat should use for file tools, git context, and workspace-aware prompts."
      />
      <NearbyShareModal
        isOpen={showNearbyShare && nearbySharingEnabled}
        onClose={() => setShowNearbyShare(false)}
        sessionId={sessionId}
      />
      {sessionId ? (
        <ChatPageHeader
          environmentKey={sessionId || "new-chat-environment"}
          environmentOverview={{
            contextUsage: sessionContextUsage,
            currentPlan: environmentPlan,
            fileChanges: sessionFileChanges,
            gitBranch: environmentGit.currentBranch,
            gitBranchChanging: environmentGit.changingBranch,
            gitBranchError: environmentGit.error,
            gitBranchLoading: environmentGit.loading,
            gitBranches: environmentGit.branches,
            isOpen: showEnvironmentOverview,
            onCreateGitBranch: environmentGit.createAndCheckout,
            onRefreshGitBranches: environmentGit.refresh,
            onSwitchGitBranch: environmentGit.checkout,
            onOpenWorkspaceTab: openWorkspaceTab,
            previewTabs: Array.from(
              new Set(
                workspaceTabs
                  .map((instance) => instance.kind)
                  .filter(
                    (kind) =>
                      kind === "browser" ||
                      kind === "terminal" ||
                      kind === "files" ||
                      kind === "ios" ||
                      kind === "android"
                  )
              )
            ),
            agentUsingBrowser,
            timeToFirstTokenMs,
            onDismissPlan: dismissEnvironmentPlan,
            sessionId,
            subagents: environmentSubagents,
            tokenUsage: sessionTokenUsage,
            toolNames: environmentToolNames,
            workspaceDir: effectiveWorkspaceDir,
          }}
          fileReviewActive={showWorkspacePanel && activeWorkspaceKind === "review"}
          nearbyEnabled={nearbySharingEnabled}
          sessionTitle={{
            sessionId,
            messages: typedMessages,
            agentId: chatAgentId ?? selectedAgentId ?? sessionAgentId ?? undefined,
            workspaceDir: effectiveWorkspaceDir,
            useModelRouter,
            contextUsage: sessionContextUsage,
            tokenUsage: sessionTokenUsage,
            appVersion: info?.version,
            onDeleted: () => resetChatSession({ resetAgentSelection: false }),
          }}
          subagentsActive={showWorkspacePanel && activeWorkspaceKind === "subagents"}
          workspaceMenu={{
            workspaceDir: effectiveWorkspaceDir,
            workspaceSaving,
            onSelectWorkspace: () => void handleSelectWorkspace(),
            onOpenCybaraIde: handleOpenWorkspaceInCybaraIde,
          }}
          workspacePanelOpen={showWorkspacePanel}
          onOpenMultiChat={() => navigate(buildMultiChatPath([sessionId]))}
          onOpenNearbyShare={() => setShowNearbyShare(true)}
          onToggleEnvironment={() => setShowEnvironmentOverview(!showEnvironmentOverview)}
          onToggleFileReview={() => toggleWorkspaceTab("review")}
          onToggleSubagents={() => toggleWorkspaceTab("subagents")}
          onToggleWorkspacePanel={() => setShowWorkspacePanel((value) => !value)}
        />
      ) : null}

      <div className="flex-1 flex overflow-hidden">
        <div className="relative flex-1 flex flex-col min-w-0">
          <PendingApprovalsBanner />
          {artifactViewerTarget ? (
            <ArtifactViewerPanel
              artifact={artifactViewerTarget}
              loading={artifactViewerLoading}
              error={artifactViewerError}
              content={artifactViewerContent}
              rawView={artifactViewerRawView}
              onBack={closeArtifactViewer}
              onToggleView={setArtifactViewerRawView}
            />
          ) : (
            <>
              <div
                ref={messagesContainerRef}
                onScroll={refreshScrollToBottomVisibility}
                className={cn(
                  "chat-scroll-region flex-1 overflow-y-auto py-4",
                  chatHorizontalPaddingClassName(chatAppearance.horizontalPadding),
                  typedMessages.length === 0 ? "flex items-center justify-center" : "space-y-4"
                )}
              >
                {typedMessages.length === 0 ? (
                  restoringInitialSession ? (
                    <ChatSessionLoadingState />
                  ) : (
                    <ChatEmptyState
                      goalPanel={
                        sessionId ? (
                          <GoalPanel
                            goal={goalController.goal}
                            loading={goalController.loading}
                            working={currentSessionIsWorking}
                            onPause={() => void handleGoalStatus("pause")}
                            onResume={() => void handleGoalStatus("resume")}
                            onComplete={() => void handleGoalStatus("complete")}
                            onClear={() => void handleGoalStatus("clear")}
                            layout="new-chat"
                            horizontalPadding={chatAppearance.horizontalPadding}
                          />
                        ) : null
                      }
                      gitBranch={environmentGit.currentBranch}
                      gitBranchChanging={environmentGit.changingBranch}
                      gitBranchError={environmentGit.error}
                      gitBranchLoading={environmentGit.loading}
                      gitBranches={environmentGit.branches}
                      workspaceDir={effectiveWorkspaceDir}
                      workspaceSaving={workspaceSaving}
                      onCreateGitBranch={environmentGit.createAndCheckout}
                      onClearWorkspace={handleClearWorkspace}
                      onRefreshGitBranches={environmentGit.refresh}
                      onSelectWorkspace={() => void handleSelectWorkspace()}
                      onSwitchGitBranch={environmentGit.checkout}
                    >
                      <ChatComposer {...chatComposerProps} layout="new-chat" />
                    </ChatEmptyState>
                  )
                ) : (
                  <ChatMessageTimeline
                    copiedMessageIndex={copiedMessageIndex}
                    entries={visibleMessageEntries}
                    forkingMessageIndex={forkingMessageIndex}
                    goldenTurnsEnabled={goldenTurnsEnabled}
                    liveActivities={timelineActivities}
                    liveCurrentStep={liveCurrentStep}
                    liveStatus={timelineStatus}
                    liveStartedAtMs={timelineStartedAtMs}
                    messageProcessMap={messageProcessMap}
                    savingGoldenMessageIndex={savingGoldenMessageIndex}
                    sessionId={sessionId}
                    showAuthorAttribution={transcriptHasMixedAgents}
                    showWorkingTimeline={showWorkingTimeline}
                    speakingMessageIndex={speakingMessageIndex}
                    workspaceDir={effectiveWorkspaceDir}
                    onCopyMessage={(index, content) => void handleCopyMessage(index, content)}
                    onForkSession={(index) => void handleForkSession(index)}
                    onOpenArtifact={(artifact) => void openArtifactViewer(artifact)}
                    onOpenImage={openChatImage}
                    onOpenLink={handleOpenChatLink}
                    onReadAloud={(index, content) => void handleReadAloud(index, content)}
                    onRevert={setRevertTarget}
                    onSaveGolden={(index) => void handleSaveGolden(index)}
                  />
                )}
              </div>

              {showScrollToBottomButton && (
                <button
                  type="button"
                  onClick={() => scrollToBottom()}
                  className="absolute left-1/2 z-20 -translate-x-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#11131c]/95 text-white shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors hover:bg-[#1a1e2b] cursor-pointer"
                  style={{ bottom: `${Math.max(70, composerHeight + 10)}px` }}
                  title="Scroll to latest"
                  aria-label="Scroll to latest message"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}

              {typedMessages.length > 0 ? (
                <>
                  {sessionId ? (
                    <GoalPanel
                      goal={goalController.goal}
                      loading={goalController.loading}
                      working={currentSessionIsWorking}
                      onPause={() => void handleGoalStatus("pause")}
                      onResume={() => void handleGoalStatus("resume")}
                      onComplete={() => void handleGoalStatus("complete")}
                      onClear={() => void handleGoalStatus("clear")}
                      horizontalPadding={chatAppearance.horizontalPadding}
                    />
                  ) : null}
                  <ChatComposer {...chatComposerProps} />
                </>
              ) : null}
            </>
          )}
        </div>

        {sessionId && showEnvironmentOverview && !showWorkspacePanel ? (
          <div
            aria-hidden="true"
            className="hidden w-96 shrink-0 xl:block"
            data-chat-environment-reserved="true"
          />
        ) : null}

        {!artifactViewerTarget && (
          <ChatWorkspaceDock
            activeTab={activeWorkspaceTab}
            agentId={selectedAgentId || sessionAgentId || undefined}
            diffError={sessionFileChangesError}
            diffLoading={sessionFileChangesLoading}
            diffSummary={sessionFileChanges}
            isOpen={showWorkspacePanel}
            selectedDiffPath={selectedDiffPath}
            sessionId={sessionId}
            tabs={workspaceTabs}
            width={diffPanelWidth}
            workspaceDir={effectiveWorkspaceDir}
            onClose={() => setShowWorkspacePanel(false)}
            onCloseTab={closeWorkspaceTab}
            onOpenDiffInWorkspace={handleOpenDiffFileInWorkspace}
            onOpenFullIde={handleOpenPathInIde}
            onOpenLink={handleOpenChatLink}
            onOpenTab={openWorkspaceTab}
            onOpenSubagent={openWorkspaceSubagent}
            onRefreshDiff={refreshSessionFileChanges}
            onResizeStart={handleDiffPanelResizeStart}
            onSelectDiffPath={setSelectedDiffPath}
            onSelectTab={setActiveWorkspaceTab}
            onUpdateTabTitle={updateWorkspaceTabTitle}
            onViewSubagentSession={(sessionKey) => void handleViewSubagentSession(sessionKey)}
          />
        )}

        {imageLightbox ? (
          <ChatImageLightbox
            images={imageLightbox.images}
            initialIndex={imageLightbox.index}
            onClose={() => setImageLightbox(null)}
          />
        ) : null}

        <Modal
          isOpen={!!revertTarget}
          onClose={() => {
            if (!reverting) setRevertTarget(null);
          }}
          title="Confirm Revert"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              Are you sure you want to revert here? This will remove this message
              {revertFollowingCount > 0
                ? ` and ${revertFollowingCount} later message${revertFollowingCount === 1 ? "" : "s"}`
                : ""}{" "}
              from this session, then place this text back in the input box for resend.
            </p>
            {revertTarget && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase tracking-[0.08em] text-gray-500 mb-1">
                  Revert Point
                </p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {revertTarget.content.length > 220
                    ? `${revertTarget.content.slice(0, 220)}...`
                    : revertTarget.content}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setRevertTarget(null)} disabled={reverting}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleConfirmRevert()}
                disabled={reverting}
              >
                {reverting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                Revert Here
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
