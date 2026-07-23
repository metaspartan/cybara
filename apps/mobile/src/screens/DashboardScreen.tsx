import {
  DetailActionButton,
  DetailInfoSection,
  SettingSelector,
  SettingsTabRail,
  SettingToggle,
  SettingsSection,
  SettingsTextField,
  StableDetailPanel,
} from "./dashboardControls";
import {
  ApprovalSettingsPanel,
  ChannelSettingsPanel,
  GatewayManagementPanel,
  MemorySettingsPanel,
  MigrationSettingsPanel,
  ProviderSettingsPanel,
  SystemMonitorDetailPanel,
  SystemPromptPanel,
  TaskSettingsPanel,
  WalletPolicyPanel,
} from "./dashboardSettingsPanels";
import { JourneyPanel } from "./dashboardJourneyPanel";
import { ModelRouterPanel } from "./dashboardModelRouterPanel";
import { SpeechSettingsPanel } from "./dashboardSpeechSettingsPanel";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { haptics } from "../lib/haptics";
import { useThemeControls } from "../theme/ThemeContext";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Box,
  Brain,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Folder,
  Gauge,
  HeartPulse,
  House,
  Link2,
  ListTodo,
  Loader2,
  MessageCircle,
  Mic,
  Network,
  Paperclip,
  Pencil,
  Plus,
  Play,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  UsersRound,
  Volume2,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react-native";
import { GlassPanel } from "../components/Glass";
import { LiquidGlass } from "../components/LiquidGlass";
import { NewChatPanel } from "../components/NewChatPanel";
import { NewTaskPanel } from "../components/NewTaskPanel";
import { MobileBranchPicker } from "../components/MobileBranchPicker";
import {
  CybaraMobileApi,
  sortSessionSummaries,
  type ActivitySummary,
  type AgentSummary,
  type FeatureEndpointKey,
  type FeatureSummary,
  type GitBranchSummary,
  type MobileMessageImage,
  type MobilePendingChatMessage,
  type ProviderSummary,
  type ProviderPlanStatusResponse,
  type PendingToolApproval,
  type RemoteItemSummary,
  type RouterConfig,
  type RouterStatus,
  type SessionContextUsage,
  type SessionDetailSummary,
  type SessionSummary,
  type SessionTokenUsage,
  type SystemPromptFeatureKey,
  type SystemMonitorSnapshot,
  type ToolApprovalDecision,
  type WalletAgentPolicyUpdate,
  type WalletChain,
  type WalletTokenChain,
} from "../lib/api";
import {
  chatIsWaitingForAssistant,
  latestVisibleChatMessages,
  mobileMediaSummaryLabel,
  mobilePendingImageBytes,
  formatBytes,
} from "../lib/chat-format";
import type { GatewayProfile } from "../lib/connection";
import {
  MOBILE_NAV_CHROME,
  MOBILE_CHAT_COMPOSER,
  MOBILE_CHAT_DETAIL_CHROME,
  MOBILE_CHAT_CHROME,
  MOBILE_HOME_CHROME,
  MOBILE_RECENT_ACTIVITY_CHROME,
  MOBILE_ACCENT_KEYS,
  MOBILE_LOGS_CHROME,
  MOBILE_MAIN_TAB_CHROME,
  MOBILE_METRICS_CHROME,
  MOBILE_REASONING_EFFORT_OPTIONS,
  MOBILE_ROUTER_STRATEGY_OPTIONS,
  MOBILE_SETTINGS_DETAIL_CHROME,
  MOBILE_SETTINGS_ROOT_CHROME,
  MOBILE_SETTINGS_SURFACES,
  MOBILE_SETTINGS_TABS,
  MOBILE_SYSTEM_PROMPT_FEATURE_KEYS,
  MOBILE_TABS,
  boundedMobileComposerHeight,
  buildMobileChatSettingsLines,
  buildMobileHeaderCopy,
  compactLastUpdatedLabel,
  compactHost,
  formatUptime,
  formatMobileValue,
  isMobileSettingsDetailFieldVisible,
  lastUpdatedLabel,
  mobileComposerHeightForDraft,
  mobileBackRouteForDetail,
  mobileFirstNonEmptyString,
  mobileGatewayAuthStatus,
  mobileProviderAuthMode,
  mergeSessionDetailIntoSummary,
  mobileSessionTitle,
  mobileThemeConfigPayload,
  recentSessionStateLabel,
  sessionProviderModelLabel,
  readMobileDangerousToolPolicy,
  readMobileReasoningEffort,
  readMobileRouterStrategy,
  readMobileSandboxRuntime,
  readMobileAccent,
  readMobileToolApprovalMode,
  summarizeFeatureCounts,
  type FeatureCounts,
  type MobileSettingsTab,
  type MobileSurfaceKey,
  type MobileTabKey,
} from "../lib/dashboard";
import {
  formatMetricBytes,
  formatStorageBytes,
  mergeMetricsOverview,
  type MetricsSnapshot,
} from "../lib/metrics";
import { accentPalette, colors, spacing, type AccentKey } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
import { Clipboard, ImagePicker } from "../lib/expoNativeModules";
import {
  absoluteTimestampLabel,
  agentIsRunning,
  agentProviderId,
  arraySettingCount,
  booleanSetting,
  cleanSettingsFields,
  displayFieldLabel,
  displayFields,
  endpointErrorDetail,
  endpointStatusLabel,
  mobileSpeechProviderOptions,
  monitorOverviewLabel,
  monitorPercent,
  monitorPercentLabel,
  monitorPlatformLabel,
  objectRecord,
  readMobileSpeechSettings,
  relativeTimestamp,
  remoteItemEnabled,
  remoteTaskRunning,
  resolveAccentKey,
  sessionMayBeInProgress,
  surfaceCount,
  type EndpointState,
  type MobileSpeechSettings,
} from "./dashboardHelpers";

import { ChatMessageRow, MobilePlanSummaryCard } from "./dashboardChat";
import { MetricsPanel, UsagePanel, mobileProviderPlanDetail } from "./dashboardMetricsPanels";
import {
  ItemDetailPanel,
  SettingsPanel,
  SurfaceDetailPanel,
  TasksPanel,
} from "./dashboardDetailPanels";
import { SessionDetailPanel, type ChatHeaderAction } from "./dashboardSessionDetail";
import {
  mergeActivityLogs,
  routeHeader,
  surfaceMenuDetail,
  surfaceRows,
  type DetailRoute,
  type ModuleCard,
} from "./dashboardSurfaceData";
import {
  clearCachedMobileLiveAssistant,
  liveActivityFromStatusEvent,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  mergeLiveActivity,
  mobilePreSteerProcessActivities,
  prunePersistedMobileLiveAssistant,
  readCachedMobileLiveAssistant,
  writeCachedMobileLiveAssistant,
} from "./dashboardLiveChat";
import {
  clearCachedMobileOptimisticPendingMessages,
  hydrateMobileOptimisticPendingQueue,
  mergeMobilePendingMessages,
  mobilePendingMessageIsOptimistic,
  readCachedMobileOptimisticPendingMessages,
  writeCachedMobileOptimisticPendingMessages,
} from "./dashboardPendingQueue";
import { hydrateMobileOptimisticTranscripts } from "./dashboardOptimisticTranscript";
import { persistLastOpenedSessionId, readLastOpenedSessionId } from "../lib/chatCachePersistence";
import {
  EmptyState,
  GatewayDetailPill,
  LoadingState,
  SettingsRow,
  SummaryTile,
  type IconGlyph,
} from "./dashboardPrimitives";
import cybaraLogo from "../../assets/cybara.png";

const tabIcons: Record<MobileTabKey, IconGlyph> = {
  overview: House,
  sessions: UsersRound,
  metrics: Cpu,
  usage: Gauge,
  tasks: CalendarCheck,
  settings: Settings,
};

export function DashboardScreen({
  profile,
  onDisconnect,
  onProfileUpdated,
}: {
  profile: GatewayProfile;
  onDisconnect: () => void;
  onProfileUpdated?: (profile: GatewayProfile) => void | Promise<void>;
}) {
  const api = useMemo(() => new CybaraMobileApi(profile), [profile]);
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<FeatureSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsRefreshing, setMetricsRefreshing] = useState(false);
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState<number | null>(null);
  const [providerPlanStatus, setProviderPlanStatus] = useState<ProviderPlanStatusResponse | null>(
    null
  );
  const [providerPlanError, setProviderPlanError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileTabKey>("overview");
  const [detailRoute, setDetailRoute] = useState<DetailRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [accentOverride, setAccentOverride] = useState<AccentKey | null>(null);
  const [chatHeaderAction, setChatHeaderAction] = useState<ChatHeaderAction | null>(null);
  const [pagedLogs, setPagedLogs] = useState<ActivitySummary[]>([]);
  const [logPageMeta, setLogPageMeta] = useState<{
    total: number;
    limit: number;
    hasMore: boolean;
  }>({
    total: 0,
    limit: MOBILE_LOGS_CHROME.pageSize,
    hasMore: false,
  });
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [logPageError, setLogPageError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const metricsRefreshInFlight = useRef(false);
  const metricsOverviewRefreshInFlight = useRef(false);
  const metricsLastLoadedAtRef = useRef(0);
  const metricsOverviewLastLoadedAtRef = useRef(0);
  const logPageInFlight = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const activeSurface =
    detailRoute?.kind === "surface" || detailRoute?.kind === "item" ? detailRoute.surface : null;

  const closeDetailRoute = () => {
    setChatHeaderAction(null);
    setDetailRoute((route) => {
      if (route?.kind === "session") void persistLastOpenedSessionId(null);
      return mobileBackRouteForDetail(route);
    });
  };

  const openSessionRoute = (id: string) => {
    setDetailRoute({ kind: "session", id });
    void persistLastOpenedSessionId(id);
  };

  const syncSessionSummary = useCallback((detail: SessionDetailSummary) => {
    setSummary((current) => mergeSessionDetailIntoSummary(current, detail));
  }, []);

  const refresh = async (showRefreshing = true) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (showRefreshing) setRefreshing(true);
    setError(null);
    try {
      const [nextSummary, nextProviderPlans] = await Promise.all([
        api.featureSummary(),
        api
          .providerPlanStatus()
          .then((data) => ({ data, error: null }))
          .catch((providerError: unknown) => ({
            data: null,
            error: providerError instanceof Error ? providerError.message : String(providerError),
          })),
      ]);
      setSummary(nextSummary);
      if (nextProviderPlans.data) setProviderPlanStatus(nextProviderPlans.data);
      setProviderPlanError(nextProviderPlans.error);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      refreshInFlight.current = false;
      if (showRefreshing) setRefreshing(false);
    }
  };

  const refreshMetricsOverview = async (options: { force?: boolean } = {}) => {
    if (metricsOverviewRefreshInFlight.current) return;
    const now = Date.now();
    if (
      !options.force &&
      now - metricsOverviewLastLoadedAtRef.current < MOBILE_METRICS_CHROME.liveRefreshMs
    ) {
      return;
    }
    metricsOverviewRefreshInFlight.current = true;
    try {
      const overview = await api.metricsOverview();
      setMetrics((current) => mergeMetricsOverview(current, overview));
      metricsOverviewLastLoadedAtRef.current = Date.now();
      setMetricsUpdatedAt(Date.now());
    } catch (refreshError) {
      if (!metrics) {
        setMetricsError(
          refreshError instanceof Error ? refreshError.message : String(refreshError)
        );
      }
      metricsOverviewLastLoadedAtRef.current = Date.now();
    } finally {
      metricsOverviewRefreshInFlight.current = false;
    }
  };

  const refreshMetrics = async (options: { force?: boolean } = {}) => {
    if (metricsRefreshInFlight.current) return;
    const now = Date.now();
    if (
      !options.force &&
      now - metricsLastLoadedAtRef.current < MOBILE_METRICS_CHROME.minRefreshMs
    ) {
      return;
    }
    metricsRefreshInFlight.current = true;
    setMetricsRefreshing(true);
    setMetricsError(null);
    try {
      setMetrics(await api.metricsSnapshot());
      metricsLastLoadedAtRef.current = Date.now();
      metricsOverviewLastLoadedAtRef.current = Date.now();
      setMetricsUpdatedAt(Date.now());
    } catch (refreshError) {
      setMetricsError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      metricsLastLoadedAtRef.current = Date.now();
    } finally {
      metricsRefreshInFlight.current = false;
      setMetricsRefreshing(false);
    }
  };

  useEffect(() => {
    const firstPage = summary?.logs ?? [];
    const keepExpandedLogs = activeSurface === "logs";
    setPagedLogs((current) =>
      keepExpandedLogs && current.length > firstPage.length
        ? mergeActivityLogs(firstPage, current)
        : firstPage
    );
    setLogPageError(null);
  }, [activeSurface, summary?.logs]);

  useEffect(() => {
    const total = summary?.logsTotal ?? summary?.logs.length ?? 0;
    setLogPageMeta({
      total,
      limit: summary?.logsLimit ?? MOBILE_LOGS_CHROME.pageSize,
      hasMore: pagedLogs.length < total,
    });
  }, [pagedLogs.length, summary?.logs.length, summary?.logsLimit, summary?.logsTotal]);

  const loadMoreLogs = async () => {
    if (logPageInFlight.current || !logPageMeta.hasMore) return;
    logPageInFlight.current = true;
    setLoadingMoreLogs(true);
    setLogPageError(null);
    try {
      const page = await api.logsPage(logPageMeta.limit, pagedLogs.length);
      setPagedLogs((current) => mergeActivityLogs(current, page.logs));
      setLogPageMeta({
        total: page.total,
        limit: page.limit,
        hasMore: page.hasMore,
      });
    } catch (loadError) {
      setLogPageError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      logPageInFlight.current = false;
      setLoadingMoreLogs(false);
    }
  };

  const refreshAll = async (showRefreshing = true) => {
    if (showRefreshing) setRefreshing(true);
    const shouldRefreshMetrics =
      !MOBILE_METRICS_CHROME.lazyLoadUntilOpened || activeTab === "metrics";
    await Promise.all([
      refresh(false),
      shouldRefreshMetrics ? refreshMetrics({ force: true }) : Promise.resolve(),
    ]);
    if (showRefreshing) setRefreshing(false);
  };

  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;
  const restoredSessionRef = useRef(false);

  useEffect(() => {
    void refreshAll();
  }, [profile.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([
        hydrateMobileOptimisticTranscripts(),
        hydrateMobileOptimisticPendingQueue(),
      ]);
      if (cancelled || restoredSessionRef.current) return;
      restoredSessionRef.current = true;
      const lastSessionId = await readLastOpenedSessionId();
      if (cancelled || !lastSessionId) return;
      setActiveTab("sessions");
      setDetailRoute((route) => route ?? { kind: "session", id: lastSessionId });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      appStateRef.current = state;
      if (state === "active") void refreshAllRef.current(false);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (detailRoute?.kind === "session") return;
    const interval = setInterval(() => {
      if (appStateRef.current === "active") void refresh(false);
    }, 12000);
    return () => clearInterval(interval);
  }, [detailRoute?.kind, profile.id]);

  useEffect(() => {
    if (
      MOBILE_METRICS_CHROME.lazyLoadUntilOpened &&
      (activeTab !== "metrics" || Boolean(detailRoute))
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      void refreshMetrics();
    });
    const interval = setInterval(() => {
      if (appStateRef.current === "active") void refreshMetrics();
    }, MOBILE_METRICS_CHROME.detailRefreshMs);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, [profile.id, activeTab, detailRoute]);

  useEffect(() => {
    if (activeTab !== "metrics" || detailRoute) return;
    void refreshMetricsOverview();
    const interval = setInterval(() => {
      if (appStateRef.current === "active") void refreshMetricsOverview();
    }, MOBILE_METRICS_CHROME.liveRefreshMs);
    return () => clearInterval(interval);
  }, [profile.id, activeTab, detailRoute]);

  const sessions = summary?.sessions ?? [];
  const orderedSessions = useMemo(() => sortSessionSummaries(sessions), [sessions]);
  const counts = summarizeFeatureCounts(summary);
  const gatewayAccentKey = resolveAccentKey(summary);
  const accentKey = accentOverride ?? gatewayAccentKey;
  const accentColor = accentPalette[accentKey] || accentPalette.cyan;
  const detailSummary = useMemo(() => {
    if (!summary) return null;
    if (detailRoute?.kind !== "surface" || detailRoute.surface !== "logs") return summary;
    return {
      ...summary,
      logs: pagedLogs,
      logsTotal: logPageMeta.total,
      logsLimit: logPageMeta.limit,
      logsHasMore: logPageMeta.hasMore,
    };
  }, [detailRoute, logPageMeta.hasMore, logPageMeta.limit, logPageMeta.total, pagedLogs, summary]);
  const headerCopy = routeHeader(
    detailRoute,
    buildMobileHeaderCopy(activeTab, counts, profile),
    summary
  );

  useEffect(() => {
    if (accentOverride && gatewayAccentKey === accentOverride) {
      setAccentOverride(null);
    }
  }, [accentOverride, gatewayAccentKey]);

  const selectTab = (tab: MobileTabKey) => {
    if (tab !== activeTab) haptics.select();
    setChatHeaderAction(null);
    setDetailRoute(null);
    setActiveTab(tab);
    if (tab === "metrics") {
      void refreshMetricsOverview({ force: metrics?.overview === null });
    }
  };

  const openSurface = (surface: MobileSurfaceKey) => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "surface", surface });
  };

  const openSystemPrompt = () => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "systemPrompt" });
  };

  const openSpeech = () => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "speech" });
  };
  const openMemory = () => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "memory" });
  };
  const openMigration = () => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "migration" });
  };
  const openJourney = () => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "journey" });
  };
  const openModelRouter = () => {
    setChatHeaderAction(null);
    setActiveTab("settings");
    setDetailRoute({ kind: "modelRouter" });
  };

  const openItem = (surface: MobileSurfaceKey, item: RemoteItemSummary | ActivitySummary) => {
    setDetailRoute({ kind: "item", surface, item });
  };

  const handleMainScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (detailRoute?.kind !== "surface" || detailRoute.surface !== "logs") return;
    if (!logPageMeta.hasMore || loadingMoreLogs) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromBottom < 480) {
      void loadMoreLogs();
    }
  };

  // Chats and Tasks are omitted here — both are primary bottom-tab
  // destinations, so the Home grid stays focused on management surfaces.
  const modules: ModuleCard[] = [
    {
      key: "agents",
      label: "Agents",
      detail: surfaceCount(summary, "agents", counts.agents, "configured", "None configured"),
      value: String(counts.agents),
      Icon: Bot,
      tab: "settings",
      surface: "agents",
    },
    {
      key: "wallet",
      label: "Wallet Policy",
      detail: summary?.walletPolicy ? "Limits & rules" : "Unavailable",
      value: summary?.walletPolicy ? "On" : "-",
      Icon: ShieldCheck,
      tab: "settings",
      surface: "wallet",
    },
    {
      key: "providers",
      label: "Providers",
      detail: surfaceCount(summary, "providers", counts.providers, "enabled", "None enabled"),
      value: String(counts.providers),
      Icon: Box,
      tab: "settings",
      surface: "providers",
    },
    {
      key: "tools",
      label: "Tools & Approvals",
      detail: summary?.availability.approvals.ok
        ? counts.approvals > 0
          ? `${counts.approvals} pending`
          : surfaceCount(summary, "tools", counts.tools, "tools", "No tools")
        : "Approvals unavailable",
      value: String(counts.tools),
      Icon: Wrench,
      tab: "settings",
      surface: "tools",
    },
    {
      key: "channels",
      label: "Channels",
      detail: surfaceCount(summary, "channels", counts.channels, "configured", "None configured"),
      value: String(counts.channels),
      Icon: Link2,
      tab: "settings",
      surface: "channels",
    },
    {
      key: "memory",
      label: "Memory",
      detail: surfaceCount(summary, "memory", counts.memory, "files", "No memory files"),
      value: String(counts.memory),
      Icon: Brain,
      tab: "settings",
      surface: "memory",
    },
    {
      key: "logs",
      label: "Logs",
      detail: surfaceCount(summary, "logs", counts.logs, "events", "No recent events"),
      value: String(counts.logs),
      Icon: ListTodo,
      tab: "settings",
      surface: "logs",
    },
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.brandWrap}>
          {detailRoute ? (
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              style={styles.backButton}
              onPress={closeDetailRoute}
            >
              <ArrowLeft color={colors.text} size={22} strokeWidth={2.2} />
            </Pressable>
          ) : (
            <View style={styles.logoMark}>
              <Image
                accessibilityIgnoresInvertColors
                source={cybaraLogo}
                style={styles.logoImage}
              />
            </View>
          )}
          <View style={styles.headerText}>
            <Text
              ellipsizeMode="tail"
              maxFontSizeMultiplier={1.05}
              numberOfLines={1}
              style={[styles.title, detailRoute && styles.detailTitle]}
            >
              {headerCopy.title}
            </Text>
            <Text numberOfLines={1} style={styles.headerDetail}>
              {headerCopy.detail}
            </Text>
          </View>
        </View>
        {detailRoute?.kind === "session" && MOBILE_CHAT_DETAIL_CHROME.settingsInHeader ? (
          <Pressable
            accessibilityLabel="Chat settings"
            accessibilityRole="button"
            disabled={!chatHeaderAction}
            onPress={() => chatHeaderAction?.onPress()}
            style={[styles.iconButton, !chatHeaderAction && styles.iconButtonDisabled]}
          >
            {chatHeaderAction?.busy ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Settings color={colors.text} size={22} strokeWidth={2.1} />
            )}
          </Pressable>
        ) : null}
      </View>

      {detailRoute?.kind === "session" ? (
        <SessionDetailPanel
          accentColor={accentColor}
          api={api}
          agents={summary?.agents ?? []}
          closeDetail={closeDetailRoute}
          openSession={openSessionRoute}
          providerPlanStatus={providerPlanStatus}
          onSessionUpdated={syncSessionSummary}
          refreshSummary={() => refresh(false)}
          sessionSummary={
            summary?.sessions.find((session) => session.id === detailRoute.id) ?? null
          }
          sessionId={detailRoute.id}
          setHeaderAction={setChatHeaderAction}
        />
      ) : (
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                MOBILE_NAV_CHROME.height +
                MOBILE_NAV_CHROME.floatingMargin +
                spacing.lg +
                insets.bottom,
            },
          ]}
          showsVerticalScrollIndicator={false}
          onScroll={handleMainScroll}
          scrollEventThrottle={250}
          refreshControl={
            <RefreshControl
              tintColor={accentColor}
              refreshing={refreshing}
              onRefresh={() => refreshAll(true)}
            />
          }
        >
          {detailRoute ? (
            <DetailContent
              api={api}
              profile={profile}
              providerPlanStatus={providerPlanStatus}
              route={detailRoute}
              summary={detailSummary}
              openItem={openItem}
              accentColor={accentColor}
              closeDetail={closeDetailRoute}
              refreshSummary={() => refresh(false)}
              openSession={openSessionRoute}
              loadMoreLogs={loadMoreLogs}
              loadingMoreLogs={loadingMoreLogs}
              logPageError={logPageError}
            />
          ) : activeTab === "overview" ? (
            <OverviewPanel
              accentColor={accentColor}
              modules={modules}
              sessions={orderedSessions}
              logs={summary?.logs ?? []}
              systemMonitor={summary?.systemMonitor ?? null}
              selectTab={selectTab}
              openSurface={openSurface}
              openSession={openSessionRoute}
            />
          ) : null}
          {!detailRoute && activeTab === "sessions" ? (
            <SessionsPanel
              sessions={orderedSessions}
              summary={summary}
              openSession={openSessionRoute}
              createChat={() => setDetailRoute({ kind: "newChat" })}
              deleteSession={async (id) => {
                await api.deleteSession(id);
                await refresh(false);
              }}
              accentColor={accentColor}
            />
          ) : null}
          {!detailRoute && activeTab === "metrics" ? (
            <MetricsPanel
              accentColor={accentColor}
              api={api}
              counts={counts}
              metrics={metrics}
              metricsError={metricsError}
              metricsRefreshing={metricsRefreshing}
              metricsUpdatedAt={metricsUpdatedAt}
              providerPlanStatus={providerPlanStatus}
              summary={summary}
              openSurface={openSurface}
            />
          ) : null}
          {!detailRoute && activeTab === "usage" ? (
            <UsagePanel
              accentColor={accentColor}
              providerPlanStatus={providerPlanStatus}
              providerPlanError={providerPlanError}
            />
          ) : null}
          {!detailRoute && activeTab === "tasks" ? (
            <TasksPanel
              summary={summary}
              accentColor={accentColor}
              openTask={(item) => openItem("tasks", item)}
              createTask={() => setDetailRoute({ kind: "newTask" })}
            />
          ) : null}
          {!detailRoute && activeTab === "settings" ? (
            <SettingsPanel
              accentColor={accentColor}
              accentKey={accentKey}
              api={api}
              connectionError={error}
              profile={profile}
              refreshSummary={() => refresh(false)}
              summary={summary}
              onThemeAccentChange={setAccentOverride}
              onDisconnect={onDisconnect}
              openSurface={openSurface}
              onProfileUpdated={onProfileUpdated}
              openSystemPrompt={openSystemPrompt}
              openModelRouter={openModelRouter}
              openSpeech={openSpeech}
              openMemory={openMemory}
              openMigration={openMigration}
              openJourney={openJourney}
            />
          ) : null}
        </ScrollView>
      )}

      <LiquidGlass
        intensity={64}
        contentStyle={styles.tabBarPanel}
        style={[styles.tabBar, { bottom: insets.bottom + MOBILE_NAV_CHROME.floatingMargin }]}
      >
        <View style={styles.tabBarFill}>
          {MOBILE_TABS.map(({ key, label }) => {
            const Icon = tabIcons[key];
            const selected = activeTab === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => selectTab(key)}
                style={[
                  styles.tabItem,
                  selected && [
                    styles.tabItemActive,
                    {
                      backgroundColor: `${accentColor}20`,
                      borderColor: `${accentColor}55`,
                    },
                  ],
                ]}
              >
                <Icon
                  color={selected ? accentColor : colors.textMuted}
                  size={21}
                  strokeWidth={2.2}
                />
                <Text
                  maxFontSizeMultiplier={1.05}
                  numberOfLines={1}
                  style={[styles.tabLabel, selected && { color: accentColor }]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </LiquidGlass>
    </View>
  );
}

function OverviewPanel({
  accentColor,
  modules,
  sessions,
  logs,
  systemMonitor,
  selectTab,
  openSurface,
  openSession,
}: {
  accentColor: string;
  modules: ModuleCard[];
  sessions: SessionSummary[];
  logs: ActivitySummary[];
  systemMonitor: SystemMonitorSnapshot | null;
  selectTab: (tab: MobileTabKey) => void;
  openSurface: (surface: MobileSurfaceKey) => void;
  openSession: (id: string) => void;
}) {
  const activityRows =
    sessions.length > 0
      ? sessions.slice(0, 3).map((session) => {
          const state = recentSessionStateLabel(session);
          return {
            id: session.id,
            Icon: MessageCircle,
            title: mobileSessionTitle(session),
            detail: `${sessionProviderModelLabel(session)} - ${lastUpdatedLabel(session)}`,
            state,
            tone: state === "Working" ? colors.amber : accentColor,
            onPress: () => openSession(session.id),
          };
        })
      : logs.slice(0, 3).map((log) => ({
          id: log.id,
          Icon: ListTodo,
          title: log.title,
          detail: `${log.source} - ${log.createdAt ? relativeTimestamp(log.createdAt) : "recent"}`,
          state: "Recent",
          tone: accentColor,
          onPress: undefined,
        }));

  return (
    <>
      <GlassPanel elevated style={styles.activityPanel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelHeaderTitle}>
            <Clock color={colors.textMuted} size={21} strokeWidth={2} />
            <Text style={styles.panelTitle}>Recent activity</Text>
          </View>
          <Pressable style={styles.smallButton} onPress={() => selectTab("sessions")}>
            <Text style={[styles.smallButtonText, { color: accentColor }]}>View all</Text>
          </Pressable>
        </View>
        {activityRows.map((row) => (
          <ActivityRow
            key={row.id}
            Icon={row.Icon}
            title={row.title}
            detail={row.detail}
            state={row.state}
            tone={row.tone}
            onPress={row.onPress}
          />
        ))}
        {activityRows.length === 0 ? (
          <>
            <ActivityRow
              Icon={MessageCircle}
              title="No chats"
              detail="Start a chat from the gateway"
              state="Idle"
              tone={accentColor}
            />
            <ActivityRow
              Icon={Bot}
              title="Agents ready"
              detail="Remote orchestration available"
              state="Ready"
              tone={colors.green}
            />
          </>
        ) : null}
      </GlassPanel>

      <View style={styles.overviewInset}>
        <View style={styles.moduleGrid}>
          {MOBILE_HOME_CHROME.firstManagementSurface === "monitor" ? (
            <Pressable
              style={[styles.moduleTile, styles.monitorTile, styles.monitorTilePrimary]}
              onPress={() => openSurface("monitor")}
            >
              <View style={styles.moduleIcon}>
                <Cpu color={colors.text} size={23} strokeWidth={2.1} />
              </View>
              <View style={styles.monitorText}>
                <Text style={styles.moduleTitle}>System Monitor</Text>
                <Text style={styles.moduleDetail}>{monitorOverviewLabel(systemMonitor)}</Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          ) : null}
          {modules.slice(0, 9).map((module) => (
            <ModuleTile
              key={module.key}
              module={module}
              onPress={() => (module.surface ? openSurface(module.surface) : selectTab(module.tab))}
            />
          ))}
        </View>
      </View>
    </>
  );
}

function ModuleTile({ module, onPress }: { module: ModuleCard; onPress: () => void }) {
  const { Icon } = module;
  return (
    <Pressable style={styles.moduleTile} onPress={onPress}>
      <View style={styles.moduleIcon}>
        <Icon color={colors.text} size={23} strokeWidth={2.1} />
      </View>
      <View style={styles.moduleText}>
        <Text style={styles.moduleTitle}>{module.label}</Text>
        <Text style={styles.moduleDetail}>{module.detail}</Text>
      </View>
      <ChevronRight color={colors.text} size={21} strokeWidth={2.1} />
    </Pressable>
  );
}

function ActivityRow({
  Icon,
  title,
  detail,
  state,
  tone,
  onPress,
}: {
  Icon: IconGlyph;
  title: string;
  detail: string;
  state: string;
  tone: string;
  onPress?: () => void;
}) {
  const Container = onPress ? Pressable : View;
  return (
    <Container style={styles.activityRow} onPress={onPress}>
      <View style={[styles.activityDot, { backgroundColor: tone }]} />
      <View style={styles.activityIcon}>
        <Icon color={colors.text} size={21} strokeWidth={2.1} />
      </View>
      <View style={styles.activityText}>
        <Text
          ellipsizeMode="tail"
          numberOfLines={MOBILE_RECENT_ACTIVITY_CHROME.truncateTitles ? 1 : undefined}
          style={styles.activityTitle}
        >
          {title}
        </Text>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.activityDetail}>
          {detail}
        </Text>
      </View>
      <View style={[styles.statePill, { borderColor: `${tone}55`, backgroundColor: `${tone}17` }]}>
        <Text style={[styles.stateText, { color: tone }]}>{state}</Text>
      </View>
      {onPress ? <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} /> : null}
    </Container>
  );
}

function SessionsPanel({
  accentColor,
  createChat,
  sessions,
  summary,
  openSession,
  deleteSession,
}: {
  accentColor: string;
  createChat: () => void;
  sessions: SessionSummary[];
  summary: FeatureSummary | null;
  openSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
}) {
  const runDelete = async (session: SessionSummary) => {
    try {
      haptics.warning();
      await deleteSession(session.id);
      haptics.success();
    } catch (error) {
      Alert.alert("Could not delete chat", error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDeleteSession = (session: SessionSummary) => {
    const title = mobileSessionTitle(session);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: ["Delete Chat", "Cancel"],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 1,
        },
        (index) => {
          if (index === 0) void runDelete(session);
        }
      );
    } else {
      Alert.alert(`Delete “${title}”?`, "This removes the chat from the gateway.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void runDelete(session),
        },
      ]);
    }
  };

  const latest = sessions[0];
  const endpoint = summary?.availability.sessions;
  const totalChats = summary?.sessionTotal ?? sessions.length;
  const visibleSessionCount = Math.min(sessions.length, 20);
  const pageDetail =
    totalChats > visibleSessionCount ? `showing ${visibleSessionCount} recent` : "total";

  return (
    <StableDetailPanel>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={MessageCircle}
          label="Chats"
          value={String(totalChats)}
          detail={pageDetail}
          tone={accentColor}
        />
        <SummaryTile
          Icon={Clock}
          label="Latest"
          value={latest ? lastUpdatedLabel(latest) : "None"}
          detail={latest ? mobileSessionTitle(latest) : "No recent chat"}
          tone={colors.blueText}
        />
      </View>
      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recent chats</Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.newChatButton,
            {
              borderColor: `${accentColor}70`,
              backgroundColor: `${accentColor}18`,
            },
            pressed && styles.newChatButtonPressed,
          ]}
          onPress={createChat}
        >
          <View style={[styles.newChatIcon, { backgroundColor: accentColor }]}>
            <Plus color={colors.background} size={15} strokeWidth={3} />
          </View>
          <Text style={[styles.newChatButtonText, { color: accentColor }]}>New Chat</Text>
        </Pressable>
      </View>
      {sessions.slice(0, visibleSessionCount).map((session) => (
        <Pressable
          key={session.id}
          style={styles.listRow}
          onPress={() => openSession(session.id)}
          onLongPress={() => confirmDeleteSession(session)}
          accessibilityHint="Long press to delete"
        >
          <View style={styles.listIcon}>
            {sessionMayBeInProgress(session) ? (
              <ActivityIndicator color={accentColor} size="small" />
            ) : (
              <MessageCircle color={accentColor} size={20} strokeWidth={2.1} />
            )}
          </View>
          <View style={styles.listText}>
            <View style={styles.sessionTitleRow}>
              {session.pinned ? (
                <View style={styles.sessionPinnedDot}>
                  <ShieldCheck color={colors.amber} size={12} strokeWidth={2.4} />
                </View>
              ) : null}
              <Text numberOfLines={2} style={[styles.listTitle, styles.sessionListTitle]}>
                {mobileSessionTitle(session)}
              </Text>
              <Text style={styles.sessionListTime}>{compactLastUpdatedLabel(session)}</Text>
            </View>
            <Text numberOfLines={1} style={styles.listDetail}>
              {sessionProviderModelLabel(session)} - {session.message_count} messages -{" "}
              {lastUpdatedLabel(session)}
            </Text>
            {session.last_message?.content ? (
              <Text numberOfLines={1} style={styles.sessionPreview}>
                {session.last_message.content}
              </Text>
            ) : null}
          </View>
          <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
        </Pressable>
      ))}
      {sessions.length === 0 ? (
        !summary ? (
          <LoadingState label="Loading chats" detail="Fetching sessions from the gateway." />
        ) : endpoint?.ok === false ? (
          <EmptyState
            label="Chats unavailable"
            detail={endpointErrorDetail(endpoint, "The gateway did not return chats.")}
          />
        ) : (
          <EmptyState label="No chats yet" detail="Create a Cybara chat from the gateway." />
        )
      ) : null}
    </StableDetailPanel>
  );
}

function DetailContent({
  api,
  accentColor,
  profile,
  route,
  summary,
  openItem,
  openSession,
  closeDetail,
  refreshSummary,
  loadMoreLogs,
  loadingMoreLogs,
  logPageError,
  providerPlanStatus,
}: {
  api: CybaraMobileApi;
  accentColor: string;
  profile: GatewayProfile;
  route: DetailRoute;
  summary: FeatureSummary | null;
  openItem: (surface: MobileSurfaceKey, item: RemoteItemSummary | ActivitySummary) => void;
  openSession: (sessionId: string) => void;
  closeDetail: () => void;
  refreshSummary: () => void;
  loadMoreLogs: () => void;
  loadingMoreLogs: boolean;
  logPageError: string | null;
  providerPlanStatus?: ProviderPlanStatusResponse | null;
}) {
  if (route.kind === "session") {
    return (
      <SessionDetailPanel
        accentColor={accentColor}
        api={api}
        agents={summary?.agents ?? []}
        closeDetail={closeDetail}
        openSession={openSession}
        config={summary?.config}
        providerPlanStatus={providerPlanStatus}
        refreshSummary={refreshSummary}
        sessionSummary={summary?.sessions.find((session) => session.id === route.id) ?? null}
        sessionId={route.id}
      />
    );
  }
  if (route.kind === "newChat") {
    return (
      <NewChatPanel
        accentColor={accentColor}
        api={api}
        agents={summary?.agents ?? []}
        onConfigChanged={refreshSummary}
        onCreated={(sessionId) => {
          openSession(sessionId);
        }}
        onSettled={refreshSummary}
        toolApprovalMode={readMobileToolApprovalMode(summary?.config)}
      />
    );
  }
  if (route.kind === "newTask") {
    return (
      <NewTaskPanel
        accentColor={accentColor}
        api={api}
        agents={summary?.agents ?? []}
        onCreated={() => {
          refreshSummary();
          closeDetail();
        }}
      />
    );
  }
  if (route.kind === "systemPrompt") {
    return (
      <SystemPromptPanel
        accentColor={accentColor}
        api={api}
        summary={summary}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.kind === "modelRouter") {
    return <ModelRouterPanel accentColor={accentColor} api={api} summary={summary} />;
  }
  if (route.kind === "speech") {
    return (
      <SpeechSettingsPanel
        accentColor={accentColor}
        api={api}
        summary={summary}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.kind === "memory") {
    return (
      <MemorySettingsPanel
        accentColor={accentColor}
        api={api}
        summary={summary}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.kind === "migration") {
    return <MigrationSettingsPanel accentColor={accentColor} api={api} />;
  }
  if (route.kind === "journey") {
    return <JourneyPanel accentColor={accentColor} api={api} />;
  }
  if (route.kind === "item") {
    return (
      <ItemDetailPanel
        api={api}
        closeDetail={closeDetail}
        refreshSummary={refreshSummary}
        route={route}
        summary={summary}
      />
    );
  }
  return (
    <SurfaceDetailPanel
      api={api}
      accentColor={accentColor}
      profile={profile}
      summary={summary}
      surface={route.surface}
      openItem={(item) => openItem(route.surface, item)}
      loadMoreLogs={loadMoreLogs}
      loadingMoreLogs={loadingMoreLogs}
      logPageError={logPageError}
      refreshSummary={refreshSummary}
    />
  );
}
