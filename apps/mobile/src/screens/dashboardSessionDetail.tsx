import { normalizeChatAppearanceSettings } from "cybara-shared/chat-appearance";
import {
  CHAT_FOLLOW_THRESHOLD_PX,
  type ChatScrollMetrics,
  isChatNearBottom,
} from "cybara-shared/chat-scroll-follow";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  Clock3,
  FlaskConical,
  Folder,
  Gauge,
  GitBranch,
  GitFork,
  Globe2,
  MessageSquareText,
  Paperclip,
  Pencil,
  Pin,
  Send,
  Share2,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from "lucide-react-native";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffectiveChatAppearance } from "../accessibility/SystemAccessibilityContext";
import { LiquidGlass } from "../components/LiquidGlass";
import { MobileBranchPicker } from "../components/MobileBranchPicker";
import type {
  AgentSummary,
  CybaraMobileApi,
  GitBranchSummary,
  MobilePendingChatMessage,
  ProviderPlanStatusResponse,
  SessionDetailSummary,
  SessionSummary,
} from "../lib/api";
import {
  chatIsWaitingForAssistant,
  formatBytes,
  latestVisibleChatMessages,
  mobileMediaSummaryLabel,
  mobilePendingImageBytes,
} from "../lib/chat-format";
import {
  boundedMobileComposerHeight,
  MOBILE_CHAT_CHROME,
  MOBILE_CHAT_COMPOSER,
  mobileChatHorizontalPadding,
  MOBILE_NAV_CHROME,
  mobileComposerHeightForDraft,
  mobileFirstNonEmptyString,
  mobileSessionTitle,
  mobileSupportedReasoningEfforts,
  readMobileFollowUpBehaviorEnabled,
  readMobileToolApprovalMode,
  sessionProviderModelLabel,
} from "../lib/dashboard";
import { haptics } from "../lib/haptics";
import { colors, spacing } from "../theme/liquidGlass";
import { ChatMessageRow, MobilePlanSummaryCard } from "./dashboardChat";
import { absoluteTimestampLabel, relativeTimestamp } from "./dashboardHelpers";
import {
  clearCachedMobileLiveAssistant,
  liveAssistantMessage,
  mergeLiveActivity,
  mobileAgentUsingBrowser,
  mobilePreSteerProcessActivities,
} from "./dashboardLiveChat";
import { mobileProviderPlanDetail } from "./dashboardMetricsPanels";
import {
  clearCachedMobileOptimisticTranscript,
  writeCachedMobileOptimisticTranscriptMessage,
} from "./dashboardOptimisticTranscript";
import { mobileTranscriptHasMixedAuthors } from "./dashboardMessageAuthors";
import { MobileGoalCard } from "./dashboardGoal";
import {
  clearCachedMobileOptimisticPendingMessages,
  mergeMobilePendingMessages,
  mobilePendingMessageIsOptimistic,
  readCachedMobileOptimisticPendingMessages,
  writeCachedMobileOptimisticPendingMessages,
} from "./dashboardPendingQueue";
import { EmptyState } from "./dashboardPrimitives";
import {
  compactWorkspace,
  mobileContextUsageDetail,
  mobileFormatTokenCount,
  mobileProviderPlanFor,
  mobileSessionTokenUsageDetail,
} from "./dashboardSessionMetrics";
import {
  ChatApprovalBanner,
  type ChatSettingsAction,
  type ChatSettingsRow,
  ChatSettingsSheet,
} from "./dashboardSessionSettings";
import { styles } from "./dashboardStyles";
import { MobileSubagentsSheet } from "./dashboardSubagents";
import {
  MOBILE_CHAT_MAX_ATTACHMENTS,
  pendingImageUri,
  useMobileChatComposer,
} from "./useMobileChatComposer";
import { useMobileSessionRuntime } from "./useMobileSessionRuntime";

export interface ChatHeaderAction {
  busy: boolean;
  onPress: () => void;
}

const MOBILE_MODEL_ROUTER_SELECTOR_VALUE = "__model_router__";
const ignoreSessionDetail = (_detail: SessionDetailSummary): void => {};

function ChatKeyboardContainer({
  children,
  keyboardVerticalOffset,
}: {
  children: ReactNode;
  keyboardVerticalOffset: number;
}) {
  if (Platform.OS === "android") {
    return (
      <KeyboardAvoidingView
        behavior="height"
        keyboardVerticalOffset={keyboardVerticalOffset}
        style={styles.chatShell}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }
  return <View style={styles.chatShell}>{children}</View>;
}

function pendingMessagesFromResponse(result: {
  pendingMessage?: MobilePendingChatMessage;
  pendingMessages?: MobilePendingChatMessage[];
}): MobilePendingChatMessage[] {
  if (Array.isArray(result.pendingMessages)) return result.pendingMessages;
  return result.pendingMessage ? [result.pendingMessage] : [];
}

export function SessionDetailPanel({
  accentColor,
  api,
  agents,
  closeDetail,
  openSession,
  config,
  providerPlanStatus,
  onSessionUpdated,
  refreshSummary,
  sessionSummary,
  sessionId,
  setHeaderAction,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  agents: AgentSummary[];
  closeDetail: () => void;
  openSession?: (sessionId: string) => void;
  config?: Record<string, unknown>;
  providerPlanStatus?: ProviderPlanStatusResponse | null;
  onSessionUpdated?: (detail: SessionDetailSummary) => void;
  refreshSummary: () => void;
  sessionSummary?: SessionSummary | null;
  sessionId: string;
  setHeaderAction?: Dispatch<SetStateAction<ChatHeaderAction | null>>;
}) {
  const insets = useSafeAreaInsets();
  const labConfig =
    config?.lab && typeof config.lab === "object" && !Array.isArray(config.lab)
      ? (config.lab as Record<string, unknown>)
      : {};
  const chatAppearance = useEffectiveChatAppearance(
    normalizeChatAppearanceSettings(config?.chat_appearance)
  );
  const goldenTurnActionsEnabled =
    labConfig.enabled !== false && labConfig.goldenTurnsEnabled !== false;
  const navFootprint = insets.bottom + MOBILE_NAV_CHROME.floatingMargin + MOBILE_NAV_CHROME.height;
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const [keyboardHeight, setKeyboardHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextKeyboardHeight = event.endCoordinates.height;
      setKeyboardVisible(nextKeyboardHeight > 0);
      if (Platform.OS === "ios") setKeyboardHeight(nextKeyboardHeight);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      if (Platform.OS === "ios") setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitBranches, setGitBranches] = useState<GitBranchSummary[]>([]);
  const [gitBranchLoading, setGitBranchLoading] = useState(false);
  const [gitBranchError, setGitBranchError] = useState<string | null>(null);
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [steeringPendingId, setSteeringPendingId] = useState<string | null>(null);
  const [reorderingPendingId, setReorderingPendingId] = useState<string | null>(null);
  const [mutatingPendingId, setMutatingPendingId] = useState<string | null>(null);
  const [editingPendingMessage, setEditingPendingMessage] =
    useState<MobilePendingChatMessage | null>(null);
  const [editingPendingDraft, setEditingPendingDraft] = useState("");
  const [pinned, setPinned] = useState(sessionSummary?.pinned ?? false);
  const [pinning, setPinning] = useState(false);
  const [reliabilityAction, setReliabilityAction] = useState<"fork" | "golden" | null>(null);
  const [nearbySharing, setNearbySharing] = useState(false);
  const [nearbyEnabled, setNearbyEnabled] = useState(false);
  const [agentUpdating, setAgentUpdating] = useState(false);
  const [reasoningUpdating, setReasoningUpdating] = useState(false);
  const [reasoningOverride, setReasoningOverride] = useState<{
    agentId: string;
    effort: AgentSummary["reasoning_effort"];
  } | null>(null);
  const [pendingSessionAgentId, setPendingSessionAgentId] = useState<string | null>(null);
  const [routerEnabled, setRouterEnabled] = useState(false);
  const [useModelRouter, setUseModelRouter] = useState(false);
  const [chatSettingsVisible, setChatSettingsVisible] = useState(false);
  const [subagentsVisible, setSubagentsVisible] = useState(false);
  const [toolApprovalUpdating, setToolApprovalUpdating] = useState(false);
  const [pendingToolApprovalMode, setPendingToolApprovalMode] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const followChatBottomRef = useRef(true);
  const chatScrollGestureActiveRef = useRef(false);
  const pendingScrollToEndRef = useRef<number | null>(null);
  const headerActionRef = useRef<() => void>(() => {});
  const updateChatFollowFromScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const metrics: ChatScrollMetrics = {
        clientHeight: layoutMeasurement.height,
        scrollHeight: contentSize.height,
        scrollTop: contentOffset.y,
      };
      followChatBottomRef.current = isChatNearBottom(metrics, CHAT_FOLLOW_THRESHOLD_PX);
    },
    []
  );
  const scrollChatToEnd = useCallback((): void => {
    if (!followChatBottomRef.current || chatScrollGestureActiveRef.current) return;
    if (pendingScrollToEndRef.current !== null) return;
    pendingScrollToEndRef.current = requestAnimationFrame(() => {
      pendingScrollToEndRef.current = null;
      if (!followChatBottomRef.current || chatScrollGestureActiveRef.current) return;
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }, []);
  const {
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
  } = useMobileSessionRuntime({
    api,
    sessionId,
    sessionSummary,
    sending,
    setPinned,
    setPendingSessionAgentId,
    onSessionUpdated: onSessionUpdated ?? ignoreSessionDetail,
  });

  useEffect(() => {
    followChatBottomRef.current = true;
    chatScrollGestureActiveRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    setUseModelRouter(false);
    api
      .routerConfig()
      .then((routerConfig) => {
        if (!active) return;
        setRouterEnabled(routerConfig.enabled === true);
        if (routerConfig.enabled !== true) setUseModelRouter(false);
      })
      .catch(() => {
        if (!active) return;
        setRouterEnabled(false);
        setUseModelRouter(false);
      });
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  useEffect(() => {
    if (!routerEnabled) return;
    setUseModelRouter(detail?.useModelRouter === true);
  }, [detail?.useModelRouter, routerEnabled]);

  useEffect(() => {
    let active = true;
    setNearbyEnabled(false);
    api
      .nearbyStatus()
      .then((status) => {
        if (active) setNearbyEnabled(status.settings.enabled === true);
      })
      .catch(() => {
        if (active) setNearbyEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  const {
    draft,
    setComposerDraft,
    appendTextToComposer,
    resetComposerDraft,
    draftRef,
    composerHeight,
    setComposerHeight,
    composerBarHeight,
    setComposerBarHeight,
    composerMeasuredHeightRef,
    pendingImages,
    setPendingImages,
    removePendingImage,
    openAttachmentMenu,
  } = useMobileChatComposer({ setLoadError });

  const replacePendingMessagesFromGateway = (messages: MobilePendingChatMessage[]) => {
    const nextMessages = mergeMobilePendingMessages(messages, [], {
      preserveOptimistic: false,
    });
    setPendingMessages(nextMessages);
    if (nextMessages.length === 0) {
      clearCachedMobileOptimisticPendingMessages(sessionId);
    }
  };

  const sendMessage = async () => {
    const message = draft.trim();
    const attachments = pendingImages;
    const chatBusy = sending || sessionActive || pendingMessages.length > 0;
    const queuedSend = followUpBehaviorEnabled && chatBusy;
    if (!message && attachments.length === 0) return;
    if (chatBusy && !followUpBehaviorEnabled) return;
    haptics.messageSent();
    resetComposerDraft();
    setPendingImages([]);
    const liveStartedAt = Date.now();
    let optimisticPendingMessageId: string | null = null;
    let optimisticMessageId: string | null = null;
    if (!queuedSend) {
      setSending(true);
      commitLiveAssistant(
        () => liveAssistantMessage(sessionId, null, liveStartedAt),
        liveStartedAt
      );
    } else {
      optimisticPendingCounterRef.current += 1;
      optimisticPendingMessageId = `optimistic-${liveStartedAt}-${optimisticPendingCounterRef.current}`;
      const optimisticPendingMessage: MobilePendingChatMessage = {
        id: optimisticPendingMessageId,
        sessionId,
        clientPendingId: optimisticPendingMessageId,
        content: message,
        createdAt: liveStartedAt,
        updatedAt: liveStartedAt,
        mode: "queued",
        sequence:
          pendingMessages.reduce((max, pending) => Math.max(max, pending.sequence || 0), 0) + 1,
      };
      optimisticPendingGraceUntilRef.current = Date.now() + 30_000;
      writeCachedMobileOptimisticPendingMessages(sessionId, [
        ...readCachedMobileOptimisticPendingMessages(sessionId),
        optimisticPendingMessage,
      ]);
      setPendingMessages((current) =>
        [...current, optimisticPendingMessage].sort(
          (a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt
        )
      );
    }
    const optimistic: SessionDetailSummary["messages"][number] = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
      images: attachments.length > 0 ? attachments : undefined,
    };
    if (!queuedSend) {
      optimisticMessageId = optimistic.id;
      writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic);
      setDetail((current) =>
        current
          ? {
              ...current,
              messages: [...current.messages, optimistic],
            }
          : current
      );
    }
    try {
      const result = await api.sendChat({
        message,
        sessionId,
        agentId: detail?.agentId,
        workspaceDir: detail?.workspaceDir,
        queueMode: queuedSend ? "queue" : undefined,
        clientPendingId: optimisticPendingMessageId || undefined,
        images: attachments.length > 0 ? attachments : undefined,
        useModelRouter,
      });
      if (result.queued) {
        if (optimisticMessageId) {
          clearCachedMobileOptimisticTranscript(sessionId, optimisticMessageId);
        }
        replacePendingMessagesFromGateway(pendingMessagesFromResponse(result));
        setDetail((current) =>
          current
            ? {
                ...current,
                workspaceDir: result.workspaceDir ?? current.workspaceDir,
                messages: optimisticMessageId
                  ? current.messages.filter((entry) => entry.id !== optimisticMessageId)
                  : current.messages,
              }
            : current
        );
        return;
      }
      if (result.interrupted) {
        responseHapticActiveRef.current = false;
        if (optimisticPendingMessageId) {
          setPendingMessages((current) =>
            current.filter((entry) => entry.id !== optimisticPendingMessageId)
          );
        }
        await loadSession(false);
        refreshSummary();
        commitLiveAssistant(() => null);
        return;
      }
      if (optimisticPendingMessageId) {
        setPendingMessages((current) =>
          current.filter((entry) => entry.id !== optimisticPendingMessageId)
        );
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              workspaceDir: result.workspaceDir ?? current.workspaceDir,
              contextUsage: result.contextUsage ?? current.contextUsage,
              tokenUsage: result.tokenUsage ?? current.tokenUsage,
              messages: [
                ...current.messages.filter((entry) => entry.id !== liveAssistant?.id),
                result.message,
              ],
            }
          : current
      );
      await loadSession(false);
      refreshSummary();
      commitLiveAssistant(() => null);
      if (responseHapticActiveRef.current) {
        responseHapticActiveRef.current = false;
        haptics.agentCompleted();
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setComposerDraft(message);
      if (attachments.length > 0) setPendingImages(attachments);
      setLoadError(messageText);
      if (optimisticPendingMessageId) {
        setPendingMessages((current) =>
          current.filter((entry) => entry.id !== optimisticPendingMessageId)
        );
      }
      if (optimisticMessageId) {
        clearCachedMobileOptimisticTranscript(sessionId, optimisticMessageId);
        setDetail((current) =>
          current
            ? {
                ...current,
                messages: current.messages.filter((entry) => entry.id !== optimisticMessageId),
              }
            : current
        );
      }
      const failedAt = Date.now();
      if (responseHapticActiveRef.current) {
        responseHapticActiveRef.current = false;
        haptics.warning();
      }
      commitLiveAssistant((current) => {
        const base = liveAssistantMessage(sessionId, current, failedAt);
        return {
          ...base,
          processActivities: mergeLiveActivity(base.processActivities || [], {
            id: `live-error-${failedAt}`,
            phase: "error",
            text: messageText,
            timestamp: failedAt,
          }),
        };
      }, failedAt);
    } finally {
      if (!queuedSend) {
        setSending(false);
      }
    }
  };

  const stopResponse = async () => {
    try {
      const result = await api.stopChatSession(sessionId);
      if (!result.success && !result.stopped) {
        Alert.alert("Unable to stop", result.error || "No active response was found.");
        return;
      }
      setSending(false);
      responseHapticActiveRef.current = false;
      await loadSession(false);
      refreshSummary();
      commitLiveAssistant(() => null);
    } catch (error) {
      Alert.alert("Unable to stop", error instanceof Error ? error.message : "Request failed.");
    }
  };

  const steerPendingMessage = async (pendingMessageId: string) => {
    if (pendingMessageId.startsWith("optimistic-")) return;
    setSteeringPendingId(pendingMessageId);
    try {
      const result = await api.steerPendingMessage(sessionId, pendingMessageId, {
        processActivities: mobilePreSteerProcessActivities(liveAssistant),
      });
      if (result.success) {
        replacePendingMessagesFromGateway(pendingMessagesFromResponse(result));
        await loadSession(false);
      } else if (result.error) {
        setLoadError(result.error);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setSteeringPendingId(null);
    }
  };

  const movePendingMessage = async (pendingMessageId: string, direction: -1 | 1) => {
    if (pendingMessageId.startsWith("optimistic-") || reorderingPendingId) return;
    const currentIndex = pendingMessages.findIndex((entry) => entry.id === pendingMessageId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= pendingMessages.length) return;
    const targetMessage = pendingMessages[nextIndex];
    if (!targetMessage || mobilePendingMessageIsOptimistic(targetMessage)) return;
    const previousMessages = pendingMessages;
    const nextMessages = [...pendingMessages];
    [nextMessages[currentIndex], nextMessages[nextIndex]] = [
      nextMessages[nextIndex],
      nextMessages[currentIndex],
    ];
    setPendingMessages(nextMessages);
    setReorderingPendingId(pendingMessageId);
    haptics.select();
    try {
      const result = await api.reorderPendingMessages(
        sessionId,
        nextMessages
          .filter((entry) => !mobilePendingMessageIsOptimistic(entry))
          .map((entry) => entry.id)
      );
      if (result.success) {
        replacePendingMessagesFromGateway(result.pendingMessages ?? []);
      } else {
        setPendingMessages(previousMessages);
        setLoadError(result.error || "Failed to reorder pending messages.");
      }
    } catch (error) {
      setPendingMessages(previousMessages);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReorderingPendingId(null);
    }
  };

  const openEditPendingMessage = (pendingMessage: MobilePendingChatMessage) => {
    if (mobilePendingMessageIsOptimistic(pendingMessage) || pendingMessage.mode === "steering")
      return;
    setEditingPendingMessage(pendingMessage);
    setEditingPendingDraft(pendingMessage.content);
  };

  const closeEditPendingMessage = () => {
    setEditingPendingMessage(null);
    setEditingPendingDraft("");
  };

  const updatePendingMessage = async () => {
    const target = editingPendingMessage;
    const nextContent = editingPendingDraft.trim();
    if (!target || !nextContent || mobilePendingMessageIsOptimistic(target)) return;
    if (nextContent === target.content.trim()) {
      closeEditPendingMessage();
      return;
    }
    const previousMessages = pendingMessages;
    const now = Date.now();
    setPendingMessages((current) =>
      current.map((entry) =>
        entry.id === target.id ? { ...entry, content: nextContent, updatedAt: now } : entry
      )
    );
    setMutatingPendingId(target.id);
    haptics.select();
    try {
      const result = await api.updatePendingMessage(sessionId, target.id, nextContent);
      if (result.success) {
        replacePendingMessagesFromGateway(result.pendingMessages ?? []);
        closeEditPendingMessage();
      } else {
        setPendingMessages(previousMessages);
        setLoadError(result.error || "Failed to update pending message.");
      }
    } catch (error) {
      setPendingMessages(previousMessages);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setMutatingPendingId(null);
    }
  };

  const deletePendingMessage = async (pendingMessage: MobilePendingChatMessage) => {
    if (mobilePendingMessageIsOptimistic(pendingMessage) || pendingMessage.mode === "steering")
      return;
    const previousMessages = pendingMessages;
    setPendingMessages((current) => current.filter((entry) => entry.id !== pendingMessage.id));
    setMutatingPendingId(pendingMessage.id);
    haptics.select();
    try {
      const result = await api.deletePendingMessage(sessionId, pendingMessage.id);
      if (result.success) {
        replacePendingMessagesFromGateway(result.pendingMessages ?? []);
      } else {
        setPendingMessages(previousMessages);
        setLoadError(result.error || "Failed to delete pending message.");
      }
    } catch (error) {
      setPendingMessages(previousMessages);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setMutatingPendingId(null);
    }
  };

  const confirmRevertToMessage = (message: SessionDetailSummary["messages"][number]) => {
    Alert.alert(
      "Revert to before this message?",
      "This message and every message after it will be removed from the session and its text returned to the composer.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revert",
          style: "destructive",
          onPress: () => {
            void api
              .revertSession(sessionId, {
                messageRole: "user",
                messageContent: message.content,
                messageTimestamp: message.timestamp,
              })
              .then((result) => {
                if (result?.success === false) {
                  throw new Error(result.error || "Failed to revert session");
                }
                clearCachedMobileOptimisticTranscript(sessionId);
                setComposerDraft(result.revertedMessage?.content ?? message.content ?? "");
                return loadSession(false);
              })
              .then(() => refreshSummary())
              .catch((error) => {
                setLoadError(error instanceof Error ? error.message : String(error));
              });
          },
        },
      ]
    );
  };

  const deleteChat = () => {
    Alert.alert("Delete chat?", "This removes the session from the gateway history.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void api
            .deleteSession(sessionId)
            .then(() => {
              clearCachedMobileLiveAssistant(sessionId);
              clearCachedMobileOptimisticPendingMessages(sessionId);
              clearCachedMobileOptimisticTranscript(sessionId);
              refreshSummary();
              closeDetail();
            })
            .catch((error) => {
              setLoadError(error instanceof Error ? error.message : String(error));
            });
        },
      },
    ]);
  };

  const togglePinned = async () => {
    if (pinning) return;
    const nextPinned = !pinned;
    setPinning(true);
    setPinned(nextPinned);
    try {
      const result = await api.pinSession(sessionId, nextPinned);
      if (typeof result.pinned === "boolean") {
        setPinned(result.pinned);
      }
      refreshSummary();
    } catch (error) {
      setPinned(!nextPinned);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setPinning(false);
    }
  };

  const forkChat = async () => {
    if (reliabilityAction) return;
    setReliabilityAction("fork");
    haptics.select();
    try {
      const result = await api.forkSession(sessionId);
      if (!result.success || !result.fork) {
        throw new Error(result.error || "Failed to fork chat.");
      }
      refreshSummary();
      haptics.success();
      if (openSession) openSession(result.fork.sessionId);
      else Alert.alert("Chat forked", "The fork is available in your chat list.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReliabilityAction(null);
    }
  };

  const saveGoldenRun = async () => {
    if (reliabilityAction) return;
    setReliabilityAction("golden");
    haptics.select();
    try {
      const result = await api.saveSessionGolden(sessionId);
      if (!result.success) throw new Error(result.error || "Failed to save golden run.");
      haptics.success();
      Alert.alert("Golden run saved", "This chat can now be replayed from the Evals page.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReliabilityAction(null);
    }
  };

  const currentAgentId =
    pendingSessionAgentId ||
    mobileFirstNonEmptyString(detail?.agentId, sessionSummary?.agent_id) ||
    "";
  const selectedAgent = agents.find((agent) => agent.id === currentAgentId);
  const reasoningEffort =
    reasoningOverride && reasoningOverride.agentId === selectedAgent?.id
      ? reasoningOverride.effort
      : (selectedAgent?.reasoning_effort ?? null);
  const reasoningOptions: Array<{
    value: AgentSummary["reasoning_effort"];
    label: string;
  }> = useMemo(
    () =>
      mobileSupportedReasoningEfforts(
        selectedAgent?.provider_type ?? selectedAgent?.provider_id ?? selectedAgent?.provider,
        selectedAgent?.model,
        selectedAgent?.reasoning_mode,
        selectedAgent?.reasoning_efforts
      ).map((option) => ({
        value: option.value === "" ? null : option.value,
        label: option.label,
      })),
    [
      selectedAgent?.provider_id,
      selectedAgent?.provider,
      selectedAgent?.model,
      selectedAgent?.reasoning_mode,
      selectedAgent?.reasoning_efforts,
    ]
  );
  const reasoningLabel =
    reasoningOptions.find((option) => option.value === reasoningEffort)?.label ?? "Default";
  const activeProviderPlan = useModelRouter
    ? null
    : mobileProviderPlanFor(providerPlanStatus, {
        agent: selectedAgent,
        detail,
        sessionSummary,
      });
  const agentOptions = useMemo(
    () => [
      ...(routerEnabled
        ? [{ label: "Model Router", value: MOBILE_MODEL_ROUTER_SELECTOR_VALUE }]
        : [{ label: "Gateway default", value: "" }]),
      ...agents.map((agent) => ({
        label: agent.model ? `${agent.name} - ${agent.model}` : agent.name,
        value: agent.id,
      })),
    ],
    [agents, routerEnabled]
  );
  const contextUsage = detail?.contextUsage;
  const chatWorkspaceDir = mobileFirstNonEmptyString(
    detail?.workspaceDir,
    sessionSummary?.workspace_dir
  );
  const toolApprovalMode = pendingToolApprovalMode || readMobileToolApprovalMode(config);
  const toolApprovalLabel = toolApprovalMode === "ask" ? "Ask Me" : "Always Allow";
  const followUpBehaviorEnabled = readMobileFollowUpBehaviorEnabled(config);
  const chatBusy = sending || sessionActive || pendingMessages.length > 0;

  const refreshMobileGitBranches = useCallback(async () => {
    const workspace = chatWorkspaceDir?.trim();
    if (!workspace) {
      setGitBranch(null);
      setGitBranches([]);
      setGitBranchError(null);
      return;
    }
    setGitBranchLoading(true);
    try {
      const result = await api.gitBranches(workspace);
      setGitBranches(result.branches);
      setGitBranch(result.current);
      setGitBranchError(result.success ? null : result.error || "Unable to load branches.");
    } catch (error) {
      setGitBranch(null);
      setGitBranches([]);
      setGitBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitBranchLoading(false);
    }
  }, [api, chatWorkspaceDir]);

  useEffect(() => {
    let active = true;
    void refreshMobileGitBranches().finally(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [refreshMobileGitBranches]);

  const changeMobileGitBranch = async (branch: string, create = false) => {
    const workspace = chatWorkspaceDir?.trim();
    if (!workspace) return;
    setGitBranchLoading(true);
    setGitBranchError(null);
    haptics.select();
    try {
      const result = await api.checkoutGitBranch(workspace, branch, create);
      if (!result.success) throw new Error(result.error || "Unable to switch branches.");
      setGitBranch(result.branch || branch);
      setBranchPickerVisible(false);
      await refreshMobileGitBranches();
    } catch (error) {
      setGitBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setGitBranchLoading(false);
    }
  };

  const changeToolApprovalMode = async (nextMode: string) => {
    const normalized = nextMode === "ask" ? "ask" : "always_allow";
    if (toolApprovalUpdating || normalized === toolApprovalMode) return;
    setToolApprovalUpdating(true);
    setPendingToolApprovalMode(normalized);
    haptics.select();
    try {
      const result = await api.updateConfig({ tool_approval_mode: normalized });
      if (!result.success) {
        throw new Error("Gateway rejected the approval setting.");
      }
      setPendingToolApprovalMode(null);
      refreshSummary();
    } catch (error) {
      setPendingToolApprovalMode(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setToolApprovalUpdating(false);
    }
  };

  const openToolApprovalSelector = () => {
    if (toolApprovalUpdating) return;
    haptics.select();
    const options = [
      { label: "Always Allow", value: "always_allow" },
      { label: "Ask Me", value: "ask" },
    ];
    if (Platform.OS === "ios") {
      const labels = options.map((option) =>
        option.value === toolApprovalMode ? `${option.label} ✓` : option.label
      );
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Tool approvals",
          message: "Choose how Cybara handles tool calls for local chats.",
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
        },
        (index) => {
          const option = options[index];
          if (option) void changeToolApprovalMode(option.value);
        }
      );
      return;
    }
    Alert.alert("Tool approvals", "Choose how Cybara handles tool calls for local chats.", [
      ...options.map((option) => ({
        text: option.value === toolApprovalMode ? `${option.label} ✓` : option.label,
        onPress: () => {
          void changeToolApprovalMode(option.value);
        },
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const changeSessionAgent = async (agentId: string) => {
    if (agentId === MOBILE_MODEL_ROUTER_SELECTOR_VALUE) {
      if (!routerEnabled || agentUpdating) return;
      setUseModelRouter(true);
      setAgentUpdating(true);
      haptics.select();
      try {
        const result = await api.updateSessionAgent(sessionId, undefined, true);
        if (!result.success) {
          throw new Error(result.error || "Failed to update session routing.");
        }
        setDetail((current) =>
          current ? { ...current, useModelRouter: result.useModelRouter === true } : current
        );
      } catch (error) {
        setUseModelRouter(false);
        setLoadError(error instanceof Error ? error.message : "Failed to update session routing.");
      } finally {
        setAgentUpdating(false);
      }
      return;
    }
    if (!agentId || agentId === currentAgentId || agentUpdating) return;
    setUseModelRouter(false);
    setAgentUpdating(true);
    setPendingSessionAgentId(agentId);
    haptics.select();
    try {
      const result = await api.updateSessionAgent(sessionId, agentId);
      if (!result.success) {
        throw new Error(result.error || "Failed to update session agent.");
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              useModelRouter: false,
              agentId: result.agentId ?? agentId,
              provider: result.provider ?? current.provider,
              providerId: result.providerId ?? current.providerId,
              providerName: result.providerName ?? current.providerName,
              model: result.model ?? current.model,
              contextUsage: result.contextUsage ?? current.contextUsage,
              tokenUsage: result.tokenUsage ?? current.tokenUsage,
            }
          : current
      );
      setPendingSessionAgentId(null);
      refreshSummary();
    } catch (error) {
      setPendingSessionAgentId(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentUpdating(false);
    }
  };

  const openAgentSelector = () => {
    if (agentUpdating || (!routerEnabled && agents.length === 0)) return;
    haptics.select();
    if (Platform.OS === "ios") {
      const labels = agentOptions.map((option) =>
        (useModelRouter && option.value === MOBILE_MODEL_ROUTER_SELECTOR_VALUE) ||
        (!useModelRouter && option.value === currentAgentId)
          ? `${option.label} ✓`
          : option.label
      );
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Chat settings",
          message: [
            `Agent: ${useModelRouter ? "Model Router" : (selectedAgent?.name ?? "Gateway default")}`,
            mobileContextUsageDetail(contextUsage),
            mobileSessionTokenUsageDetail(detail?.tokenUsage),
            mobileProviderPlanDetail(activeProviderPlan),
          ]
            .filter(Boolean)
            .join("\n"),
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
        },
        (index) => {
          const option = agentOptions[index];
          if (
            option?.value &&
            (option.value === MOBILE_MODEL_ROUTER_SELECTOR_VALUE || option.value !== currentAgentId)
          ) {
            void changeSessionAgent(option.value);
          }
        }
      );
      return;
    }
    const buttons: Array<{
      text: string;
      onPress?: () => void;
      style?: "default" | "cancel" | "destructive";
    }> = agentOptions.slice(0, 8).map((option) => ({
      text:
        (useModelRouter && option.value === MOBILE_MODEL_ROUTER_SELECTOR_VALUE) ||
        (!useModelRouter && option.value === currentAgentId)
          ? `${option.label} ✓`
          : option.label,
      onPress: () => {
        if (
          option.value === MOBILE_MODEL_ROUTER_SELECTOR_VALUE ||
          option.value !== currentAgentId
        ) {
          void changeSessionAgent(option.value);
        }
      },
    }));
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(
      "Chat settings",
      [
        `Agent: ${useModelRouter ? "Model Router" : (selectedAgent?.name ?? "Gateway default")}`,
        mobileContextUsageDetail(contextUsage),
        mobileSessionTokenUsageDetail(detail?.tokenUsage),
        mobileProviderPlanDetail(activeProviderPlan),
      ]
        .filter(Boolean)
        .join("\n"),
      buttons
    );
  };

  const changeReasoningEffort = async (effort: AgentSummary["reasoning_effort"]) => {
    if (!selectedAgent || reasoningUpdating || effort === reasoningEffort) return;
    setReasoningUpdating(true);
    setReasoningOverride({ agentId: selectedAgent.id, effort });
    haptics.select();
    try {
      const result = await api.updateAgentReasoning(selectedAgent.id, effort);
      if (!result.success) throw new Error(result.error || "Failed to update reasoning effort.");
      refreshSummary();
    } catch (error) {
      setReasoningOverride(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReasoningUpdating(false);
    }
  };

  const openReasoningSelector = () => {
    if (!selectedAgent || useModelRouter || reasoningUpdating) return;
    const labels = reasoningOptions.map((option) =>
      option.value === reasoningEffort ? `${option.label} ✓` : option.label
    );
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Reasoning effort",
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
        },
        (index) => {
          const option = reasoningOptions[index];
          if (option) void changeReasoningEffort(option.value);
        }
      );
      return;
    }
    Alert.alert("Reasoning effort", undefined, [
      ...reasoningOptions.map((option) => ({
        text: option.value === reasoningEffort ? `${option.label} ✓` : option.label,
        onPress: () => void changeReasoningEffort(option.value),
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const messageCount = detail?.messages.length ?? sessionSummary?.message_count ?? 0;
  const updatedAt =
    detail?.updatedAt ||
    sessionSummary?.updated_at ||
    detail?.messages[detail.messages.length - 1]?.timestamp;
  const title = mobileSessionTitle({
    title: mobileFirstNonEmptyString(detail?.title, sessionSummary?.title),
  });
  const agentId = mobileFirstNonEmptyString(detail?.agentId, sessionSummary?.agent_id);
  const model = mobileFirstNonEmptyString(detail?.model, sessionSummary?.model);
  const provider = mobileFirstNonEmptyString(
    detail?.provider,
    sessionSummary?.provider,
    sessionSummary?.provider_id
  );
  const providerName = mobileFirstNonEmptyString(
    detail?.providerName,
    sessionSummary?.provider_name
  );
  const providerModelLabel = sessionProviderModelLabel({
    agentId,
    model,
    provider,
    providerName,
  });
  const selectedAgentLabel = useModelRouter
    ? "Model Router"
    : selectedAgent?.name || (agentId ? "Selected agent" : "Gateway default");
  const contextSummary = contextUsage
    ? `${mobileFormatTokenCount(contextUsage.usedTokens)} / ${mobileFormatTokenCount(
        contextUsage.limitTokens
      )} tokens (${contextUsage.usedPercent}%)`
    : "Loading from gateway";
  const tokenSummary =
    detail?.tokenUsage && detail.tokenUsage.totalTokens > 0
      ? `${mobileFormatTokenCount(detail.tokenUsage.inputTokens)} in / ${mobileFormatTokenCount(
          detail.tokenUsage.outputTokens
        )} out`
      : "No token usage recorded";
  const planDetail = mobileProviderPlanDetail(activeProviderPlan);
  const browserActive = mobileAgentUsingBrowser(liveAssistant, sessionActive);
  const chatSettingsRows: ChatSettingsRow[] = [
    {
      icon: Bot,
      label: "Agent",
      value: selectedAgentLabel,
      detail: providerModelLabel !== selectedAgentLabel ? providerModelLabel : null,
    },
    {
      icon: MessageSquareText,
      label: "Messages",
      value: `${messageCount} message${messageCount === 1 ? "" : "s"}`,
      detail: `Updated ${absoluteTimestampLabel(updatedAt)}`,
    },
    {
      icon: Gauge,
      label: "Context",
      value: contextSummary,
      detail: mobileContextUsageDetail(contextUsage),
    },
    {
      icon: Clock3,
      label: "Tokens",
      value: tokenSummary,
      detail: mobileSessionTokenUsageDetail(detail?.tokenUsage),
    },
    ...(planDetail
      ? [
          {
            icon: Gauge,
            label: "Plan usage",
            value: planDetail.replace(/^Plan usage:\s*/, ""),
          } satisfies ChatSettingsRow,
        ]
      : []),
    ...(browserActive
      ? [
          {
            icon: Globe2,
            label: "Browser",
            value: "Agent is browsing",
          } satisfies ChatSettingsRow,
        ]
      : []),
    {
      icon: ShieldAlert,
      label: "Tool approvals",
      value: toolApprovalLabel,
    },
    {
      icon: Brain,
      label: "Reasoning",
      value: reasoningLabel,
      detail: selectedAgent ? "Agent setting" : "Select an agent",
    },
    {
      icon: Folder,
      label: "Workspace",
      value: compactWorkspace(chatWorkspaceDir),
      detail:
        chatWorkspaceDir && compactWorkspace(chatWorkspaceDir) !== chatWorkspaceDir
          ? chatWorkspaceDir
          : null,
    },
    {
      icon: GitBranch,
      label: "Branch",
      value: gitBranch || (gitBranchLoading ? "Loading..." : "No branch"),
      detail: gitBranchError,
    },
  ];
  const runFromChatSettings = (action: () => void) => {
    setChatSettingsVisible(false);
    setTimeout(action, 180);
  };
  const saveGoldenRunFromChatSettings = () => {
    setChatSettingsVisible(false);
    setTimeout(() => void saveGoldenRun(), 180);
  };
  const shareNearbyChat = async () => {
    setNearbySharing(true);
    try {
      const nearby = await api.nearbyStatus();
      if (!nearby.settings.enabled || nearby.pairedPeers.length === 0) {
        Alert.alert(
          "No nearby devices",
          "Enable Nearby Cybara and pair a trusted device in Gateway settings first."
        );
        return;
      }
      const send = async (peerId: string, peerName: string) => {
        try {
          await api.sendNearbySession(peerId, sessionId);
          haptics.success();
          Alert.alert("Chat sent", `Sent securely to ${peerName}.`);
        } catch (error) {
          Alert.alert("Unable to send chat", error instanceof Error ? error.message : "Try again.");
        }
      };
      if (Platform.OS === "ios") {
        const names = nearby.pairedPeers.map((peer) => peer.name);
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: "Send to Nearby Cybara",
            options: [...names, "Cancel"],
            cancelButtonIndex: names.length,
          },
          (index) => {
            const peer = nearby.pairedPeers[index];
            if (peer) void send(peer.id, peer.name);
          }
        );
      } else {
        Alert.alert("Send to Nearby Cybara", "Choose a verified device.", [
          ...nearby.pairedPeers.map((peer) => ({
            text: peer.name,
            onPress: () => void send(peer.id, peer.name),
          })),
          { text: "Cancel", style: "cancel" as const },
        ]);
      }
    } catch (error) {
      Alert.alert(
        "Nearby unavailable",
        error instanceof Error ? error.message : "Full-access pairing may be required."
      );
    } finally {
      setNearbySharing(false);
    }
  };
  const chatSettingsActions: ChatSettingsAction[] = [
    {
      icon: Bot,
      label: "Subagents",
      onPress: () => runFromChatSettings(() => setSubagentsVisible(true)),
    },
    {
      icon: ShieldAlert,
      label: "Tool approvals",
      disabled: toolApprovalUpdating,
      onPress: () => runFromChatSettings(openToolApprovalSelector),
    },
    {
      icon: Brain,
      label: "Reasoning effort",
      disabled: reasoningUpdating || useModelRouter || !selectedAgent,
      onPress: () => runFromChatSettings(openReasoningSelector),
    },
    ...(agents.length || routerEnabled
      ? [
          {
            icon: Bot,
            label: "Change agent",
            disabled: agentUpdating,
            onPress: () => runFromChatSettings(openAgentSelector),
          } satisfies ChatSettingsAction,
        ]
      : []),
    ...(chatWorkspaceDir
      ? [
          {
            icon: GitBranch,
            label: "Change branch",
            disabled: gitBranchLoading,
            onPress: () =>
              runFromChatSettings(() => {
                setBranchPickerVisible(true);
                void refreshMobileGitBranches();
              }),
          } satisfies ChatSettingsAction,
        ]
      : []),
    {
      icon: Pin,
      label: pinned ? "Unpin chat" : "Pin chat",
      disabled: pinning,
      onPress: () => runFromChatSettings(() => void togglePinned()),
    },
    {
      icon: GitFork,
      label: "Fork chat",
      disabled: reliabilityAction !== null,
      onPress: () => runFromChatSettings(() => void forkChat()),
    },
    ...(nearbyEnabled
      ? [
          {
            icon: Share2,
            label: "Send nearby",
            disabled: nearbySharing,
            onPress: () => runFromChatSettings(() => void shareNearbyChat()),
          } satisfies ChatSettingsAction,
        ]
      : []),
    ...(goldenTurnActionsEnabled
      ? [
          {
            icon: FlaskConical,
            label: "Save golden run",
            disabled:
              reliabilityAction !== null ||
              !detail?.messages.some((message) => message.role === "assistant"),
            onPress: saveGoldenRunFromChatSettings,
          } satisfies ChatSettingsAction,
        ]
      : []),
    {
      icon: Trash2,
      label: "Delete chat",
      destructive: true,
      onPress: () => runFromChatSettings(deleteChat),
    },
  ];

  const showChatActions = () => {
    haptics.select();
    setChatSettingsVisible(true);
  };
  headerActionRef.current = showChatActions;

  useEffect(() => {
    return () => {
      setHeaderAction?.(null);
    };
  }, [setHeaderAction, sessionId]);

  useEffect(() => {
    setHeaderAction?.({
      busy:
        pinning ||
        agentUpdating ||
        reasoningUpdating ||
        toolApprovalUpdating ||
        gitBranchLoading ||
        reliabilityAction !== null ||
        nearbySharing,
      onPress: () => headerActionRef.current(),
    });
  }, [
    agentUpdating,
    gitBranchLoading,
    pinning,
    reasoningUpdating,
    reliabilityAction,
    nearbySharing,
    sessionId,
    setHeaderAction,
    toolApprovalUpdating,
  ]);

  const renderMessages = useMemo(() => {
    const messages = detail?.messages ?? [];
    if (!liveAssistant) return messages;
    if (messages.some((message) => message.id === liveAssistant.id)) return messages;
    return [...messages, liveAssistant];
  }, [detail?.messages, liveAssistant]);
  const visibleMessages = useMemo(
    () => latestVisibleChatMessages(renderMessages),
    [renderMessages]
  );
  const transcriptHasMixedAgents = useMemo(
    () => mobileTranscriptHasMixedAuthors(renderMessages),
    [renderMessages]
  );
  const waitingForAssistant = chatIsWaitingForAssistant(renderMessages, sending);
  const keyboardOffset = Platform.OS === "ios" ? keyboardHeight : 0;
  const composerBottom = keyboardVisible ? keyboardOffset + spacing.xs : navFootprint + spacing.xs;
  const composerReservedHeight = Math.max(composerBarHeight, MOBILE_CHAT_CHROME.composerHeight);
  return (
    <ChatKeyboardContainer keyboardVerticalOffset={insets.top + spacing.xs}>
      <MobileBranchPicker
        branches={gitBranches}
        currentBranch={gitBranch}
        error={gitBranchError}
        loading={gitBranchLoading}
        onCheckout={(branch) => void changeMobileGitBranch(branch)}
        onClose={() => setBranchPickerVisible(false)}
        onCreate={(branch) => void changeMobileGitBranch(branch, true)}
        visible={branchPickerVisible}
      />
      <MobileSubagentsSheet
        agentId={agentId}
        api={api}
        onClose={() => setSubagentsVisible(false)}
        sessionId={sessionId}
        visible={subagentsVisible}
        workspaceDir={chatWorkspaceDir}
      />
      <ChatSettingsSheet
        actions={chatSettingsActions}
        onClose={() => setChatSettingsVisible(false)}
        rows={chatSettingsRows}
        subtitle={selectedAgentLabel}
        title={title}
        visible={chatSettingsVisible}
      />
      <ChatApprovalBanner api={api} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.chatContent,
          {
            paddingBottom: composerBottom + composerReservedHeight + spacing.md,
            paddingHorizontal: mobileChatHorizontalPadding(chatAppearance.horizontalPadding),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!followChatBottomRef.current) return;
          scrollChatToEnd();
        }}
        onMomentumScrollBegin={() => {
          chatScrollGestureActiveRef.current = true;
        }}
        onMomentumScrollEnd={(event) => {
          updateChatFollowFromScroll(event);
          chatScrollGestureActiveRef.current = false;
        }}
        onScroll={(event) => {
          if (!chatScrollGestureActiveRef.current) return;
          updateChatFollowFromScroll(event);
        }}
        onScrollBeginDrag={() => {
          chatScrollGestureActiveRef.current = true;
          followChatBottomRef.current = false;
        }}
        onScrollEndDrag={(event) => {
          updateChatFollowFromScroll(event);
          chatScrollGestureActiveRef.current = false;
          if (followChatBottomRef.current) scrollChatToEnd();
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.chatScroll}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={accentColor} />
            <Text style={styles.listDetail}>Loading chat from gateway</Text>
          </View>
        ) : null}
        {loadError ? <EmptyState label="Session unavailable" detail={loadError} /> : null}
        {detail ? (
          <>
            <MobileGoalCard api={api} sessionId={sessionId} working={sessionActive} />
            {sessionActive && detail.plan ? <MobilePlanSummaryCard plan={detail.plan} /> : null}
            {visibleMessages.map((message, index) => (
              <ChatMessageRow
                key={`${message.id}-${index}`}
                accentColor={accentColor}
                appearance={chatAppearance}
                message={message}
                mediaUrl={(filePath) => api.mediaUrl(filePath)}
                nowMs={message.id === liveAssistant?.id && sessionActive ? liveNowMs : undefined}
                showAuthor={transcriptHasMixedAgents}
                onAddToChat={appendTextToComposer}
                onRevert={message.role === "user" ? confirmRevertToMessage : undefined}
              />
            ))}
            {waitingForAssistant ? (
              <View style={styles.typingRow}>
                <ActivityIndicator color={accentColor} size="small" />
                <Text style={styles.listDetail}>Waiting for assistant response</Text>
              </View>
            ) : null}
            {pendingMessages.length > 0 ? (
              <View style={styles.pendingQueue}>
                <Text style={styles.pendingQueueTitle}>
                  {pendingMessages.length === 1
                    ? "1 pending message"
                    : `${pendingMessages.length} pending messages`}
                </Text>
                {pendingMessages.map((pendingMessage) => {
                  const steering = pendingMessage.mode === "steering";
                  const optimisticPending = mobilePendingMessageIsOptimistic(pendingMessage);
                  const busy =
                    steeringPendingId === pendingMessage.id ||
                    reorderingPendingId === pendingMessage.id ||
                    mutatingPendingId === pendingMessage.id;
                  const pendingIndex = pendingMessages.findIndex(
                    (entry) => entry.id === pendingMessage.id
                  );
                  const canMove =
                    !optimisticPending && !steering && pendingMessages.length > 1 && !busy;
                  return (
                    <View key={pendingMessage.id} style={styles.pendingQueueItem}>
                      <View style={styles.pendingQueueText}>
                        <Text style={styles.pendingQueueMeta}>
                          {optimisticPending ? "Queueing..." : steering ? "Steering" : "Queued"} -{" "}
                          {relativeTimestamp(new Date(pendingMessage.createdAt).toISOString())}
                        </Text>
                        <Text numberOfLines={1} style={styles.pendingQueueContent}>
                          {pendingMessage.content}
                        </Text>
                      </View>
                      <View style={styles.pendingQueueActions}>
                        {pendingMessages.length > 1 ? (
                          <View style={styles.pendingOrderControls}>
                            <Pressable
                              accessibilityLabel="Move pending message up"
                              accessibilityRole="button"
                              disabled={!canMove || pendingIndex <= 0}
                              onPress={() => {
                                void movePendingMessage(pendingMessage.id, -1);
                              }}
                              style={[
                                styles.pendingOrderButton,
                                !canMove || pendingIndex <= 0
                                  ? styles.pendingOrderButtonDisabled
                                  : null,
                              ]}
                            >
                              <ArrowUp color={colors.text} size={13} strokeWidth={2.4} />
                            </Pressable>
                            <Pressable
                              accessibilityLabel="Move pending message down"
                              accessibilityRole="button"
                              disabled={!canMove || pendingIndex >= pendingMessages.length - 1}
                              onPress={() => {
                                void movePendingMessage(pendingMessage.id, 1);
                              }}
                              style={[
                                styles.pendingOrderButton,
                                !canMove || pendingIndex >= pendingMessages.length - 1
                                  ? styles.pendingOrderButtonDisabled
                                  : null,
                              ]}
                            >
                              <ArrowDown color={colors.text} size={13} strokeWidth={2.4} />
                            </Pressable>
                          </View>
                        ) : null}
                        {!steering ? (
                          <View style={styles.pendingOrderControls}>
                            <Pressable
                              accessibilityLabel="Edit pending message"
                              accessibilityRole="button"
                              disabled={optimisticPending || busy}
                              onPress={() => openEditPendingMessage(pendingMessage)}
                              style={[
                                styles.pendingOrderButton,
                                optimisticPending || busy
                                  ? styles.pendingOrderButtonDisabled
                                  : null,
                              ]}
                            >
                              <Pencil color={colors.text} size={13} strokeWidth={2.4} />
                            </Pressable>
                            <Pressable
                              accessibilityLabel="Delete pending message"
                              accessibilityRole="button"
                              disabled={optimisticPending || busy}
                              onPress={() => {
                                void deletePendingMessage(pendingMessage);
                              }}
                              style={[
                                styles.pendingOrderButton,
                                optimisticPending || busy
                                  ? styles.pendingOrderButtonDisabled
                                  : null,
                              ]}
                            >
                              <Trash2 color={colors.red} size={13} strokeWidth={2.4} />
                            </Pressable>
                          </View>
                        ) : null}
                        {!steering && followUpBehaviorEnabled ? (
                          <Pressable
                            accessibilityLabel="Steer pending message"
                            accessibilityRole="button"
                            disabled={optimisticPending || busy}
                            onPress={() => {
                              void steerPendingMessage(pendingMessage.id);
                            }}
                            style={[
                              styles.pendingSteerButton,
                              optimisticPending || busy ? { opacity: 0.6 } : null,
                            ]}
                          >
                            <Text style={styles.pendingSteerText}>
                              {optimisticPending
                                ? "Queueing..."
                                : steeringPendingId === pendingMessage.id
                                  ? "Steering"
                                  : "Steer"}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {visibleMessages.length === 0 ? (
              <EmptyState label="No messages" detail="This session has no stored messages yet." />
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <LiquidGlass
        intensity={64}
        opaque={chatAppearance.reduceTransparency}
        contentStyle={styles.chatComposerContent}
        style={[styles.chatComposerBar, { bottom: composerBottom }]}
      >
        <View
          style={styles.composerColumn}
          onLayout={(event) =>
            setComposerBarHeight(event.nativeEvent.layout.height + spacing.xs * 2)
          }
        >
          {pendingImages.length > 0 ? (
            <>
              <View style={styles.composerSummary}>
                <Paperclip color={colors.textDim} size={12} strokeWidth={2.4} />
                <Text style={styles.composerSummaryText}>
                  {mobileMediaSummaryLabel(pendingImages, MOBILE_CHAT_MAX_ATTACHMENTS)}
                </Text>
              </View>
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.composerAttachments}
              >
                {pendingImages.map((image, index) => {
                  const sizeLabel = formatBytes(mobilePendingImageBytes(image));
                  return (
                    <View
                      key={`${image.mimeType ?? "image"}-${index}`}
                      style={styles.composerThumb}
                    >
                      <Image
                        resizeMode="cover"
                        source={{ uri: pendingImageUri(image) }}
                        style={styles.composerThumbImage}
                      />
                      {sizeLabel ? (
                        <View style={styles.composerThumbBadge}>
                          <Text style={styles.composerThumbBadgeText}>{sizeLabel}</Text>
                        </View>
                      ) : null}
                      <Pressable
                        accessibilityLabel="Remove image"
                        accessibilityRole="button"
                        onPress={() => removePendingImage(index)}
                        style={styles.composerThumbRemove}
                      >
                        <X color={colors.text} size={12} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              blurOnSubmit={false}
              contextMenuHidden={false}
              editable
              multiline
              onContentSizeChange={(event) => {
                composerMeasuredHeightRef.current = boundedMobileComposerHeight(
                  event.nativeEvent.contentSize.height
                );
                setComposerHeight(
                  mobileComposerHeightForDraft(draftRef.current, composerMeasuredHeightRef.current)
                );
              }}
              value={draft}
              onChangeText={setComposerDraft}
              placeholder="Message this chat"
              placeholderTextColor={colors.textDim}
              returnKeyType="default"
              scrollEnabled={composerHeight >= MOBILE_CHAT_COMPOSER.maxHeight}
              selectionColor={accentColor}
              style={[styles.composerInput, { height: composerHeight }]}
              submitBehavior="newline"
              textAlignVertical="top"
            />
            <Pressable
              accessibilityLabel="Attach files or images"
              accessibilityRole="button"
              disabled={pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS}
              onPress={openAttachmentMenu}
              style={[
                styles.sendButton,
                {
                  backgroundColor: colors.inset,
                  opacity: pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS ? 0.55 : 1,
                },
              ]}
            >
              <Paperclip color={colors.text} size={19} strokeWidth={2.4} />
            </Pressable>
            <Pressable
              accessibilityLabel={
                chatBusy && !draft.trim() && pendingImages.length === 0
                  ? "Stop response"
                  : "Send message"
              }
              accessibilityRole="button"
              disabled={
                (!chatBusy && !draft.trim() && pendingImages.length === 0) ||
                (chatBusy &&
                  !followUpBehaviorEnabled &&
                  (!!draft.trim() || pendingImages.length > 0))
              }
              onPress={
                chatBusy && !draft.trim() && pendingImages.length === 0 ? stopResponse : sendMessage
              }
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    draft.trim() || pendingImages.length > 0 ? accentColor : colors.inset,
                  opacity: draft.trim() || pendingImages.length > 0 || sending ? 1 : 0.55,
                },
              ]}
            >
              {chatBusy && !draft.trim() && pendingImages.length === 0 ? (
                <Square color={colors.text} fill={colors.text} size={15} strokeWidth={2.4} />
              ) : (
                <Send color={colors.text} size={19} strokeWidth={2.4} />
              )}
            </Pressable>
          </View>
        </View>
      </LiquidGlass>
      <Modal
        animationType={chatAppearance.reduceMotion ? "none" : "fade"}
        onRequestClose={closeEditPendingMessage}
        transparent
        visible={editingPendingMessage !== null}
      >
        <View style={styles.pendingEditOverlay}>
          <View style={styles.pendingEditCard}>
            <Text style={styles.pendingEditTitle}>Edit queued message</Text>
            <TextInput
              autoFocus
              contextMenuHidden={false}
              multiline
              onChangeText={setEditingPendingDraft}
              placeholder="Queued message"
              placeholderTextColor={colors.textDim}
              selectionColor={accentColor}
              style={styles.pendingEditInput}
              value={editingPendingDraft}
            />
            <View style={styles.pendingEditActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closeEditPendingMessage}
                style={styles.pendingEditCancelButton}
              >
                <Text style={styles.pendingEditCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!editingPendingDraft.trim() || mutatingPendingId !== null}
                onPress={() => {
                  void updatePendingMessage();
                }}
                style={[
                  styles.pendingEditSaveButton,
                  {
                    backgroundColor:
                      editingPendingDraft.trim() && mutatingPendingId === null
                        ? accentColor
                        : colors.inset,
                  },
                ]}
              >
                <Text style={styles.pendingEditSaveText}>
                  {mutatingPendingId ? "Saving" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ChatKeyboardContainer>
  );
}
