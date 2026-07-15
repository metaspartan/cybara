import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Loader2, Plus, RotateCcw, Share2, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LocalFolderPickerModal } from "@/components/LocalFolderPickerModal";
import { PageLayout } from "@/components/layout";
import { Badge, Button, GlassCard, Input, Modal } from "@/components/ui";
import { useAgentSummaries, useInfo, useSubagents, useUpdateAgentReasoning } from "@/hooks/useApi";
import {
  useChat,
  useLoadSession,
  useUpdateSessionAgent,
  type LoadedChatSession,
} from "@/hooks/useChat";
import { useNearbyStatus } from "@/hooks/useNearbyStatus";
import { chatApi, providerPlansApi, settingsApi } from "@/lib/api";
import {
  APP_HOTKEY_EVENT,
  type AppHotkeyActionId,
  consumePendingChatHotkey,
} from "@/lib/appHotkeys";
import { apiFetch, appendApiTokenParam } from "@/lib/auth";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  type LiveActivityItem,
  mergeActivityLists,
  suppressRecoveredWebFailureActivities,
} from "@/lib/chatActivities";
import { loadPersistedCompletion } from "@/lib/chatCompletion";
import { isDesktopHostRuntime, openDesktopDirectoryDialog } from "@/lib/desktopHost";
import { useI18n } from "@/lib/i18n";
import {
  connectStatusStream,
  type PendingChatMessage,
  type StatusSessionSnapshot,
  type StatusStreamStatusEvent,
  type StatusStreamTokenEvent,
} from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";
import {
  resolveSessionEventOrder,
  type SessionEventCursor,
  type SessionEventIdentity,
} from "../../../shared/session-event-order";
import type {
  Agent,
  ProviderPlanSnapshot,
  ProviderPlanStatusResponse,
  SessionContextUsage,
  SessionTokenUsage,
} from "@/types";
import { LiveActivityTimeline } from "./chat/ActivityTimeline";
import { ArtifactViewerPanel } from "./chat/ArtifactViewerPanel";
import { parseTimestampMs } from "./chat/assistantMetaModel";
import { MODEL_ROUTER_SELECTOR_VALUE } from "./chat/ChatAgentControls";
import { ChatComposer, type ChatComposerProps } from "./chat/ChatComposer";
import { ChatEmptyState } from "./chat/ChatEmptyState";
import { normalizeToolApprovalMode, type ToolApprovalMode } from "./chat/ChatFollowUpControls";
import { ChatImageLightbox, type ChatLightboxImage } from "./chat/ChatImageLightbox";
import { ChatMessageTimeline } from "./chat/ChatMessageTimeline";
import { ChatPageHeader } from "./chat/ChatPageHeader";
import { ChatSessionLoadingState } from "./chat/ChatSessionLoadingState";
import { ChatWorkspaceDock } from "./chat/ChatWorkspaceDock";
import {
  type ArtifactSummaryView,
  applyLiveActivityEvent,
  buildPreSteeringActivityMessage,
  type ChatMessage,
  clampDiffPanelWidth,
  extractLatestPlanFromMessages,
  type FileChangeItem,
  type FileChangeSummary,
  formatSandboxProviderLabel,
  formatToolIntent,
  formatWorkspaceLabel,
  getLatestInFlightStep,
  getLegacyMessageProcessKey,
  getMessageProcessKey,
  isAgentUsingBrowser,
  isGenericStatusLabel,
  isMeaningfulThoughtDetail,
  isSessionPlanComplete,
  normalizeMessageProcessActivities,
  normalizeSessionStatus,
  normalizeSnapshotActivities,
  PENDING_CAPTURE_TIMEOUT_MS,
  type PendingProcessCapture,
  persistDiffPanelWidth,
  persistMessageProcessMap,
  persistSessionId,
  persistWorkspaceDir,
  pruneCanonicalizedLiveActivities,
  type RevertTarget,
  readPersistedDiffPanelWidth,
  readPersistedMessageProcessMap,
  readPersistedSessionId,
  readPersistedWorkspaceDir,
  resolvePathForIde,
  resolveStatusSnapshotActivities,
  SESSION_ACTIVITY_STALE_MS,
  type SessionStatusResponse,
  type SessionStatusSnapshot,
  type ToolCall,
  toLiveActivityItems,
} from "./chat/chatModel";
import { parseInitialChatRoute } from "./chat/chatRoute";
import { isChatNearBottom } from "./chat/chatScroll";
import { type GitBranchOption, GitBranchSelector } from "./chat/GitBranchSelector";
import {
  clearCachedLiveSessionState,
  readCachedLiveSessionState,
  writeCachedLiveSessionState,
} from "./chat/liveSessionState";
import { writeCachedSessionMessages } from "./chat/messageCache";
import { NearbyShareModal } from "./chat/NearbyShareModal";
import { PendingApprovalsBanner } from "./chat/PendingApprovalsBanner";
import {
  clearCachedOptimisticPendingMessages,
  readCachedOptimisticPendingMessages,
  writeCachedOptimisticPendingMessages,
} from "./chat/pendingQueueCache";
import { mergePendingChatMessages, normalizePendingChatMessages } from "./chat/pendingQueueState";
import { useChatAttachments } from "./chat/useChatAttachments";
import { useChatCapabilityPicker } from "./chat/useChatCapabilityPicker";
import { useChatDictation } from "./chat/useChatDictation";
import { useChatWorkspaceTabs } from "./chat/useChatWorkspaceTabs";
import { useEnvironmentGitBranches } from "./chat/useEnvironmentGitBranches";
import { useSessionFileChanges } from "./chat/useSessionFileChanges";
import {
  isStoppedRunSuppressed,
  markStoppedRun,
  type StoppedRunSuppressions,
} from "./chat/stopSuppression";

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
  const refreshSessionMessagesRef = useRef<(sid: string) => Promise<boolean>>(() =>
    Promise.resolve(false)
  );
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
  const [imageLightbox, setImageLightbox] = useState<{
    images: ChatLightboxImage[];
    index: number;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RevertTarget | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [forkingMessageIndex, setForkingMessageIndex] = useState<number | null>(null);
  const [showNearbyShare, setShowNearbyShare] = useState(false);
  const [savingGoldenMessageIndex, setSavingGoldenMessageIndex] = useState<number | null>(null);
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const { data: nearbyStatus } = useNearbyStatus(Boolean(sessionId));
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const copiedMessageTimerRef = useRef<number | null>(null);
  const handleCopyMessage = useCallback(async (index: number, content: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (error) {
        console.error("Failed to copy message:", error);
      }
    }
    if (!copied) return;
    setCopiedMessageIndex(index);
    if (copiedMessageTimerRef.current !== null) {
      window.clearTimeout(copiedMessageTimerRef.current);
    }
    copiedMessageTimerRef.current = window.setTimeout(() => {
      setCopiedMessageIndex(null);
      copiedMessageTimerRef.current = null;
    }, 1500);
  }, []);
  const handleReadAloud = useCallback(
    async (index: number, content: string) => {
      const activeAudio = speechAudioRef.current;
      if (activeAudio) {
        activeAudio.pause();
        speechAudioRef.current = null;
        setSpeakingMessageIndex(null);
        if (speakingMessageIndex === index) return;
      }
      try {
        setSpeakingMessageIndex(index);
        const result = await chatApi.synthesizeSpeech({ text: content });
        if (!result.success || !result.data?.audioPath) {
          throw new Error(result.error || "Speech synthesis failed");
        }
        const mediaUrl = appendApiTokenParam(
          `/api/media?path=${encodeURIComponent(result.data.audioPath)}`
        );
        const audio = new Audio(mediaUrl);
        speechAudioRef.current = audio;
        const clear = () => {
          if (speechAudioRef.current === audio) speechAudioRef.current = null;
          setSpeakingMessageIndex(null);
        };
        audio.addEventListener("ended", clear, { once: true });
        audio.addEventListener("error", clear, { once: true });
        await audio.play();
      } catch (error) {
        speechAudioRef.current = null;
        setSpeakingMessageIndex(null);
        useUIStore
          .getState()
          .addToast("error", error instanceof Error ? error.message : "Speech synthesis failed");
      }
    },
    [speakingMessageIndex]
  );
  const [reverting, setReverting] = useState(false);
  const [showEnvironmentOverview, setShowEnvironmentOverview] = useState(false);
  const closeEnvironmentOverview = useCallback(() => setShowEnvironmentOverview(false), []);
  const {
    activeKind: activeWorkspaceKind,
    activeTabId: activeWorkspaceTab,
    closeTab: closeWorkspaceTab,
    isOpen: showWorkspacePanel,
    openTab: openWorkspaceTab,
    openFile: openWorkspaceFile,
    selectTab: setActiveWorkspaceTab,
    setOpen: setShowWorkspacePanel,
    tabs: workspaceTabs,
    toggleTab: toggleWorkspaceTab,
    updateTabTitle: updateWorkspaceTabTitle,
  } = useChatWorkspaceTabs({ onOpen: closeEnvironmentOverview });
  const [hiddenComposerPlanKey, setHiddenComposerPlanKey] = useState<string | null>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState<number>(() => readPersistedDiffPanelWidth());
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const [artifactViewerTarget, setArtifactViewerTarget] = useState<ArtifactSummaryView | null>(
    null
  );
  const [artifactViewerLoading, setArtifactViewerLoading] = useState(false);
  const [artifactViewerError, setArtifactViewerError] = useState<string | null>(null);
  const [artifactViewerContent, setArtifactViewerContent] = useState("");
  const [artifactViewerRawView, setArtifactViewerRawView] = useState(false);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"thinking" | "generating" | "compacting" | "idle">(
    "idle"
  );
  const [liveActivities, setLiveActivities] = useState<LiveActivityItem[]>([]);
  const [liveCurrentStep, setLiveCurrentStep] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [liveRunStartedAtMs, setLiveRunStartedAtMs] = useState<number | null>(null);
  const [pendingMessages, setPendingMessages] = useState<PendingChatMessage[]>([]);
  const [sessionContextUsage, setSessionContextUsage] = useState<SessionContextUsage | null>(null);
  const [sessionTokenUsage, setSessionTokenUsage] = useState<SessionTokenUsage | null>(null);
  const [timeToFirstTokenMs, setTimeToFirstTokenMs] = useState<number | null>(null);
  const ttftStartRef = useRef<number | null>(null);
  const [steeringMessageId, setSteeringMessageId] = useState<string | null>(null);
  const [pendingMessageMutationId, setPendingMessageMutationId] = useState<string | null>(null);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [restoringInitialSession, setRestoringInitialSession] = useState(
    !initialChatRoute.startFresh
  );
  const [toolApprovalMode, setToolApprovalMode] = useState<ToolApprovalMode>("always_allow");
  const [followUpBehaviorEnabled, setFollowUpBehaviorEnabled] = useState(true);
  const [savingToolApprovalMode, setSavingToolApprovalMode] = useState(false);
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [composerHeight, setComposerHeight] = useState(88);
  const [messageProcessMap, setMessageProcessMap] = useState<Record<string, LiveActivityItem[]>>(
    () => readPersistedMessageProcessMap()
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const openChatImage = useCallback((src: string, alt: string) => {
    const nodes = Array.from(
      messagesContainerRef.current?.querySelectorAll<HTMLElement>("[data-chat-lightbox-src]") ?? []
    );
    const images = nodes
      .map((node) => ({
        src: node.dataset.chatLightboxSrc?.trim() || "",
        alt: node.dataset.chatLightboxAlt?.trim() || "Image",
      }))
      .filter((image) => image.src.length > 0);
    const index = Math.max(
      0,
      images.findIndex((image) => image.src === src && image.alt === alt)
    );
    setImageLightbox({
      images: images.length > 0 ? images : [{ src, alt }],
      index,
    });
  }, []);
  const keepScrolledToBottomRef = useRef(true);
  const programmaticScrollUntilRef = useRef(0);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const diffPanelResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const diffPanelResizeCleanupRef = useRef<(() => void) | null>(null);
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
    !sessionId && (lastWorkspaceDir || configuredWorkspaceDir || homeWorkspaceDir)
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
          void refreshSessionMessagesRef.current(key);
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
  const showComposerPlan =
    !!currentSessionPlan &&
    !isSessionPlanComplete(currentSessionPlan) &&
    currentSessionPlanKey !== hiddenComposerPlanKey;
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
        setUseModelRouter(true);
        setSessionContextUsage(null);
        setSessionTokenUsage(null);
        return;
      }
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
        setSelectedAgentId(previousSelectedAgentId);
        setSessionAgentId(previousSessionAgentId);
        console.error("Failed to update session agent:", error);
      }
    },
    [
      resolveSelectableSessionAgentId,
      modelRouterEnabled,
      selectedAgentId,
      sessionAgentId,
      sessionId,
      syncSessionAgentSelection,
      updateSessionAgent,
    ]
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
      } catch {}
    };
    void loadChatSettings();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
      speechAudioRef.current?.pause();
      speechAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    persistMessageProcessMap(messageProcessMap);
  }, [messageProcessMap]);

  useEffect(() => {
    persistDiffPanelWidth(diffPanelWidth);
  }, [diffPanelWidth]);

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
    if (!sessionFileChanges || sessionFileChanges.files.length === 0) {
      if (selectedDiffPath !== null) {
        setSelectedDiffPath(null);
      }
      return;
    }

    if (
      selectedDiffPath &&
      sessionFileChanges.files.some((file) => file.path === selectedDiffPath)
    ) {
      return;
    }

    setSelectedDiffPath(sessionFileChanges.files[0]?.path || null);
  }, [selectedDiffPath, sessionFileChanges]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;
    keepScrolledToBottomRef.current = true;
    if (behavior === "smooth") {
      programmaticScrollUntilRef.current = Number.POSITIVE_INFINITY;
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
      programmaticScrollTimeoutRef.current = window.setTimeout(() => {
        programmaticScrollTimeoutRef.current = null;
        programmaticScrollUntilRef.current = 0;
        const latestContainer = messagesContainerRef.current;
        if (!latestContainer || isChatNearBottom(latestContainer)) return;
        keepScrolledToBottomRef.current = false;
        setShowScrollToBottomButton(true);
      }, 2500);
    } else if (programmaticScrollUntilRef.current !== Number.POSITIVE_INFINITY) {
      programmaticScrollUntilRef.current = performance.now() + 100;
    }
    container.scrollTo({ top: container.scrollHeight, behavior });
    setShowScrollToBottomButton(false);
  }, []);

  const refreshScrollToBottomVisibility = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || artifactViewerTarget) {
      setShowScrollToBottomButton(false);
      return;
    }
    const nearBottom = isChatNearBottom(container);
    const programmaticScrollActive = performance.now() < programmaticScrollUntilRef.current;
    if (nearBottom) {
      keepScrolledToBottomRef.current = true;
      programmaticScrollUntilRef.current = 0;
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
        programmaticScrollTimeoutRef.current = null;
      }
    } else if (!programmaticScrollActive) {
      keepScrolledToBottomRef.current = false;
    }
    setShowScrollToBottomButton(!nearBottom && !programmaticScrollActive);
  }, [artifactViewerTarget]);

  useEffect(
    () => () => {
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!keepScrolledToBottomRef.current && !isChatNearBottom(container, 96)) {
      setShowScrollToBottomButton(true);
      return;
    }
    const rafId = window.requestAnimationFrame(() => scrollToBottom("auto"));
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (artifactViewerTarget) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    if (!keepScrolledToBottomRef.current && !isChatNearBottom(container, 96)) return;
    const rafId = window.requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [liveActivities, streamingContent, liveCurrentStep, artifactViewerTarget, scrollToBottom]);

  useEffect(() => {
    if (artifactViewerTarget || typeof ResizeObserver === "undefined") return;
    const container = messagesContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (keepScrolledToBottomRef.current) {
          scrollToBottom("auto");
        } else {
          refreshScrollToBottomVisibility();
        }
      });
    });
    observer.observe(container);
    const observeChildren = () => {
      for (const child of container.children) observer.observe(child);
    };
    observeChildren();
    const mutationObserver = new MutationObserver(observeChildren);
    mutationObserver.observe(container, { childList: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [artifactViewerTarget, refreshScrollToBottomVisibility, scrollToBottom]);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      refreshScrollToBottomVisibility();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [refreshScrollToBottomVisibility, typedMessages.length, isLoading, artifactViewerTarget]);

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
  }, [isLoading, liveActivities, sessionId, typedMessages, turnStartedAtMsByIndex]);

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
      markFirstTokenLatency();

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
    [markFirstTokenLatency]
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
        startedAtMs: cached?.startedAtMs ?? (latestTimestamp || Date.now()),
      });
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
      if (status === "idle" && !isSteeringHandoff) return true;

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
        const snapshotAgeMs =
          snapshot && typeof snapshot.timestamp === "number"
            ? Date.now() - snapshot.timestamp
            : Infinity;
        const snapshotFresh = snapshotAgeMs <= SESSION_ACTIVITY_STALE_MS;
        const nextActiveIds =
          snapshot && !snapshotFresh
            ? visibleActiveIds.filter((candidateId) => candidateId !== resolvedSessionId)
            : visibleActiveIds;
        setActiveSessionIds(nextActiveIds);
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
        setPendingMessages((current) =>
          mergePendingChatMessages(snapshot?.pendingMessages, current)
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
          const bufferedLive = readCachedLiveSessionState(resolvedSessionId);
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
            await refreshSessionMessagesRef.current(resolvedSessionId);
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
      setPendingMessages((current) =>
        mergePendingChatMessages(serverMessages, current, {
          preserveOptimistic: false,
        })
      );
      if (Array.isArray(serverMessages) && serverMessages.length === 0) {
        clearCachedOptimisticPendingMessages(resolvedSessionId);
      }
    } catch {}
  }, []);

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
    activeSessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    setShowEnvironmentOverview(false);
  }, [sessionId]);

  useEffect(() => {
    const cached = readCachedLiveSessionState(sessionId);
    if (cached) {
      if (sessionId) {
        eventCursorBySessionRef.current[sessionId] = {
          runId: cached.runId,
          sequence: 0,
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
    if (!sessionId || typedMessages.length === 0) return;
    writeCachedSessionMessages(sessionId, typedMessages);
  }, [sessionId, typedMessages]);

  useEffect(() => {
    if (!sessionId) return;
    const hasLiveState =
      liveStatus !== "idle" ||
      liveActivities.length > 0 ||
      !!liveCurrentStep ||
      !!streamingContent ||
      activeSessionIds.includes(sessionId);
    if (!hasLiveState) {
      clearCachedLiveSessionState(sessionId);
      return;
    }
    writeCachedLiveSessionState(sessionId, {
      status: liveStatus,
      activities: liveActivities,
      currentStep: liveCurrentStep,
      streamingContent,
      runId: latestRunIdBySessionRef.current[sessionId] ?? null,
      startedAtMs: liveRunStartedAtMs,
    });
  }, [
    activeSessionIds,
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
        const result = await loadPersistedCompletion(() => loadSessionMutation.loadFresh(sid));
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
          if ((status === "idle" && !isSteeringHandoff) || status === "error") {
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
          markFirstTokenLatency(payloadSessionId);
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
          markFirstTokenLatency(payloadSessionId);
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
          setLiveStatus("idle");
          setLiveCurrentStep(null);
          if (!loadingRef.current) {
            const sessionToRefresh = payloadSessionId || activeSession;
            const finalizeLiveState = () => {
              setStreamingContent(null);
              liveRunStartedAtMsRef.current = null;
              setLiveRunStartedAtMs(null);
              setLiveActivities([]);
              runActivityBufferRef.current = [];
              clearCachedLiveSessionState(sessionToRefresh);
            };
            if (sessionToRefresh && sessionToRefresh === activeSessionRef.current) {
              void refreshSessionMessagesRef.current(sessionToRefresh).finally(finalizeLiveState);
            } else {
              finalizeLiveState();
            }
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
    const sessionCurrentlyActive = !!sessionId && activeSessionIds.includes(sessionId);
    const locallyLoadingCurrentSession =
      loadingRef.current && (!sessionId || !loadingSessionId || loadingSessionId === sessionId);
    const pendingCapture = pendingProcessCaptureRef.current;
    const pendingCaptureForCurrentSession =
      !!pendingCapture &&
      (sessionId
        ? !pendingCapture.sessionId || pendingCapture.sessionId === sessionId
        : !pendingCapture.sessionId);
    return (
      sessionCurrentlyActive ||
      locallyLoadingCurrentSession ||
      (isLoading && (!sessionId || loadingSessionId === sessionId)) ||
      pendingCaptureForCurrentSession ||
      liveStatus !== "idle" ||
      liveActivities.length > 0
    );
  }, [activeSessionIds, isLoading, liveActivities.length, liveStatus, loadingSessionId, sessionId]);

  const handleSend = async () => {
    suppressAutoRestoreRef.current = false;
    const currentMessageWouldQueue = canQueueCurrentMessage() || pendingMessages.length > 0;
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
        workspaceDir: effectiveWorkspaceDir || undefined,
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
      throw error;
    }
  };

  const handleSteerPendingMessage = useCallback(
    async (pendingMessageId: string) => {
      if (!sessionId) return;
      setSteeringMessageId(pendingMessageId);
      const preSteerActivities = mergeActivityLists(runActivityBufferRef.current, liveActivities);
      const preSteerProcessActivities = finalizeCompletedActivities(preSteerActivities)
        .filter((activity) => {
          const text = activity.text.trim().toLowerCase();
          return (
            text.length > 0 &&
            text !== "steering to follow-up..." &&
            text !== "starting queued follow-up"
          );
        })
        .map((activity) => ({
          id: activity.id,
          phase: activity.phase,
          text: activity.text,
          timestamp: activity.timestamp,
          toolName: activity.toolName,
          toolCallId: activity.toolCallId,
          sandboxProvider: activity.sandboxProvider,
        }));
      try {
        const response = await chatApi.steerPendingMessage(sessionId, pendingMessageId, {
          processActivities: preSteerProcessActivities,
        });
        if (response.success && response.data) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          if (response.data.pendingMessages.length === 0) {
            clearCachedOptimisticPendingMessages(sessionId);
          }
          let materializedMessages: ChatMessage[] = [];
          try {
            const refreshed = await loadSessionMutation.mutateAsync(sessionId);
            if (refreshed?.messagesList) {
              materializedMessages = refreshed.messagesList as ChatMessage[];
              loadSession(
                sessionId,
                materializedMessages,
                (refreshed as { workspace_dir?: string | null }).workspace_dir || null
              );
              syncSessionAgentSelection(
                (refreshed as { agent_id?: string | null }).agent_id || null
              );
              setSessionContextUsage(
                (refreshed as { contextUsage?: SessionContextUsage | null }).contextUsage || null
              );
              setSessionTokenUsage(
                (refreshed as { tokenUsage?: SessionTokenUsage | null }).tokenUsage || null
              );
            }
          } catch (error) {
            console.error("Failed to refresh steered chat session:", error);
          }
          if (materializedMessages.length === 0) {
            const steeredMessage = response.data.message as ChatMessage;
            const preSteerMessage =
              (response.data.interruptedMessage as ChatMessage | undefined) ||
              buildPreSteeringActivityMessage(steeredMessage, preSteerActivities);
            materializedMessages = [preSteerMessage, steeredMessage].filter(
              (message): message is ChatMessage => !!message
            );
          }
          runActivityBufferRef.current = pruneCanonicalizedLiveActivities(
            materializedMessages,
            runActivityBufferRef.current
          );
          if (pendingProcessCaptureRef.current) {
            pendingProcessCaptureRef.current = {
              ...pendingProcessCaptureRef.current,
              activities: pruneCanonicalizedLiveActivities(
                materializedMessages,
                pendingProcessCaptureRef.current.activities
              ),
            };
          }
          setLiveActivities((previous) =>
            pruneCanonicalizedLiveActivities(materializedMessages, previous)
          );
          return;
        }
        console.error("Failed to steer pending message:", response.error || response.data?.error);
      } finally {
        setSteeringMessageId(null);
      }
    },
    [loadSession, loadSessionMutation, liveActivities, sessionId, syncSessionAgentSelection]
  );

  const handleReorderPendingMessages = useCallback(
    async (orderedIds: string[]) => {
      if (!sessionId || orderedIds.length === 0) return;
      const previousMessages = pendingMessages;
      const byId = new Map(previousMessages.map((message) => [message.id, message]));
      const orderedMessages = orderedIds
        .map((id) => byId.get(id))
        .filter((message): message is PendingChatMessage => !!message);
      if (orderedMessages.length === previousMessages.length) {
        setPendingMessages(orderedMessages);
      }
      try {
        const response = await chatApi.reorderPendingMessages(sessionId, orderedIds);
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error(
          "Failed to reorder pending messages:",
          response.error || response.data?.error
        );
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to reorder pending messages:", error);
      }
    },
    [pendingMessages, sessionId]
  );

  const handleUpdatePendingMessage = useCallback(
    async (pendingMessageId: string, content: string) => {
      if (!sessionId || pendingMessageId.startsWith("optimistic-")) return;
      const nextContent = content.trim();
      if (!nextContent) return;
      const previousMessages = pendingMessages;
      const now = Date.now();
      setPendingMessages((current) =>
        normalizePendingChatMessages(
          current.map((message) =>
            message.id === pendingMessageId
              ? { ...message, content: nextContent, updatedAt: now }
              : message
          )
        )
      );
      setPendingMessageMutationId(pendingMessageId);
      try {
        const response = await chatApi.updatePendingMessage(
          sessionId,
          pendingMessageId,
          nextContent
        );
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error("Failed to update pending message:", response.error || response.data?.error);
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to update pending message:", error);
      } finally {
        setPendingMessageMutationId(null);
      }
    },
    [pendingMessages, sessionId]
  );

  const handleDeletePendingMessage = useCallback(
    async (pendingMessageId: string) => {
      if (!sessionId || pendingMessageId.startsWith("optimistic-")) return;
      const previousMessages = pendingMessages;
      setPendingMessages((current) => current.filter((message) => message.id !== pendingMessageId));
      setPendingMessageMutationId(pendingMessageId);
      try {
        const response = await chatApi.deletePendingMessage(sessionId, pendingMessageId);
        if (response.success && response.data?.success) {
          setPendingMessages(normalizePendingChatMessages(response.data.pendingMessages));
          return;
        }
        setPendingMessages(previousMessages);
        console.error("Failed to delete pending message:", response.error || response.data?.error);
      } catch (error) {
        setPendingMessages(previousMessages);
        console.error("Failed to delete pending message:", error);
      } finally {
        setPendingMessageMutationId(null);
      }
    },
    [pendingMessages, sessionId]
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

  const applySessionWorkspace = useCallback(
    async (nextWorkspaceDir: string | null) => {
      const previousWorkspaceDir = workspaceDir;
      setWorkspaceDir(nextWorkspaceDir);
      if (nextWorkspaceDir) {
        persistWorkspaceDir(nextWorkspaceDir);
        setLastWorkspaceDir(nextWorkspaceDir);
      }

      if (!sessionId) {
        return;
      }

      setWorkspaceSaving(true);
      try {
        const response = await chatApi.updateSessionWorkspace(sessionId, nextWorkspaceDir);
        if (!response.success || !response.data || response.data.success === false) {
          const message =
            (response.data && "error" in response.data ? response.data.error : null) ||
            response.error ||
            "Failed to update session workspace";
          throw new Error(message || "Failed to update session workspace");
        }
        const resolvedWorkspaceDir = response.data.workspaceDir || null;
        setWorkspaceDir(resolvedWorkspaceDir);
        if (resolvedWorkspaceDir) {
          persistWorkspaceDir(resolvedWorkspaceDir);
          setLastWorkspaceDir(resolvedWorkspaceDir);
        }
      } catch (error) {
        setWorkspaceDir(previousWorkspaceDir || null);
        console.error("Failed to update session workspace:", error);
      } finally {
        setWorkspaceSaving(false);
      }
    },
    [sessionId, setWorkspaceDir, workspaceDir]
  );

  const handleSelectWorkspace = useCallback(async () => {
    try {
      let selectedPath: string | null = null;
      if (isDesktopHostRuntime()) {
        selectedPath = await openDesktopDirectoryDialog({
          defaultPath: effectiveWorkspaceDir || undefined,
          title: "Select Session Workspace",
        });
      } else {
        const response = await apiFetch("/api/system/folder-dialog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            default_path: effectiveWorkspaceDir || undefined,
            title: "Select Session Workspace",
          }),
        });
        const result = (await response.json()) as {
          path?: string | null;
          success?: boolean;
          supported?: boolean;
        };
        if (!response.ok || result.success === false || result.supported === false) {
          setShowWorkspacePicker(true);
          return;
        }
        selectedPath = result.path || null;
      }
      if (selectedPath) {
        await applySessionWorkspace(selectedPath);
      }
    } catch (error) {
      console.error("Failed to select workspace:", error);
      setShowWorkspacePicker(true);
    }
  }, [applySessionWorkspace, effectiveWorkspaceDir]);

  const handleOpenWorkspaceInCybaraIde = useCallback(
    async (targetWorkspaceDir: string) => {
      const normalized = targetWorkspaceDir.trim();
      if (!normalized) return;
      try {
        persistWorkspaceDir(normalized);
        setLastWorkspaceDir(normalized);
        const params = new URLSearchParams();
        params.set("workspacePath", normalized);
        navigate(`/ide?${params.toString()}`);
      } catch (error) {
        useUIStore
          .getState()
          .addToast(
            "error",
            error instanceof Error ? error.message : "Unable to open workspace in Cybara IDE"
          );
      }
    },
    [navigate]
  );

  const handleOpenPathInIde = useCallback(
    (path: string) => {
      const resolvedPath = resolvePathForIde(path, effectiveWorkspaceDir);
      if (!resolvedPath) return;
      const params = new URLSearchParams();
      params.set("path", resolvedPath);
      if (effectiveWorkspaceDir) params.set("workspacePath", effectiveWorkspaceDir);
      params.set("from", "chat-workspace");
      navigate(`/ide?${params.toString()}`);
    },
    [effectiveWorkspaceDir, navigate]
  );

  const handleOpenDiffFileInWorkspace = useCallback(
    (file: FileChangeItem) => {
      const resolvedPath = resolvePathForIde(file.path, effectiveWorkspaceDir);
      if (!resolvedPath) return;
      openWorkspaceFile(resolvedPath);
    },
    [effectiveWorkspaceDir, openWorkspaceFile]
  );

  const handleDiffPanelResizeStart = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      diffPanelResizeCleanupRef.current?.();
      diffPanelResizeCleanupRef.current = null;
      diffPanelResizeStateRef.current = {
        startX: event.clientX,
        startWidth: diffPanelWidth,
      };
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const state = diffPanelResizeStateRef.current;
        if (!state) return;
        const delta = state.startX - moveEvent.clientX;
        setDiffPanelWidth(clampDiffPanelWidth(state.startWidth + delta));
      };

      const handleMouseUp = () => {
        diffPanelResizeStateRef.current = null;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        diffPanelResizeCleanupRef.current = null;
      };

      diffPanelResizeCleanupRef.current = () => {
        diffPanelResizeStateRef.current = null;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [diffPanelWidth]
  );

  const openArtifactViewer = useCallback(async (artifact: ArtifactSummaryView) => {
    setArtifactViewerTarget(artifact);
    setArtifactViewerLoading(true);
    setArtifactViewerError(null);
    setArtifactViewerContent("");
    setArtifactViewerRawView(false);

    try {
      const url = appendApiTokenParam(
        `/api/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.fileName)}`
      );
      const response = await fetch(url);
      const payload = (await response.json()) as {
        content?: string;
        artifact?: { path?: string };
        error?: string;
      };

      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === "string"
            ? payload.error
            : `Failed to load artifact (${response.status})`;
        throw new Error(errorMessage);
      }
      if (typeof payload.content !== "string") {
        throw new Error("Artifact response did not include content");
      }

      setArtifactViewerTarget((previous) => {
        if (!previous) return artifact;
        const nextPath =
          payload?.artifact && typeof payload.artifact.path === "string"
            ? payload.artifact.path
            : previous.path;
        return {
          ...previous,
          path: nextPath,
        };
      });
      setArtifactViewerContent(payload.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load artifact";
      setArtifactViewerError(message);
      setArtifactViewerContent("");
    } finally {
      setArtifactViewerLoading(false);
    }
  }, []);

  const closeArtifactViewer = useCallback(() => {
    setArtifactViewerTarget(null);
    setArtifactViewerLoading(false);
    setArtifactViewerError(null);
    setArtifactViewerContent("");
    setArtifactViewerRawView(false);
  }, []);

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
      await revertToMessage({
        index: revertTarget.index,
        content: revertTarget.content,
        timestamp: revertTarget.timestamp,
      });
      setInput(revertTarget.content);
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
  const currentSessionIsActive = !!sessionId && activeSessionIds.includes(sessionId);
  const currentSessionIsLoading = isLoading && loadingSessionId === sessionId;
  const pendingCapture = pendingProcessCaptureRef.current;
  const pendingCaptureForCurrentSession =
    !!pendingCapture &&
    (sessionId
      ? !pendingCapture.sessionId || pendingCapture.sessionId === sessionId
      : !pendingCapture.sessionId);
  const showWorkingTimeline =
    currentSessionIsLoading ||
    currentSessionIsActive ||
    pendingCaptureForCurrentSession ||
    liveActivities.length > 0;
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
        isOpen={showNearbyShare}
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
            onClose: () => setShowEnvironmentOverview(false),
            onCreateGitBranch: environmentGit.createAndCheckout,
            onRefreshGitBranches: environmentGit.refresh,
            onSwitchGitBranch: environmentGit.checkout,
            onOpenWorkspaceTab: openWorkspaceTab,
            previewTabs: Array.from(
              new Set(
                workspaceTabs
                  .map((instance) => instance.kind)
                  .filter((kind) => kind === "browser" || kind === "terminal" || kind === "files")
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
          nearbyEnabled={Boolean(sessionId && nearbyStatus?.settings.enabled)}
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
          onOpenNearbyShare={() => setShowNearbyShare(true)}
          onToggleEnvironment={() => setShowEnvironmentOverview((value) => !value)}
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
                  "flex-1 overflow-y-auto px-3 py-4 sm:px-4",
                  typedMessages.length === 0 ? "flex items-center justify-center" : "space-y-4"
                )}
              >
                {typedMessages.length === 0 ? (
                  restoringInitialSession ? (
                    <ChatSessionLoadingState />
                  ) : (
                    <ChatEmptyState
                      gitBranch={environmentGit.currentBranch}
                      gitBranchChanging={environmentGit.changingBranch}
                      gitBranchError={environmentGit.error}
                      gitBranchLoading={environmentGit.loading}
                      gitBranches={environmentGit.branches}
                      workspaceDir={effectiveWorkspaceDir}
                      workspaceSaving={workspaceSaving}
                      onCreateGitBranch={environmentGit.createAndCheckout}
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
                    liveActivities={timelineActivities}
                    liveCurrentStep={liveCurrentStep}
                    liveStatus={timelineStatus}
                    liveStartedAtMs={timelineStartedAtMs}
                    messageProcessMap={messageProcessMap}
                    savingGoldenMessageIndex={savingGoldenMessageIndex}
                    sessionId={sessionId}
                    showWorkingTimeline={showWorkingTimeline}
                    speakingMessageIndex={speakingMessageIndex}
                    workspaceDir={effectiveWorkspaceDir}
                    onCopyMessage={(index, content) => void handleCopyMessage(index, content)}
                    onForkSession={(index) => void handleForkSession(index)}
                    onOpenArtifact={(artifact) => void openArtifactViewer(artifact)}
                    onOpenImage={openChatImage}
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

              {typedMessages.length > 0 ? <ChatComposer {...chatComposerProps} /> : null}
            </>
          )}
        </div>

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
            onOpenTab={openWorkspaceTab}
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
              Are you sure you want to revert here? This will keep this message, remove{" "}
              {revertFollowingCount} later message
              {revertFollowingCount === 1 ? "" : "s"} from this session, then place this text back
              in the input box for resend.
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
