import {
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  Clock3,
  Folder,
  Gauge,
  GitBranch,
  MessageSquareText,
  Paperclip,
  Pencil,
  Pin,
  Send,
  Settings2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react-native";
import {
  type Dispatch,
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
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LiquidGlass } from "../components/LiquidGlass";
import { MobileBranchPicker } from "../components/MobileBranchPicker";
import type {
  AgentSummary,
  CybaraMobileApi,
  GitBranchSummary,
  MobileMessageImage,
  MobilePendingChatMessage,
  PendingToolApproval,
  ProviderPlanStatusResponse,
  SessionContextUsage,
  SessionDetailSummary,
  SessionSummary,
  SessionTokenUsage,
  ToolApprovalDecision,
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
  MOBILE_NAV_CHROME,
  mobileComposerHeightForDraft,
  mobileFirstNonEmptyString,
  mobileSessionTitle,
  mobileSupportedReasoningEfforts,
  readMobileToolApprovalMode,
  sessionProviderModelLabel,
} from "../lib/dashboard";
import { Clipboard, ImagePicker } from "../lib/expoNativeModules";
import { haptics } from "../lib/haptics";
import { colors, spacing } from "../theme/liquidGlass";
import { ChatMessageRow, MobilePlanSummaryCard } from "./dashboardChat";
import { absoluteTimestampLabel, relativeTimestamp } from "./dashboardHelpers";
import {
  clearCachedMobileLiveAssistant,
  liveActivityFromStatusEvent,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  mergeLiveActivity,
  mobilePreSteerProcessActivities,
  prunePersistedMobileLiveAssistant,
  readCachedMobileLiveAssistant,
  subscribeCachedMobileLiveAssistant,
  writeCachedMobileLiveAssistant,
} from "./dashboardLiveChat";
import { mobileProviderPlanDetail } from "./dashboardMetricsPanels";
import {
  clearCachedMobileOptimisticTranscript,
  mergeCachedMobileOptimisticTranscript,
  readCachedMobileOptimisticTranscript,
  writeCachedMobileOptimisticTranscriptMessage,
} from "./dashboardOptimisticTranscript";
import {
  clearCachedMobileOptimisticPendingMessages,
  mergeMobilePendingMessages,
  mobilePendingMessageIsOptimistic,
  readCachedMobileOptimisticPendingMessages,
  writeCachedMobileOptimisticPendingMessages,
} from "./dashboardPendingQueue";
import { EmptyState } from "./dashboardPrimitives";
import { styles } from "./dashboardStyles";
import { MobileSubagentsSheet } from "./dashboardSubagents";

export interface ChatHeaderAction {
  busy: boolean;
  onPress: () => void;
}

const MOBILE_MODEL_ROUTER_SELECTOR_VALUE = "__model_router__";

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

function pendingMessagesFromResponse(result: {
  pendingMessage?: MobilePendingChatMessage;
  pendingMessages?: MobilePendingChatMessage[];
}): MobilePendingChatMessage[] {
  if (Array.isArray(result.pendingMessages)) return result.pendingMessages;
  return result.pendingMessage ? [result.pendingMessage] : [];
}

function ChatApprovalBanner({ api }: { api: CybaraMobileApi }) {
  const [approvals, setApprovals] = useState<PendingToolApproval[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const pending = await api.toolApprovals();
        if (active) setApprovals(pending);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [api]);

  const resolve = async (id: string, decision: ToolApprovalDecision) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    try {
      await api.resolveToolApproval(id, decision);
    } catch {
      /* the next poll re-surfaces it if it failed */
    }
  };

  if (approvals.length === 0) return null;

  return (
    <View style={styles.chatApprovalBanner}>
      {approvals.map((req) => {
        const expanded = expandedId === req.id;
        const hasDetail = req.argsSummary.trim().length > 0;
        return (
          <View key={req.id} style={styles.chatApprovalRow}>
            <View style={styles.chatApprovalLine}>
              <ShieldAlert color={colors.amber} size={16} strokeWidth={2.3} />
              <Pressable
                style={styles.chatApprovalSummary}
                onPress={() => hasDetail && setExpandedId(expanded ? null : req.id)}
              >
                <Text style={styles.chatApprovalTool}>{req.toolName}</Text>
                {hasDetail ? (
                  <Text numberOfLines={1} style={styles.chatApprovalArgs}>
                    {req.argsSummary}
                  </Text>
                ) : null}
              </Pressable>
              <View style={styles.chatApprovalButtons}>
                <Pressable
                  style={[styles.chatApprovalBtn, { backgroundColor: `${colors.green}22` }]}
                  onPress={() => void resolve(req.id, "approve_once")}
                >
                  <Text style={[styles.chatApprovalBtnText, { color: colors.green }]}>Once</Text>
                </Pressable>
                <Pressable
                  style={[styles.chatApprovalBtn, { backgroundColor: `${colors.blueText}22` }]}
                  onPress={() => void resolve(req.id, "approve_session")}
                >
                  <Text style={[styles.chatApprovalBtnText, { color: colors.blueText }]}>
                    Session
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.chatApprovalBtn, { backgroundColor: `${colors.red}22` }]}
                  onPress={() => void resolve(req.id, "deny")}
                >
                  <Text style={[styles.chatApprovalBtnText, { color: colors.red }]}>Deny</Text>
                </Pressable>
              </View>
            </View>
            {expanded && hasDetail ? (
              <Text style={styles.chatApprovalDetail}>{req.argsSummary}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const MOBILE_CHAT_MAX_ATTACHMENTS = 8;
const MOBILE_CHAT_MAX_IMAGE_BASE64_LENGTH = 7_000_000;

type ChatSettingsAction = {
  destructive?: boolean;
  disabled?: boolean;
  icon: typeof Settings2;
  label: string;
  onPress: () => void;
};

type ChatSettingsRow = {
  detail?: string | null;
  icon: typeof Settings2;
  label: string;
  value: string;
};

function pendingImageUri(image: MobileMessageImage): string {
  return `data:${image.mimeType || "image/jpeg"};base64,${image.data ?? ""}`;
}

function ChatSettingsInfoRow({ row }: { row: ChatSettingsRow }) {
  const Icon = row.icon;
  return (
    <View style={styles.chatSettingsInfoRow}>
      <View style={styles.chatSettingsInfoIcon}>
        <Icon color={colors.textMuted} size={16} strokeWidth={2.2} />
      </View>
      <View style={styles.chatSettingsInfoText}>
        <Text style={styles.chatSettingsInfoLabel}>{row.label}</Text>
        <Text selectable style={styles.chatSettingsInfoValue}>
          {row.value}
        </Text>
        {row.detail ? (
          <Text selectable style={styles.chatSettingsInfoDetail}>
            {row.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ChatSettingsActionButton({ action }: { action: ChatSettingsAction }) {
  const Icon = action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={action.disabled}
      onPress={action.onPress}
      style={[
        styles.chatSettingsActionButton,
        action.destructive && styles.chatSettingsActionButtonDestructive,
        action.disabled && styles.chatSettingsActionButtonDisabled,
      ]}
    >
      <Icon color={action.destructive ? colors.red : colors.text} size={16} strokeWidth={2.3} />
      <Text
        style={[
          styles.chatSettingsActionText,
          action.destructive && styles.chatSettingsActionTextDestructive,
        ]}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

function ChatSettingsSheet({
  actions,
  onClose,
  rows,
  subtitle,
  title,
  visible,
}: {
  actions: ChatSettingsAction[];
  onClose: () => void;
  rows: ChatSettingsRow[];
  subtitle: string;
  title: string;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [dragOffset, setDragOffset] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const availableHeight = Math.max(420, windowHeight - insets.top - insets.bottom - spacing.lg);
  const expandedHeight = Math.min(availableHeight, Math.round(windowHeight * 0.84));
  const collapsedHeight = Math.min(expandedHeight, Math.max(360, Math.round(windowHeight * 0.58)));
  const sheetHeight = expanded ? expandedHeight : collapsedHeight;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15,
        onPanResponderMove: (_event, gesture) => {
          const lowerBound = expanded ? 0 : -90;
          setDragOffset(Math.min(180, Math.max(lowerBound, gesture.dy)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!expanded && (gesture.dy < -48 || gesture.vy < -0.7)) {
            setExpanded(true);
            setDragOffset(0);
            return;
          }
          if (expanded && gesture.dy > 76 && gesture.vy < 1.2) {
            setExpanded(false);
            setDragOffset(0);
            return;
          }
          if (gesture.dy > 118 || gesture.vy > 1.1) {
            setDragOffset(0);
            onClose();
            return;
          }
          setDragOffset(0);
        },
        onPanResponderTerminate: () => setDragOffset(0),
      }),
    [expanded, onClose]
  );

  useEffect(() => {
    if (visible) {
      setExpanded(true);
      setDragOffset(0);
    }
  }, [visible]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.chatSettingsOverlay}>
        <Pressable
          accessibilityRole="button"
          style={styles.chatSettingsBackdrop}
          onPress={onClose}
        />
        <View
          style={[
            styles.chatSettingsSheetFrame,
            {
              height: sheetHeight,
              marginBottom: Math.max(spacing.sm, insets.bottom + spacing.sm),
              transform: [{ translateY: dragOffset }],
            },
          ]}
        >
          <LiquidGlass
            intensity={76}
            contentStyle={styles.chatSettingsSheetContent}
            style={styles.chatSettingsSheet}
          >
            <View {...panResponder.panHandlers} style={styles.chatSettingsDragHandle}>
              <View style={styles.chatSettingsGrabber} />
              <View style={styles.chatSettingsHeader}>
                <View style={styles.chatSettingsTitleWrap}>
                  <Text numberOfLines={2} style={styles.chatSettingsTitle}>
                    {title}
                  </Text>
                  <Text numberOfLines={1} style={styles.chatSettingsSubtitle}>
                    {subtitle}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close chat settings"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={onClose}
                  style={styles.chatSettingsCloseButton}
                >
                  <X color={colors.textMuted} size={18} strokeWidth={2.4} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              contentContainerStyle={styles.chatSettingsScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.chatSettingsScroll}
            >
              <View style={styles.chatSettingsInfoGroup}>
                {rows.map((row) => (
                  <ChatSettingsInfoRow key={row.label} row={row} />
                ))}
              </View>
              <View style={styles.chatSettingsActionsGrid}>
                {actions.map((action) => (
                  <ChatSettingsActionButton key={action.label} action={action} />
                ))}
              </View>
            </ScrollView>
          </LiquidGlass>
        </View>
      </View>
    </Modal>
  );
}

export function SessionDetailPanel({
  accentColor,
  api,
  agents,
  closeDetail,
  config,
  providerPlanStatus,
  refreshSummary,
  sessionSummary,
  sessionId,
  setHeaderAction,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  agents: AgentSummary[];
  closeDetail: () => void;
  config?: Record<string, unknown>;
  providerPlanStatus?: ProviderPlanStatusResponse | null;
  refreshSummary: () => void;
  sessionSummary?: SessionSummary | null;
  sessionId: string;
  setHeaderAction?: Dispatch<SetStateAction<ChatHeaderAction | null>>;
}) {
  const insets = useSafeAreaInsets();
  const navFootprint = insets.bottom + MOBILE_NAV_CHROME.floatingMargin + MOBILE_NAV_CHROME.height;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const [detail, setDetail] = useState<SessionDetailSummary | null>(() =>
    optimisticMobileSessionDetail(sessionId, sessionSummary)
  );
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitBranches, setGitBranches] = useState<GitBranchSummary[]>([]);
  const [gitBranchLoading, setGitBranchLoading] = useState(false);
  const [gitBranchError, setGitBranchError] = useState<string | null>(null);
  const [branchPickerVisible, setBranchPickerVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [composerBarHeight, setComposerBarHeight] = useState<number>(
    MOBILE_CHAT_CHROME.composerHeight
  );
  const draftRef = useRef("");
  const composerMeasuredHeightRef = useRef<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState<MobileMessageImage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<MobilePendingChatMessage[]>([]);
  const [steeringPendingId, setSteeringPendingId] = useState<string | null>(null);
  const [reorderingPendingId, setReorderingPendingId] = useState<string | null>(null);
  const [mutatingPendingId, setMutatingPendingId] = useState<string | null>(null);
  const [editingPendingMessage, setEditingPendingMessage] =
    useState<MobilePendingChatMessage | null>(null);
  const [editingPendingDraft, setEditingPendingDraft] = useState("");
  const [pinned, setPinned] = useState(sessionSummary?.pinned ?? false);
  const [pinning, setPinning] = useState(false);
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
  const headerActionRef = useRef<() => void>(() => {});
  const currentSessionIdRef = useRef(sessionId);
  currentSessionIdRef.current = sessionId;
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
          writeCachedMobileLiveAssistant(sessionId, next, nowMs);
        } else {
          clearCachedMobileLiveAssistant(sessionId);
        }
        return next;
      });
    },
    [sessionId]
  );

  const applySessionDetail = useCallback(
    (nextDetail: SessionDetailSummary) => {
      const reconciledDetail = {
        ...nextDetail,
        messages: mergeCachedMobileOptimisticTranscript(sessionId, nextDetail.messages),
      };
      setDetail(reconciledDetail);
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
      sessionRefreshInFlight.current = { sessionId: requestedSessionId, token, promise };
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
      const snapshotAgeMs =
        snapshot && typeof snapshot.timestamp === "number"
          ? Date.now() - snapshot.timestamp
          : Infinity;
      const snapshotFresh = snapshotAgeMs <= 15 * 60 * 1000;
      const snapshotStatus = String(snapshot?.status || "").toLowerCase();
      const active =
        !!snapshot &&
        snapshotFresh &&
        (status.active === true ||
          status.activeSessionIds.includes(sessionId) ||
          snapshotStatus === "thinking" ||
          snapshotStatus === "generating" ||
          snapshotStatus === "tool_executing" ||
          snapshotStatus === "compacting");
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
  }, [api, commitLiveAssistant, sessionId, shouldPreserveOptimisticPending]);

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
    responseHapticActiveRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    const cached = readCachedMobileLiveAssistant(sessionId);
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
    const disconnect = api.connectStatusStream({
      onEvent: (event) => {
        if (event.type === "assistant_token") {
          if (event.sessionId !== sessionId) return;
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
        if (event.status === "idle") {
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
    });
    return disconnect;
  }, [
    api,
    commitLiveAssistant,
    hydrateLiveAssistant,
    loadSession,
    sessionId,
    shouldPreserveOptimisticPending,
  ]);

  useEffect(() => {
    const interval = setInterval(
      () => {
        void loadSession(false);
      },
      sending || liveAssistant ? 1800 : 3500
    );
    return () => clearInterval(interval);
  }, [loadSession, liveAssistant, sending]);

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

  const setComposerDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
    setComposerHeight(mobileComposerHeightForDraft(value, composerMeasuredHeightRef.current));
  };

  const resetComposerDraft = () => {
    draftRef.current = "";
    composerMeasuredHeightRef.current = MOBILE_CHAT_COMPOSER.minHeight;
    setDraft("");
    setComposerHeight(MOBILE_CHAT_COMPOSER.minHeight);
  };

  const appendTextToComposer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nextDraft = draftRef.current.trim()
      ? `${draftRef.current.trimEnd()}\n\n${trimmed}`
      : trimmed;
    setComposerDraft(nextDraft);
  };

  const removePendingImage = (index: number) => {
    setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const appendPendingImages = (candidates: MobileMessageImage[]) => {
    setPendingImages((current) => {
      const next = [...current];
      for (const candidate of candidates) {
        if (next.length >= MOBILE_CHAT_MAX_ATTACHMENTS) break;
        const data = candidate.data;
        if (!data || data.length > MOBILE_CHAT_MAX_IMAGE_BASE64_LENGTH) continue;
        next.push(candidate);
      }
      return next;
    });
  };

  const pickImages = async () => {
    if (pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setLoadError("Photo library access is required to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MOBILE_CHAT_MAX_ATTACHMENTS,
    });
    if (result.canceled) return;
    appendPendingImages(
      result.assets.map((asset) => ({
        data: asset.base64 ?? undefined,
        mimeType: asset.mimeType ?? "image/jpeg",
      }))
    );
  };

  const pasteImage = async () => {
    if (pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS) return;
    const hasImage = await Clipboard.hasImageAsync();
    if (!hasImage) {
      Alert.alert("No image found", "Copy an image first, then attach it from the composer.");
      return;
    }
    const img = await Clipboard.getImageAsync({ format: "png" });
    if (!img) return;
    const rawBase64 = img.data.replace(/^data:[^;]+;base64,/, "");
    appendPendingImages([{ data: rawBase64, mimeType: "image/png" }]);
  };

  const pasteText = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => "")).trim();
    if (!text) {
      Alert.alert(
        "No text found",
        "Copy text from a message first, then paste it into the composer."
      );
      return;
    }
    appendTextToComposer(text);
  };

  const openAttachmentMenu = () => {
    if (pendingImages.length >= MOBILE_CHAT_MAX_ATTACHMENTS) {
      Alert.alert(
        "Attachment limit reached",
        `You can attach up to ${MOBILE_CHAT_MAX_ATTACHMENTS} images per message.`
      );
      return;
    }
    haptics.select();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Attach",
          options: ["Photo library", "Paste image", "Paste text", "Cancel"],
          cancelButtonIndex: 3,
        },
        (index) => {
          if (index === 0) void pickImages();
          if (index === 1) void pasteImage();
          if (index === 2) void pasteText();
        }
      );
      return;
    }
    Alert.alert("Attach", "Choose an attachment source.", [
      {
        text: "Photo library",
        onPress: () => {
          void pickImages();
        },
      },
      {
        text: "Paste image",
        onPress: () => {
          void pasteImage();
        },
      },
      {
        text: "Paste text",
        onPress: () => {
          void pasteText();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const replacePendingMessagesFromGateway = (messages: MobilePendingChatMessage[]) => {
    const nextMessages = mergeMobilePendingMessages(messages, [], { preserveOptimistic: false });
    setPendingMessages(nextMessages);
    if (nextMessages.length === 0) {
      clearCachedMobileOptimisticPendingMessages(sessionId);
    }
  };

  const sendMessage = async () => {
    const message = draft.trim();
    const attachments = pendingImages;
    const queuedSend = sending || !!liveAssistant || pendingMessages.length > 0;
    if (!message && attachments.length === 0) return;
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
      "Revert to this message?",
      "The conversation will be rolled back to this point. Messages after it are removed from the session.",
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
                setComposerDraft(message.content || "");
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
        selectedAgent?.model
      ).map((option) => ({
        value: option.value === "" ? null : option.value,
        label: option.label,
      })),
    [selectedAgent?.provider_id, selectedAgent?.provider, selectedAgent?.model]
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
      if (!routerEnabled) return;
      setUseModelRouter(true);
      haptics.select();
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
        pinning || agentUpdating || reasoningUpdating || toolApprovalUpdating || gitBranchLoading,
      onPress: () => headerActionRef.current(),
    });
  }, [
    agentUpdating,
    gitBranchLoading,
    pinning,
    reasoningUpdating,
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
  const waitingForAssistant = chatIsWaitingForAssistant(renderMessages, sending);
  // When the keyboard is up it already covers the nav bar, so the composer
  // sits just above the keyboard; otherwise it floats above the nav chrome.
  const composerBottom =
    keyboardHeight > 0 ? keyboardHeight + spacing.xs : navFootprint + spacing.xs;

  return (
    <View style={styles.chatShell}>
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
          { paddingBottom: composerBottom + composerBarHeight + spacing.md },
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          scrollRef.current?.scrollToEnd({ animated: false });
        }}
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
            {detail.plan ? <MobilePlanSummaryCard plan={detail.plan} /> : null}
            {visibleMessages.map((message, index) => (
              <ChatMessageRow
                key={`${message.id}-${index}`}
                accentColor={accentColor}
                message={message}
                mediaUrl={(filePath) => api.mediaUrl(filePath)}
                nowMs={message.id === liveAssistant?.id ? liveNowMs : undefined}
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
                        {!steering ? (
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
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={!draft.trim() && pendingImages.length === 0}
              onPress={sendMessage}
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    draft.trim() || pendingImages.length > 0 ? accentColor : colors.inset,
                  opacity: draft.trim() || pendingImages.length > 0 || sending ? 1 : 0.55,
                },
              ]}
            >
              <Send color={colors.text} size={19} strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>
      </LiquidGlass>
      <Modal
        animationType="fade"
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
    </View>
  );
}

function compactWorkspace(value?: string | null): string {
  if (!value) return "No workspace";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `.../${parts.slice(-2).join("/")}`;
}

function mobileFormatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}

function mobileContextUsageDetail(usage?: SessionContextUsage): string {
  if (!usage) return "Context usage is available after the session loads from the gateway.";
  const details = [
    `Active context: ${mobileFormatTokenCount(usage.usedTokens)} of ${mobileFormatTokenCount(
      usage.limitTokens
    )} tokens used (${usage.usedPercent}%). ${mobileFormatTokenCount(
      usage.remainingTokens
    )} tokens remaining.`,
  ];
  if (usage.compacted && (usage.compactionCount || 0) > 0) {
    details.push(
      `Compacted ${usage.compactionCount} time${usage.compactionCount === 1 ? "" : "s"}.`
    );
  }
  if ((usage.metadataTokens || 0) > 0) {
    details.push(
      `${mobileFormatTokenCount(usage.metadataTokens || 0)} tool timeline tokens are not replayed.`
    );
  }
  return details.join(" ");
}

function mobileSessionTokenUsageDetail(usage?: SessionTokenUsage): string | null {
  if (!usage || usage.totalTokens <= 0) return null;
  const speed =
    usage.tokensPerSecond !== null && Number.isFinite(usage.tokensPerSecond)
      ? ` · ${usage.tokensPerSecond} tok/s`
      : "";
  const firstToken =
    usage.firstTokenMs !== null && Number.isFinite(usage.firstTokenMs)
      ? ` · first token ${usage.firstTokenMs < 1000 ? `${Math.round(usage.firstTokenMs)}ms` : `${(usage.firstTokenMs / 1000).toFixed(1)}s`}`
      : "";
  const cache =
    usage.cachedInputTokens > 0 || usage.cacheWriteTokens > 0
      ? ` · cache ${mobileFormatTokenCount(usage.cachedInputTokens)} read / ${mobileFormatTokenCount(usage.cacheWriteTokens)} write`
      : "";
  return `Tokens: ${mobileFormatTokenCount(usage.inputTokens)} input / ${mobileFormatTokenCount(
    usage.outputTokens
  )} output · ${usage.callCount} calls${speed}${firstToken}${cache}`;
}

function mobileProviderPlanFor(
  status: ProviderPlanStatusResponse | null | undefined,
  source: {
    agent?: AgentSummary | null;
    detail?: SessionDetailSummary | null;
    sessionSummary?: SessionSummary | null;
  }
): ProviderPlanStatusResponse["providers"][number] | null {
  if (!status) return null;
  const keys = new Set(
    [
      source.agent?.provider_id,
      source.agent?.provider,
      source.detail?.providerId,
      source.detail?.provider,
      source.sessionSummary?.provider_id,
      source.sessionSummary?.provider,
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  if (keys.size === 0) return null;
  return (
    status.providers.find((plan) =>
      [plan.configuredProviderId, plan.providerId, plan.providerType].some(
        (key) => typeof key === "string" && keys.has(key)
      )
    ) ?? null
  );
}
