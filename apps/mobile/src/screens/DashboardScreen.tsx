import {
  DetailActionButton,
  DetailInfoSection,
  SettingSelector,
  SettingToggle,
  SettingsSection,
  SettingsTextField,
} from "./dashboardControls";
import {
  AgentSettingsPanel,
  ApprovalSettingsPanel,
  ChannelSettingsPanel,
  ModelRouterPanel,
  ProviderSettingsPanel,
  SpeechSettingsPanel,
  SystemMonitorDetailPanel,
  SystemPromptPanel,
  TaskSettingsPanel,
  WalletPolicyPanel,
} from "./dashboardSettingsPanels";
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
  Image,
  KeyboardAvoidingView,
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
  ArrowLeft,
  Bot,
  Box,
  Brain,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  HeartPulse,
  House,
  Link2,
  ListTodo,
  Loader2,
  MessageCircle,
  Mic,
  Network,
  Plus,
  Play,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  User,
  UsersRound,
  Volume2,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react-native";
import { GlassPanel } from "../components/Glass";
import { LiquidGlass } from "../components/LiquidGlass";
import {
  MetricBarChart,
  MetricAreaChart,
  MetricBreakdown,
  MetricEndpointGrid,
  MetricMicro,
  MetricSection,
  MetricShareRows,
  MetricTokenCloud,
  TokenHeatmap,
} from "../components/MetricVisuals";
import { NewChatPanel } from "../components/NewChatPanel";
import { NewTaskPanel } from "../components/NewTaskPanel";
import {
  CybaraMobileApi,
  sortSessionSummaries,
  type ActivitySummary,
  type AgentSummary,
  type FeatureEndpointKey,
  type FeatureSummary,
  type MobilePendingChatMessage,
  type ProviderSummary,
  type RemoteItemSummary,
  type RouterConfig,
  type RouterStatus,
  type SessionDetailSummary,
  type SessionSummary,
  type SystemPromptFeatureKey,
  type SystemMonitorSnapshot,
  type ToolApprovalDecision,
  type WalletAgentPolicyUpdate,
  type WalletChain,
  type WalletTokenChain,
} from "../lib/api";
import { chatIsWaitingForAssistant, latestVisibleChatMessages } from "../lib/chat-format";
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
  MOBILE_SYSTEM_PROMPT_FEATURE_KEYS,
  MOBILE_TABS,
  boundedMobileComposerHeight,
  buildMobileChatSettingsLines,
  buildMobileHeaderCopy,
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
  type MobileSurfaceKey,
  type MobileTabKey,
} from "../lib/dashboard";
import {
  formatMetricBytes,
  formatMetricNumber,
  formatStorageBytes,
  metricSuccessRate,
  modelTokenShareRows,
  providerTokenShareRows,
  storageCategoryEntries,
  timeSeriesTotals,
  tokenFlowBars,
  tokenVelocityAreaRows,
  totalFileOperations,
  type MetricsSnapshot,
} from "../lib/metrics";
import { accentPalette, colors, spacing, type AccentKey } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
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
import { ChatMessageRow } from "./dashboardChat";
import {
  clearCachedMobileLiveAssistant,
  liveActivityFromStatusEvent,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  mergeLiveActivity,
  readCachedMobileLiveAssistant,
  writeCachedMobileLiveAssistant,
} from "./dashboardLiveChat";
import {
  EmptyState,
  GatewayDetailPill,
  SettingsRow,
  SummaryTile,
  type IconGlyph,
} from "./dashboardPrimitives";
import cybaraLogo from "../../assets/cybara.png";

interface ModuleCard {
  key: string;
  label: string;
  detail: string;
  value: string;
  Icon: IconGlyph;
  tab: MobileTabKey;
  surface?: MobileSurfaceKey;
}

type DetailRoute =
  | { kind: "session"; id: string }
  | { kind: "newChat" }
  | { kind: "newTask" }
  | { kind: "systemPrompt" }
  | { kind: "modelRouter" }
  | { kind: "speech" }
  | { kind: "surface"; surface: MobileSurfaceKey }
  | { kind: "item"; surface: MobileSurfaceKey; item: RemoteItemSummary | ActivitySummary };

interface ChatHeaderAction {
  busy: boolean;
  onPress: () => void;
}

const tabIcons: Record<MobileTabKey, IconGlyph> = {
  overview: House,
  sessions: UsersRound,
  metrics: Cpu,
  tasks: CalendarCheck,
  settings: Settings,
};

const surfaceMeta: Record<
  MobileSurfaceKey,
  { title: string; Icon: IconGlyph; tone: string; endpoint?: FeatureEndpointKey }
> = {
  agents: {
    title: "Agents",
    Icon: Bot,
    get tone() {
      return colors.cyan;
    },
    endpoint: "agents",
  },
  providers: {
    title: "Providers",
    Icon: Database,
    get tone() {
      return colors.blueText;
    },
    endpoint: "providers",
  },
  tools: {
    title: "Tools",
    Icon: Wrench,
    get tone() {
      return colors.green;
    },
    endpoint: "tools",
  },
  approvals: {
    title: "Approvals",
    Icon: ShieldCheck,
    get tone() {
      return colors.amber;
    },
    endpoint: "approvals",
  },
  wallet: {
    title: "Wallet Policy",
    Icon: ShieldCheck,
    get tone() {
      return colors.green;
    },
    endpoint: "walletPolicy",
  },
  channels: {
    title: "Channels",
    Icon: Link2,
    get tone() {
      return colors.cyan;
    },
    endpoint: "channels",
  },
  tasks: {
    title: "Tasks",
    Icon: CalendarCheck,
    get tone() {
      return colors.blueText;
    },
    endpoint: "tasks",
  },
  memory: {
    title: "Memory",
    Icon: Brain,
    get tone() {
      return colors.green;
    },
    endpoint: "memory",
  },
  logs: {
    title: "Logs",
    Icon: ListTodo,
    get tone() {
      return colors.textMuted;
    },
    endpoint: "logs",
  },
  monitor: {
    title: "System Monitor",
    Icon: Cpu,
    get tone() {
      return colors.blueText;
    },
    endpoint: "systemMonitor",
  },
};

function mergeActivityLogs(
  existing: ActivitySummary[],
  incoming: ActivitySummary[]
): ActivitySummary[] {
  const seen = new Set<string>();
  return [...existing, ...incoming].filter((log) => {
    if (seen.has(log.id)) return false;
    seen.add(log.id);
    return true;
  });
}

function itemFromRecord(
  id: string,
  title: string,
  detail: string,
  fields: Record<string, unknown>
): RemoteItemSummary {
  return {
    id,
    title,
    detail,
    fields: displayFields(fields),
  };
}

function surfaceRows(
  surface: MobileSurfaceKey,
  summary: FeatureSummary | null
): Array<RemoteItemSummary | ActivitySummary> {
  if (!summary) return [];
  switch (surface) {
    case "agents":
      return summary.agents.map((agent) =>
        itemFromRecord(
          agent.id,
          agent.name,
          [agent.status, agent.model, agent.type].filter(Boolean).join(" - ") || "Configured",
          agent as unknown as Record<string, unknown>
        )
      );
    case "providers":
      return summary.providers.map((provider) =>
        itemFromRecord(
          provider.id,
          provider.name,
          `${provider.provider}${provider.is_default ? " - default" : ""}`,
          provider as unknown as Record<string, unknown>
        )
      );
    case "tools":
      return summary.tools;
    case "approvals":
      return summary.approvals;
    case "channels":
      return summary.channels;
    case "tasks":
      return summary.tasks;
    case "memory":
      return summary.memory;
    case "logs":
      return summary.logs;
    case "wallet":
      return [
        itemFromRecord("wallet-policy", "Agent policy", formatMobileValue(summary.walletPolicy), {
          policy: summary.walletPolicy,
        }),
        itemFromRecord("wallet-status", "Wallet status", formatMobileValue(summary.walletStatus), {
          status: summary.walletStatus,
        }),
      ];
    case "monitor": {
      const monitor = summary.systemMonitor;
      if (!monitor) return [];
      return [
        itemFromRecord(
          "cpu",
          "CPU",
          `${monitorPercentLabel(monitor.cpu.usagePct)} - ${monitor.cpu.cores} cores`,
          {
            usagePct: monitor.cpu.usagePct,
            loadPct: monitor.cpu.loadPct,
            cores: monitor.cpu.cores,
            model: monitor.cpu.model,
            loadAverage: monitor.cpu.loadAverage.join(", "),
          }
        ),
        itemFromRecord(
          "memory",
          "Memory",
          `${monitorPercentLabel(monitor.memory.usedPct)} - ${formatMetricBytes(monitor.memory.usedBytes)} used`,
          monitor.memory
        ),
        ...(monitor.memory.swap
          ? [
              itemFromRecord(
                "swap",
                "Swap",
                `${monitorPercentLabel(monitor.memory.swap.usedPct)} - ${formatMetricBytes(monitor.memory.swap.usedBytes)} used`,
                monitor.memory.swap
              ),
            ]
          : []),
        itemFromRecord(
          "process",
          "Cybara process",
          `${formatMetricBytes(monitor.process.memory.rssBytes)} RSS - ${monitorPercentLabel(monitor.process.cpuUsagePct)} CPU`,
          {
            pid: monitor.process.pid,
            uptime: formatUptime(monitor.process.uptimeSeconds),
            cpuUsagePct: monitor.process.cpuUsagePct,
            ...monitor.process.memory,
          }
        ),
        ...(monitor.disk
          ? [
              itemFromRecord(
                "disk",
                "Disk",
                `${monitorPercentLabel(monitor.disk.usedPct)} - ${formatStorageBytes(monitor.disk.freeBytes)} free`,
                monitor.disk
              ),
            ]
          : []),
        itemFromRecord("runtime", "Runtime", monitorPlatformLabel(monitor), {
          platform: monitor.platform.type,
          architecture: monitor.platform.arch,
          release: monitor.platform.release,
          timestamp: monitor.timestamp,
          sampleIntervalMs: monitor.sampleIntervalMs,
        }),
      ];
    }
  }
}

function surfaceMenuDetail(
  surface: MobileSurfaceKey,
  summary: FeatureSummary | null,
  counts: FeatureCounts,
  rowCount: number
): string {
  if (!summary) return "Loading";
  const endpoint = surfaceMeta[surface].endpoint;
  if (endpoint) {
    const state = summary.availability[endpoint];
    if (!state.ok) return endpointStatusLabel(state);
  }
  switch (surface) {
    case "agents":
      return surfaceCount(summary, "agents", counts.agents, "configured", "None configured");
    case "providers":
      return surfaceCount(summary, "providers", counts.providers, "enabled", "None enabled");
    case "tools":
      return surfaceCount(summary, "tools", counts.tools, "registered", "No tools");
    case "approvals":
      return counts.approvals > 0 ? `${counts.approvals} pending` : "No pending approvals";
    case "channels":
      return surfaceCount(summary, "channels", counts.channels, "configured", "None configured");
    case "tasks":
      return surfaceCount(summary, "tasks", counts.tasks, "scheduled", "No tasks");
    case "memory":
      return surfaceCount(summary, "memory", counts.memory, "files", "No memory files");
    case "logs":
      return surfaceCount(summary, "logs", counts.logs, "events", "No recent events");
    case "wallet":
      return summary.walletPolicy || summary.walletStatus ? "Policy and status" : "Unavailable";
    case "monitor":
      return summary.systemMonitor
        ? `CPU ${monitorPercentLabel(summary.systemMonitor.cpu.usagePct)} - RAM ${monitorPercentLabel(summary.systemMonitor.memory.usedPct)}`
        : rowCount > 0
          ? `${rowCount} readings`
          : "Telemetry";
  }
}

function routeHeader(
  route: DetailRoute | null,
  fallback: { title: string; detail: string },
  summary: FeatureSummary | null
): { title: string; detail: string } {
  if (!route) return fallback;
  if (route.kind === "session") {
    const session = summary?.sessions.find((candidate) => candidate.id === route.id);
    return {
      title: session?.title || "Chat",
      detail: session
        ? `${session.message_count ?? 0} messages - ${lastUpdatedLabel(session)}`
        : "Chat details",
    };
  }
  if (route.kind === "newChat") {
    return { title: "New chat", detail: "Start a gateway-backed session" };
  }
  if (route.kind === "newTask") {
    return { title: "New task", detail: "Schedule an agent to run automatically" };
  }
  if (route.kind === "systemPrompt") {
    return { title: "System Prompt", detail: "Assistant identity and behavior" };
  }
  if (route.kind === "modelRouter") {
    return { title: "Model Router", detail: "Provider routing and fallback" };
  }
  if (route.kind === "speech") {
    return { title: "Voice & Speech", detail: "Text-to-speech and dictation" };
  }
  if (route.kind === "surface") {
    const meta = surfaceMeta[route.surface];
    return { title: meta.title, detail: "Live gateway data" };
  }
  const meta = surfaceMeta[route.surface];
  return { title: meta.title, detail: route.item.title };
}

export function DashboardScreen({
  profile,
  onDisconnect,
}: {
  profile: GatewayProfile;
  onDisconnect: () => void;
}) {
  const api = useMemo(() => new CybaraMobileApi(profile), [profile]);
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<FeatureSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
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
  const metricsLastLoadedAtRef = useRef(0);
  const logPageInFlight = useRef(false);
  const activeSurface =
    detailRoute?.kind === "surface" || detailRoute?.kind === "item" ? detailRoute.surface : null;
  const hasLoadedMetrics = metrics !== null;

  const closeDetailRoute = () => {
    setChatHeaderAction(null);
    setDetailRoute((route) => mobileBackRouteForDetail(route));
  };

  const refresh = async (showRefreshing = true) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (showRefreshing) setRefreshing(true);
    setError(null);
    try {
      setSummary(await api.featureSummary());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      refreshInFlight.current = false;
      if (showRefreshing) setRefreshing(false);
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
    setMetricsError(null);
    try {
      setMetrics(await api.metricsSnapshot());
      metricsLastLoadedAtRef.current = Date.now();
    } catch (refreshError) {
      setMetricsError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      metricsLastLoadedAtRef.current = Date.now();
    } finally {
      metricsRefreshInFlight.current = false;
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
      !MOBILE_METRICS_CHROME.lazyLoadUntilOpened || activeTab === "metrics" || hasLoadedMetrics;
    await Promise.all([
      refresh(false),
      shouldRefreshMetrics ? refreshMetrics({ force: true }) : Promise.resolve(),
    ]);
    if (showRefreshing) setRefreshing(false);
  };

  useEffect(() => {
    void refreshAll();
  }, [profile.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh(false);
    }, 12000);
    return () => clearInterval(interval);
  }, [profile.id]);

  useEffect(() => {
    if (MOBILE_METRICS_CHROME.lazyLoadUntilOpened && activeTab !== "metrics" && !hasLoadedMetrics) {
      return;
    }
    const refreshMs =
      activeTab === "metrics" && !detailRoute
        ? MOBILE_METRICS_CHROME.liveRefreshMs
        : MOBILE_METRICS_CHROME.backgroundRefreshMs;
    const interval = setInterval(() => {
      void refreshMetrics();
    }, refreshMs);
    return () => clearInterval(interval);
  }, [profile.id, activeTab, detailRoute, hasLoadedMetrics]);

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
      void refreshMetrics({ force: metrics === null });
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
          closeDetail={closeDetailRoute}
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
              route={detailRoute}
              summary={detailSummary}
              openItem={openItem}
              accentColor={accentColor}
              closeDetail={closeDetailRoute}
              refreshSummary={() => refresh(false)}
              openSession={(id) => setDetailRoute({ kind: "session", id })}
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
              openSession={(id) => setDetailRoute({ kind: "session", id })}
            />
          ) : null}
          {!detailRoute && activeTab === "sessions" ? (
            <SessionsPanel
              sessions={orderedSessions}
              summary={summary}
              openSession={(id) => setDetailRoute({ kind: "session", id })}
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
              counts={counts}
              metrics={metrics}
              metricsError={metricsError}
              summary={summary}
              openSurface={openSurface}
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
              openSystemPrompt={openSystemPrompt}
              openModelRouter={openModelRouter}
              openSpeech={openSpeech}
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
        { text: "Delete", style: "destructive", onPress: () => void runDelete(session) },
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
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
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
            { borderColor: `${accentColor}70`, backgroundColor: `${accentColor}18` },
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
        endpoint?.ok === false ? (
          <EmptyState
            label="Chats unavailable"
            detail={endpointErrorDetail(endpoint, "The gateway did not return chats.")}
          />
        ) : (
          <EmptyState label="No chats yet" detail="Create a Cybara chat from the gateway." />
        )
      ) : null}
    </GlassPanel>
  );
}

function MetricsPanel({
  accentColor,
  counts,
  metrics,
  metricsError,
  summary,
  openSurface,
}: {
  accentColor: string;
  counts: FeatureCounts;
  metrics: MetricsSnapshot | null;
  metricsError: string | null;
  summary: FeatureSummary | null;
  openSurface: (surface: MobileSurfaceKey) => void;
}) {
  const health = summary?.health;
  const healthy = health?.status === "healthy";
  const checks = Object.entries(health?.checks || {});
  const recentLogs = summary?.logs.slice(0, 3) ?? [];
  const overview = metrics?.overview ?? null;
  const insights = metrics?.insights ?? null;
  const tokenAnalysis = metrics?.tokenAnalysis ?? null;
  const availableMetrics = metrics
    ? Object.values(metrics.availability).filter((endpoint) => endpoint.ok).length
    : 0;
  const activitySeries = timeSeriesTotals(metrics?.timeSeries ?? null, [
    "token_usage",
    "tool_call",
    "api_call",
    "file_operation",
    "activity",
    "messages",
  ]);
  const tokenBars = tokenFlowBars(overview);
  const velocityRows = tokenVelocityAreaRows(tokenAnalysis);
  const providerRows = providerTokenShareRows(metrics);
  const modelRows = modelTokenShareRows(metrics);
  const storageRows = storageCategoryEntries(metrics?.storage ?? null).slice(0, 8);

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={HeartPulse}
          label="Health"
          value={healthy ? "Healthy" : health ? "Check" : "Loading"}
          detail={endpointStatusLabel(summary?.availability.health)}
          tone={healthy ? colors.green : colors.amber}
        />
        <SummaryTile
          Icon={Cpu}
          label="Tokens"
          value={formatMetricNumber(overview?.tokenUsage.total)}
          detail={`${formatMetricNumber(overview?.agentActivity.totalMessages)} messages`}
          tone={accentColor}
        />
        <SummaryTile
          Icon={Zap}
          label="API"
          value={metricSuccessRate(overview)}
          detail={`${formatMetricNumber(overview?.apiCalls.totalCalls)} calls`}
          tone={colors.blueText}
        />
        <SummaryTile
          Icon={Database}
          label="Storage"
          value={formatMetricBytes(metrics?.storage?.totalBytes)}
          detail={`${availableMetrics}/10 feeds`}
          tone={colors.green}
        />
      </View>

      {metricsError ? <EmptyState label="Metrics unavailable" detail={metricsError} /> : null}

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Token flow</Text>
        <Text style={styles.counterText}>Live</Text>
      </View>
      <MetricBreakdown data={tokenBars} tone={accentColor} />

      <MetricSection
        title="Activity trend"
        detail="Last 14 days across tokens, tools, API, files, and messages"
      >
        <MetricBarChart data={activitySeries} tone={accentColor} />
      </MetricSection>

      <MetricSection title="Token velocity" detail="Last 24 hours by token volume and calls">
        <MetricAreaChart data={velocityRows} tone={accentColor} />
      </MetricSection>

      <MetricSection
        title="Token heatmap"
        detail={
          tokenAnalysis?.tokenHeatmap?.hottestHour
            ? `${tokenAnalysis.tokenHeatmap.hottestHour.dayLabel} ${String(tokenAnalysis.tokenHeatmap.hottestHour.hour).padStart(2, "0")}:00 hottest`
            : "7-day hourly usage"
        }
      >
        <TokenHeatmap tokenAnalysis={tokenAnalysis} tone={accentColor} />
      </MetricSection>

      <MetricSection title="Prompt vs output" detail="Ratio, median, and response balance">
        <View style={styles.metricMicroGrid}>
          <MetricMicro
            label="Input:Output"
            value={
              tokenAnalysis?.summary?.inputToOutputRatio === null ||
              tokenAnalysis?.summary?.inputToOutputRatio === undefined
                ? "n/a"
                : `${tokenAnalysis.summary.inputToOutputRatio}:1`
            }
          />
          <MetricMicro
            label="Avg/call"
            value={formatMetricNumber(tokenAnalysis?.summary?.averageTokensPerCall)}
          />
          <MetricMicro
            label="Median"
            value={formatMetricNumber(tokenAnalysis?.summary?.medianTokensPerCall)}
          />
        </View>
        <MetricShareRows
          rows={(tokenAnalysis?.promptOutputDistribution?.bands || []).map((band) => ({
            label: band.band.replace(/_/g, " "),
            value: `${band.sharePct}%`,
            amount: band.sharePct,
          }))}
          tone={colors.green}
        />
      </MetricSection>

      <MetricSection
        title="Token insights"
        detail={`${insights?.tokenTrend24h.changePct ?? 0}% 24h trend - ${insights?.cacheEfficiency.cacheSharePct ?? 0}% cache`}
      >
        <View style={styles.metricMicroGrid}>
          <MetricMicro label="Top model share" value={`${insights?.topModel?.sharePct ?? 0}%`} />
          <MetricMicro
            label="Tool success"
            value={`${insights?.toolReliability.successRatePct ?? 100}%`}
          />
          <MetricMicro
            label="Context warnings"
            value={String(
              insights?.contextHealth24h.warnings ?? overview?.contextHealth?.warnings ?? 0
            )}
          />
        </View>
      </MetricSection>

      <MetricSection title="Provider efficiency" detail="Tokens per provider call">
        <MetricShareRows rows={providerRows} tone={colors.blueText} />
      </MetricSection>

      <MetricSection title="Models" detail="Throughput, latency, and token share">
        <MetricShareRows rows={modelRows} tone={colors.amber} />
      </MetricSection>

      <MetricSection
        title="Tools"
        detail={`${formatMetricNumber(overview?.toolCalls.totalCalls)} calls - ${formatMetricNumber(insights?.toolReliability.totalErrors)} errors`}
      >
        <MetricShareRows
          rows={(metrics?.tools?.mostUsed || []).slice(0, 7).map((tool) => ({
            label: tool.tool,
            value: `${formatMetricNumber(tool.calls)} calls`,
            amount: tool.calls,
          }))}
          tone={colors.green}
        />
        {metrics?.tools?.mostErrors?.length ? (
          <MetricShareRows
            rows={metrics.tools.mostErrors.slice(0, 4).map((tool) => ({
              label: tool.tool,
              value: `${formatMetricNumber(tool.errors)} errors`,
              amount: tool.errors,
            }))}
            tone={colors.red}
          />
        ) : null}
      </MetricSection>

      <MetricSection
        title="Files"
        detail={`${formatMetricNumber(totalFileOperations(overview))} read/write/edit operations`}
      >
        <MetricShareRows
          rows={(metrics?.files?.mostRead || []).slice(0, 4).map((file) => ({
            label: file.path.split("/").pop() || file.path,
            value: `${formatMetricNumber(file.count)} reads`,
            amount: file.count,
          }))}
          tone={colors.cyan}
        />
        <MetricShareRows
          rows={[
            ...(metrics?.files?.mostWritten || []).slice(0, 2).map((file) => ({
              label: file.path.split("/").pop() || file.path,
              value: `${formatMetricNumber(file.count)} writes`,
              amount: file.count,
            })),
            ...(metrics?.files?.mostEdited || []).slice(0, 2).map((file) => ({
              label: file.path.split("/").pop() || file.path,
              value: `${formatMetricNumber(file.count)} edits`,
              amount: file.count,
            })),
          ]}
          tone={colors.amber}
        />
      </MetricSection>

      <MetricSection title="Storage" detail={formatMetricBytes(metrics?.storage?.totalBytes)}>
        <MetricShareRows
          rows={storageRows.map((entry) => ({
            label: entry.label,
            value: formatMetricBytes(entry.bytes),
            detail: compactWorkspace(entry.path),
            amount: entry.bytes,
          }))}
          tone={colors.cyan}
        />
      </MetricSection>

      <MetricSection
        title="Token cloud"
        detail="Models, providers, tools, and recurring output terms"
      >
        <MetricTokenCloud entries={tokenAnalysis?.tokenCloud} />
      </MetricSection>

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Runtime checks</Text>
        <Text style={styles.counterText}>{checks.length}</Text>
      </View>
      {checks.length > 0 ? (
        checks.map(([key, value]) => {
          const record = value as Record<string, unknown>;
          const status =
            typeof record.status === "string" && record.status.trim()
              ? record.status
              : formatMobileValue(value);
          const detail = ["total", "running", "stopped"]
            .map((metric) =>
              typeof record[metric] === "number" ? `${metric} ${record[metric]}` : null
            )
            .filter(Boolean)
            .join(" - ");
          return (
            <View key={key} style={styles.listRow}>
              <View
                style={[
                  styles.listIcon,
                  {
                    backgroundColor:
                      status === "healthy" ? `${colors.green}18` : `${colors.amber}18`,
                  },
                ]}
              >
                <HeartPulse
                  color={status === "healthy" ? colors.green : colors.amber}
                  size={20}
                  strokeWidth={2.1}
                />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{key}</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {detail || status}
                </Text>
              </View>
            </View>
          );
        })
      ) : (
        <EmptyState label="Metrics loading" detail="Waiting for gateway health checks." />
      )}

      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recent signals</Text>
        <Pressable style={styles.smallButton} onPress={() => openSurface("logs")}>
          <Text style={styles.smallButtonText}>Logs</Text>
        </Pressable>
      </View>
      {recentLogs.length > 0 ? (
        recentLogs.map((log) => (
          <ActivityRow
            key={log.id}
            Icon={ListTodo}
            title={log.title}
            detail={`${log.source} - ${log.createdAt ? relativeTimestamp(log.createdAt) : "recent"}`}
            state="Event"
            tone={accentColor}
            onPress={() => openSurface("logs")}
          />
        ))
      ) : (
        <EmptyState
          label="No recent signals"
          detail="Gateway logs have not reported activity yet."
        />
      )}

      <MetricSection title="Metric feeds" detail={`${availableMetrics}/10 endpoints online`}>
        <MetricEndpointGrid availability={metrics?.availability} />
      </MetricSection>
    </GlassPanel>
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
}) {
  if (route.kind === "session") {
    return (
      <SessionDetailPanel
        accentColor={accentColor}
        api={api}
        closeDetail={closeDetail}
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
        onCreated={(sessionId) => {
          refreshSummary();
          openSession(sessionId);
        }}
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

function SessionDetailPanel({
  accentColor,
  api,
  closeDetail,
  refreshSummary,
  sessionSummary,
  sessionId,
  setHeaderAction,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  closeDetail: () => void;
  refreshSummary: () => void;
  sessionSummary?: SessionSummary | null;
  sessionId: string;
  setHeaderAction?: Dispatch<SetStateAction<ChatHeaderAction | null>>;
}) {
  const insets = useSafeAreaInsets();
  const navFootprint = insets.bottom + MOBILE_NAV_CHROME.floatingMargin + MOBILE_NAV_CHROME.height;
  const [detail, setDetail] = useState<SessionDetailSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [composerBarHeight, setComposerBarHeight] = useState<number>(
    MOBILE_CHAT_CHROME.composerHeight
  );
  const draftRef = useRef("");
  const [sending, setSending] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<MobilePendingChatMessage[]>([]);
  const [steeringPendingId, setSteeringPendingId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(sessionSummary?.pinned ?? false);
  const [pinning, setPinning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const headerActionRef = useRef<() => void>(() => {});
  const sessionRefreshInFlight = useRef(false);
  const sendingRef = useRef(false);
  const cachedLiveAssistant = readCachedMobileLiveAssistant(sessionId);
  const [liveAssistant, setLiveAssistant] = useState<
    SessionDetailSummary["messages"][number] | null
  >(() => cachedLiveAssistant?.message ?? null);
  const [liveNowMs, setLiveNowMs] = useState(() => cachedLiveAssistant?.nowMs ?? Date.now());

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

  const loadSession = async (showLoading = false) => {
    if (sessionRefreshInFlight.current) return;
    sessionRefreshInFlight.current = true;
    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      const nextDetail = await api.session(sessionId);
      setDetail(nextDetail);
      if (typeof nextDetail.pinned === "boolean") {
        setPinned(nextDetail.pinned);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      sessionRefreshInFlight.current = false;
      if (showLoading) setLoading(false);
    }
  };

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
          snapshotStatus === "tool_completed");
      setPendingMessages(snapshot?.pendingMessages ?? []);
      if (!active || !snapshot) {
        if (!sendingRef.current) {
          commitLiveAssistant(() => null);
        }
        return;
      }
      commitLiveAssistant(
        (current) => liveAssistantFromStatusSnapshot(sessionId, current, snapshot),
        snapshot.timestamp
      );
    } catch {}
  }, [api, commitLiveAssistant, sessionId]);

  useEffect(() => {
    if (typeof sessionSummary?.pinned === "boolean") {
      setPinned(sessionSummary.pinned);
    }
  }, [sessionId, sessionSummary?.pinned]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    const cached = readCachedMobileLiveAssistant(sessionId);
    setLiveAssistant(cached?.message ?? null);
    setLiveNowMs(cached?.nowMs ?? Date.now());
    setPendingMessages([]);
    void hydrateLiveAssistant();
  }, [hydrateLiveAssistant, sessionId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .session(sessionId)
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
          if (typeof nextDetail.pinned === "boolean") {
            setPinned(nextDetail.pinned);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, sessionId]);

  useEffect(() => {
    const disconnect = api.connectStatusStream({
      onEvent: (event) => {
        if (event.type === "assistant_token") {
          if (event.sessionId !== sessionId) return;
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
            setPendingMessages([]);
            return;
          }
          setPendingMessages(snapshot.pendingMessages ?? []);
          commitLiveAssistant(
            (current) => liveAssistantFromStatusSnapshot(sessionId, current, snapshot),
            snapshot.timestamp
          );
          return;
        }

        if (event.type !== "status" || event.sessionId !== sessionId) return;
        if (event.status === "idle") {
          if (!sendingRef.current) {
            // Keep the live working message on screen until the persisted
            // assistant reply has been fetched — clearing first left the chat
            // empty for seconds right as a run finished.
            void loadSession(false).finally(() => {
              commitLiveAssistant(() => null, event.timestamp);
              setPendingMessages([]);
            });
          }
          return;
        }
        const activity = liveActivityFromStatusEvent(event);
        if (!activity) return;
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
  }, [api, commitLiveAssistant, sessionId]);

  useEffect(() => {
    const interval = setInterval(
      () => {
        void loadSession(false);
      },
      sending ? 1800 : 3500
    );
    return () => clearInterval(interval);
  }, [api, sessionId, sending]);

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
    sending,
  ]);

  const setComposerDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
    setComposerHeight(mobileComposerHeightForDraft(value));
  };

  const resetComposerDraft = () => {
    draftRef.current = "";
    setDraft("");
    setComposerHeight(MOBILE_CHAT_COMPOSER.minHeight);
  };

  const sendMessage = async () => {
    const message = draft.trim();
    const queuedSend = sending || !!liveAssistant || pendingMessages.length > 0;
    if (!message) return;
    resetComposerDraft();
    const liveStartedAt = Date.now();
    if (!queuedSend) {
      setSending(true);
      commitLiveAssistant(
        () => liveAssistantMessage(sessionId, null, liveStartedAt),
        liveStartedAt
      );
    }
    const optimistic = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    setDetail((current) =>
      current
        ? {
            ...current,
            messages: [...current.messages, optimistic],
          }
        : current
    );
    try {
      const result = await api.sendChat({
        message,
        sessionId,
        agentId: detail?.agentId,
        workspaceDir: detail?.workspaceDir,
        queueMode: queuedSend ? "queue" : undefined,
      });
      if (result.queued) {
        setPendingMessages(result.pendingMessages ?? []);
        setDetail((current) =>
          current
            ? {
                ...current,
                workspaceDir: result.workspaceDir ?? current.workspaceDir,
                messages: current.messages.filter((entry) => entry.id !== optimistic.id),
              }
            : current
        );
        return;
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              workspaceDir: result.workspaceDir ?? current.workspaceDir,
              messages: [
                ...current.messages.filter((entry) => entry.id !== liveAssistant?.id),
                result.message,
              ],
            }
          : current
      );
      await loadSession(false);
      commitLiveAssistant(() => null);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setComposerDraft(message);
      setLoadError(messageText);
      const failedAt = Date.now();
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
    setSteeringPendingId(pendingMessageId);
    try {
      const result = await api.steerPendingMessage(sessionId, pendingMessageId);
      if (result.success) {
        setPendingMessages(result.pendingMessages ?? []);
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

  const showChatActions = () => {
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
    const workspaceDir = mobileFirstNonEmptyString(
      detail?.workspaceDir,
      sessionSummary?.workspace_dir
    );
    Alert.alert(
      "Chat settings",
      buildMobileChatSettingsLines({
        agentId,
        model,
        messageCount,
        provider,
        providerName,
        sessionId,
        title,
        updatedLabel: absoluteTimestampLabel(updatedAt),
        workspaceDir,
      }).join("\n"),
      [
        {
          text: pinned ? "Unpin chat" : "Pin chat",
          onPress: () => {
            void togglePinned();
          },
        },
        { text: "Delete chat", style: "destructive", onPress: deleteChat },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };
  headerActionRef.current = showChatActions;

  useEffect(() => {
    return () => {
      setHeaderAction?.(null);
    };
  }, [setHeaderAction, sessionId]);

  useEffect(() => {
    setHeaderAction?.({
      busy: pinning,
      onPress: () => headerActionRef.current(),
    });
  }, [setHeaderAction, sessionId, pinning]);

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={navFootprint}
      style={styles.chatShell}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.chatContent,
          { paddingBottom: navFootprint + spacing.xs + composerBarHeight + spacing.md },
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
            {visibleMessages.map((message, index) => (
              <ChatMessageRow
                key={`${message.id}-${index}`}
                accentColor={accentColor}
                message={message}
                nowMs={message.id === liveAssistant?.id ? liveNowMs : undefined}
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
                  return (
                    <View key={pendingMessage.id} style={styles.pendingQueueItem}>
                      <View style={styles.pendingQueueText}>
                        <Text style={styles.pendingQueueMeta}>
                          {steering ? "Steering" : "Queued"} -{" "}
                          {relativeTimestamp(new Date(pendingMessage.createdAt).toISOString())}
                        </Text>
                        <Text numberOfLines={3} style={styles.pendingQueueContent}>
                          {pendingMessage.content}
                        </Text>
                      </View>
                      {!steering ? (
                        <Pressable
                          accessibilityLabel="Steer pending message"
                          accessibilityRole="button"
                          disabled={steeringPendingId === pendingMessage.id}
                          onPress={() => {
                            void steerPendingMessage(pendingMessage.id);
                          }}
                          style={[
                            styles.pendingSteerButton,
                            steeringPendingId === pendingMessage.id ? { opacity: 0.6 } : null,
                          ]}
                        >
                          <Text style={styles.pendingSteerText}>
                            {steeringPendingId === pendingMessage.id ? "Steering" : "Steer"}
                          </Text>
                        </Pressable>
                      ) : null}
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
        style={[styles.chatComposerBar, { bottom: navFootprint + spacing.xs }]}
      >
        <View
          style={styles.composer}
          onLayout={(event) =>
            setComposerBarHeight(event.nativeEvent.layout.height + spacing.xs * 2)
          }
        >
          <TextInput
            blurOnSubmit={false}
            editable
            multiline
            onContentSizeChange={(event) => {
              setComposerHeight(
                mobileComposerHeightForDraft(
                  draftRef.current,
                  boundedMobileComposerHeight(event.nativeEvent.contentSize.height)
                )
              );
            }}
            value={draft}
            onChangeText={setComposerDraft}
            placeholder="Message this chat"
            placeholderTextColor={colors.textDim}
            returnKeyType="default"
            scrollEnabled={composerHeight >= MOBILE_CHAT_COMPOSER.maxHeight}
            style={[styles.composerInput, { height: composerHeight }]}
            submitBehavior="newline"
            textAlignVertical="top"
          />
          <Pressable
            accessibilityLabel="Send message"
            accessibilityRole="button"
            disabled={!draft.trim()}
            onPress={sendMessage}
            style={[
              styles.sendButton,
              {
                backgroundColor: draft.trim() ? accentColor : colors.inset,
                opacity: draft.trim() || sending ? 1 : 0.55,
              },
            ]}
          >
            <Send color={colors.text} size={19} strokeWidth={2.4} />
          </Pressable>
        </View>
      </LiquidGlass>
    </KeyboardAvoidingView>
  );
}

function compactWorkspace(value?: string | null): string {
  if (!value) return "No workspace";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `.../${parts.slice(-2).join("/")}`;
}

function TasksPanel({
  summary,
  accentColor,
  openTask,
  createTask,
}: {
  summary: FeatureSummary | null;
  accentColor: string;
  openTask: (item: RemoteItemSummary | ActivitySummary) => void;
  createTask: () => void;
}) {
  const rows = surfaceRows("tasks", summary);
  const endpoint = summary?.availability.tasks;
  const unavailable = endpoint?.ok === false;

  return (
    <>
      <View style={styles.tasksHeader}>
        <View style={styles.tasksHeaderText}>
          <Text style={styles.tasksTitle}>Scheduled tasks</Text>
          <Text style={styles.tasksSubtitle}>
            {rows.length > 0
              ? rows.length === 1
                ? "1 automation"
                : `${rows.length} automations`
              : "Run an agent on a schedule"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="New task"
          accessibilityRole="button"
          onPress={createTask}
          style={[styles.tasksNewButton, { borderColor: accentColor }]}
        >
          <Plus color={accentColor} size={18} strokeWidth={2.6} />
          <Text style={[styles.tasksNewText, { color: accentColor }]}>New</Text>
        </Pressable>
      </View>

      <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
        {!summary ? (
          <EmptyState label="Tasks loading" detail="Refreshing from the gateway." />
        ) : unavailable ? (
          <EmptyState
            label="Tasks unavailable"
            detail={endpointErrorDetail(endpoint, "The gateway did not return tasks.")}
          />
        ) : rows.length === 0 ? (
          <View style={styles.tasksEmpty}>
            <View
              style={[
                styles.listIcon,
                styles.tasksEmptyIcon,
                { backgroundColor: `${accentColor}18` },
              ]}
            >
              <CalendarCheck color={accentColor} size={22} strokeWidth={2.1} />
            </View>
            <Text style={styles.tasksEmptyTitle}>No tasks yet</Text>
            <Text style={styles.tasksEmptyDetail}>
              Schedule an agent to run automatically — reports, checks, or recurring jobs.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={createTask}
              style={[styles.tasksEmptyCta, { backgroundColor: accentColor }]}
            >
              <Plus color={colors.text} size={17} strokeWidth={2.5} />
              <Text style={styles.tasksEmptyCtaText}>Create your first task</Text>
            </Pressable>
          </View>
        ) : (
          rows.map((row) => (
            <Pressable key={row.id} style={styles.listRow} onPress={() => openTask(row)}>
              <View style={[styles.listIcon, { backgroundColor: `${accentColor}18` }]}>
                <CalendarCheck color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text numberOfLines={1} style={styles.listTitle}>
                  {row.title}
                </Text>
                <Text numberOfLines={1} style={styles.listDetail}>
                  {row.detail}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          ))
        )}
      </GlassPanel>
    </>
  );
}

function MemoryRecallCard({
  api,
  summary,
  accentColor,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  summary: FeatureSummary | null;
  accentColor: string;
  refreshSummary: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const configAvailable = summary?.availability.config.ok === true;
  const configRecord = (summary?.config ?? {}) as Record<string, unknown>;
  const workspaceIndexer = (configRecord.workspace_indexer ?? {}) as Record<string, unknown>;
  const memoryMethod =
    typeof workspaceIndexer.embeddingProvider === "string"
      ? (workspaceIndexer.embeddingProvider as string)
      : "auto";

  const save = async (value: string) => {
    if (!configAvailable || saving) return;
    setSaving(true);
    try {
      const result = await api.updateConfig({
        workspace_indexer: { ...workspaceIndexer, embeddingProvider: value },
      });
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Memory method setting failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recall</Text>
      </View>
      {configAvailable ? (
        <SettingSelector
          disabled={saving}
          label="Recall method"
          onSelect={save}
          options={[
            { label: "Auto", value: "auto" },
            { label: "Local", value: "transformers_js" },
            { label: "OpenAI", value: "openai" },
            { label: "Gemini", value: "gemini" },
            { label: "Ollama", value: "ollama" },
          ]}
          selected={memoryMethod}
          tone={accentColor}
          variant="menu"
        />
      ) : (
        <EmptyState
          label="Memory settings unavailable"
          detail={endpointErrorDetail(
            summary?.availability.config,
            "The gateway did not return config settings."
          )}
        />
      )}
    </GlassPanel>
  );
}

function SurfaceDetailPanel({
  api,
  accentColor,
  profile,
  summary,
  surface,
  openItem,
  loadMoreLogs,
  loadingMoreLogs,
  logPageError,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  accentColor: string;
  profile: GatewayProfile;
  summary: FeatureSummary | null;
  surface: MobileSurfaceKey;
  openItem: (item: RemoteItemSummary | ActivitySummary) => void;
  loadMoreLogs: () => void;
  loadingMoreLogs: boolean;
  logPageError: string | null;
  refreshSummary: () => void;
}) {
  const meta = surfaceMeta[surface];
  const rows = surfaceRows(surface, summary);
  const endpoint = meta.endpoint ? summary?.availability[meta.endpoint] : undefined;
  const isLogsSurface = surface === "logs";
  const totalLogs = summary?.logsTotal ?? rows.length;
  const logPageSize = summary?.logsLimit ?? MOBILE_LOGS_CHROME.pageSize;
  const hasMoreLogs = Boolean(summary?.logsHasMore);
  const counterLabel = isLogsSurface
    ? `${rows.length}/${totalLogs}`
    : endpoint
      ? endpointStatusLabel(endpoint)
      : String(rows.length);

  return (
    <>
      {surface === "memory" ? (
        <MemoryRecallCard
          api={api}
          summary={summary}
          accentColor={accentColor}
          refreshSummary={refreshSummary}
        />
      ) : null}
      <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
        <View style={styles.subsectionHeader}>
          <Text style={styles.subsectionTitle}>Live records</Text>
          <Text style={styles.counterText}>{counterLabel}</Text>
        </View>
        {isLogsSurface && summary ? (
          <Text style={styles.pageDetailText}>
            Showing {rows.length} of {totalLogs} gateway log events
          </Text>
        ) : null}
        {!summary ? (
          <EmptyState label={`${meta.title} loading`} detail="Refreshing from the gateway." />
        ) : endpoint?.ok === false ? (
          <EmptyState
            label={`${meta.title} unavailable`}
            detail={endpointErrorDetail(endpoint, "The gateway did not return this surface.")}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            label={`No ${meta.title.toLowerCase()}`}
            detail="No records were returned for this gateway surface."
          />
        ) : (
          rows.map((row) => {
            const Icon = meta.Icon;
            return (
              <Pressable key={row.id} style={styles.listRow} onPress={() => openItem(row)}>
                <View style={[styles.listIcon, { backgroundColor: `${meta.tone}18` }]}>
                  <Icon color={meta.tone} size={20} strokeWidth={2.1} />
                </View>
                <View style={styles.listText}>
                  <Text numberOfLines={1} style={styles.listTitle}>
                    {row.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.listDetail}>
                    {row.detail}
                  </Text>
                </View>
                <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
              </Pressable>
            );
          })
        )}
        {isLogsSurface && summary && rows.length > 0 ? (
          <View style={styles.logPageFooter}>
            {logPageError ? <Text style={styles.errorText}>{logPageError}</Text> : null}
            {hasMoreLogs ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingMoreLogs}
                onPress={loadMoreLogs}
                style={[styles.loadMoreButton, loadingMoreLogs && styles.loadMoreButtonDisabled]}
              >
                {loadingMoreLogs ? (
                  <ActivityIndicator color={colors.blueText} size="small" />
                ) : null}
                <Text style={styles.loadMoreButtonText}>
                  {loadingMoreLogs ? "Loading logs" : `Load ${logPageSize} more`}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.pageDetailText}>All logs loaded</Text>
            )}
          </View>
        ) : null}
      </GlassPanel>
    </>
  );
}

function ItemDetailPanel({
  api,
  closeDetail,
  refreshSummary,
  route,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  refreshSummary: () => void;
  route: Extract<DetailRoute, { kind: "item" }>;
  summary: FeatureSummary | null;
}) {
  const item = route.item;
  const meta = surfaceMeta[route.surface];
  const Icon = meta.Icon;
  if (route.surface === "agents" && MOBILE_SETTINGS_DETAIL_CHROME.agentsEditable) {
    return (
      <AgentSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
        summary={summary}
      />
    );
  }
  if (route.surface === "providers" && MOBILE_SETTINGS_DETAIL_CHROME.providersEditable) {
    return (
      <ProviderSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
        summary={summary}
      />
    );
  }
  if (route.surface === "channels" && MOBILE_SETTINGS_DETAIL_CHROME.channelsEditable) {
    return (
      <ChannelSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.surface === "tasks" && MOBILE_SETTINGS_DETAIL_CHROME.tasksActionable) {
    return (
      <TaskSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
      />
    );
  }
  if (route.surface === "wallet" && MOBILE_SETTINGS_DETAIL_CHROME.walletPolicyUsesToggles) {
    return (
      <WalletPolicyPanel api={api} item={item} refreshSummary={refreshSummary} summary={summary} />
    );
  }
  if (route.surface === "monitor" && MOBILE_SETTINGS_DETAIL_CHROME.monitorShowsHostTelemetry) {
    return (
      <SystemMonitorDetailPanel item={item} refreshSummary={refreshSummary} summary={summary} />
    );
  }
  if (route.surface === "approvals" && MOBILE_SETTINGS_DETAIL_CHROME.approvalsActionable) {
    return (
      <ApprovalSettingsPanel
        api={api}
        closeDetail={closeDetail}
        item={item}
        refreshSummary={refreshSummary}
      />
    );
  }
  const fields = [
    ...("status" in item && item.status ? [{ label: "Status", value: item.status }] : []),
    ...("type" in item && item.type ? [{ label: "Type", value: item.type }] : []),
    ...("createdAt" in item && item.createdAt
      ? [{ label: "Time", value: absoluteTimestampLabel(item.createdAt) }]
      : []),
    ...cleanSettingsFields(item.fields),
  ];

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${meta.tone}18` }]}>
          <Icon color={meta.tone} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.itemDetail}>
            {item.detail}
          </Text>
        </View>
      </View>
      {fields.length === 0 ? (
        <EmptyState
          label="No editable settings"
          detail="This gateway surface does not expose mobile-editable settings yet."
        />
      ) : (
        <DetailInfoSection title="Details" fields={fields} />
      )}
    </GlassPanel>
  );
}

function SettingsPanel({
  accentColor,
  accentKey,
  api,
  connectionError,
  profile,
  refreshSummary,
  summary,
  onThemeAccentChange,
  onDisconnect,
  openSurface,
  openSystemPrompt,
  openModelRouter,
  openSpeech,
}: {
  accentColor: string;
  accentKey: AccentKey;
  api: CybaraMobileApi;
  connectionError: string | null;
  profile: GatewayProfile;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
  onThemeAccentChange: (accent: AccentKey) => void;
  onDisconnect: () => void;
  openSurface: (surface: MobileSurfaceKey) => void;
  openSystemPrompt: () => void;
  openModelRouter: () => void;
  openSpeech: () => void;
}) {
  const counts = summarizeFeatureCounts(summary);
  const { mode: appearanceMode, setMode: setAppearanceMode } = useThemeControls();
  const [savingAccent, setSavingAccent] = useState<AccentKey | null>(null);
  const [savingConfigKey, setSavingConfigKey] = useState<string | null>(null);
  const [savingAgentAccess, setSavingAgentAccess] = useState(false);
  const configAvailable = summary?.availability.config.ok === true;
  const systemPromptAvailable =
    summary?.availability.systemPrompt.ok === true && Boolean(summary.systemPrompt);
  const health = summary?.health;
  const healthy = health?.status === "healthy";
  const authStatus = mobileGatewayAuthStatus(summary, connectionError);
  const healthUnavailable = authStatus === "unreachable";
  const gatewayStatusColor =
    healthy && authStatus === "connected"
      ? colors.green
      : healthUnavailable || authStatus === "needs_pairing"
        ? colors.red
        : colors.amber;
  const gatewayStatusLabel = healthy
    ? authStatus === "needs_pairing"
      ? "Pairing needs refresh"
      : "Gateway connected"
    : healthUnavailable
      ? "Gateway degraded"
      : "Checking gateway";
  const gatewayVersion = health?.version
    ? `v${String(health.version).replace(/^v/i, "")}`
    : "pending";
  const gatewayUptime = formatUptime(health?.uptime);
  const terminalEnabled = summary?.config.terminal_enabled === true;
  const selfImprovingSkillsEnabled = summary?.config.self_improving_skills_enabled !== false;
  const toolApprovalMode = readMobileToolApprovalMode(summary?.config);
  const reasoningEffort = readMobileReasoningEffort(summary?.config);
  const dangerousPolicy = readMobileDangerousToolPolicy(summary?.config);
  const sandboxRuntime = readMobileSandboxRuntime(summary?.config);
  const walletStatus = objectRecord(summary?.walletStatus);
  const walletStatusAvailable = Boolean(walletStatus);
  const agentAccessEnabled = booleanSetting(walletStatus, "agentAccessEnabled");

  const saveConfigPatch = async (
    key: string,
    patch: Record<string, unknown>,
    errorTitle = "Setting update failed"
  ) => {
    if (!configAvailable || savingConfigKey) return;
    setSavingConfigKey(key);
    try {
      const result = await api.updateConfig(patch);
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(errorTitle, error instanceof Error ? error.message : String(error));
    } finally {
      setSavingConfigKey(null);
    }
  };

  const toggleAgentAccess = async () => {
    if (!walletStatusAvailable || savingAgentAccess) return;
    setSavingAgentAccess(true);
    try {
      const result = await api.setWalletAgentAccess(!agentAccessEnabled);
      if (result.success === false) {
        throw new Error("The gateway did not update wallet agent access.");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Wallet access update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSavingAgentAccess(false);
    }
  };

  const updateThemeAccent = async (next: AccentKey) => {
    if (savingAccent || next === accentKey) return;
    const previous = readMobileAccent(summary?.config) as AccentKey;
    onThemeAccentChange(next);
    setSavingAccent(next);
    try {
      const result = await api.updateConfig(mobileThemeConfigPayload(next));
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      onThemeAccentChange(previous);
      Alert.alert("Theme update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAccent(null);
    }
  };

  return (
    <GlassPanel
      elevated
      contentStyle={
        MOBILE_SETTINGS_ROOT_CHROME.settingsEdgeToEdgeContent
          ? styles.settingsRootContent
          : undefined
      }
      style={[styles.detailPanel, styles.mainTabPanel]}
    >
      <View style={styles.settingsNativePage}>
        {MOBILE_SETTINGS_ROOT_CHROME.gatewayConnectionDetails ? (
          <View style={styles.settingsSection}>
            <View style={styles.settingsGatewayCard}>
              <View style={styles.connectionRow}>
                <View style={[styles.liveDot, { backgroundColor: gatewayStatusColor }]} />
                <Text style={[styles.connectionText, { color: gatewayStatusColor }]}>
                  {gatewayStatusLabel}
                </Text>
              </View>
              <View style={styles.gatewayTop}>
                <View style={styles.gatewayIdentity}>
                  <Text style={styles.gatewayName}>{profile.name}</Text>
                  <Text style={styles.gatewayMeta}>{compactHost(profile.baseUrl)}</Text>
                </View>
              </View>
              <View style={styles.gatewayDetailGrid}>
                <GatewayDetailPill label="Uptime" value={gatewayUptime} />
                <GatewayDetailPill label="Version" value={gatewayVersion} />
                <GatewayDetailPill label="Endpoint" value={profile.baseUrl} />
                <GatewayDetailPill
                  label="Device"
                  value={profile.deviceId ? "Paired" : "Manual API key"}
                />
              </View>
              {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}
              {authStatus === "needs_pairing" ? (
                <Text style={styles.errorText}>
                  The gateway is reachable, but this device token was rejected. Disconnect this
                  profile and pair again from the gateway Mobile page.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        <SettingsSection title="Appearance">
          <SettingSelector
            label="Theme"
            onSelect={(value) => {
              if (value === "system" || value === "light" || value === "dark") {
                setAppearanceMode(value);
              }
            }}
            options={[
              { label: "System", value: "system" },
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
            ]}
            selected={appearanceMode}
            tone={accentColor}
            variant="segmented"
          />
        </SettingsSection>
        <SettingsSection
          accessory={savingAccent ? <ActivityIndicator color={accentColor} size="small" /> : null}
          title="Highlight color"
        >
          <View style={styles.accentGrid}>
            {MOBILE_ACCENT_KEYS.map((key) => {
              const themeKey = key as AccentKey;
              const tone = accentPalette[themeKey];
              const selected = accentKey === themeKey;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: Boolean(savingAccent) }}
                  disabled={Boolean(savingAccent)}
                  onPress={() => {
                    void updateThemeAccent(themeKey);
                  }}
                  style={[
                    styles.accentSwatch,
                    selected && {
                      borderColor: tone,
                      backgroundColor: `${tone}16`,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.accentSwatchDot,
                      {
                        backgroundColor: tone,
                        shadowColor: tone,
                      },
                      selected && styles.accentSwatchDotActive,
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.accentSwatchLabel, selected && { color: colors.text }]}
                  >
                    {key}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SettingsSection>
        <SettingsSection title="Platform controls">
          {configAvailable ? (
            <>
              {MOBILE_SETTINGS_ROOT_CHROME.terminalToggle ? (
                <SettingToggle
                  busy={savingConfigKey === "terminal_enabled"}
                  detail="Enable browser-based terminal access on the gateway."
                  disabled={savingConfigKey !== null}
                  label="Web terminal"
                  onPress={() => {
                    void saveConfigPatch(
                      "terminal_enabled",
                      { terminal_enabled: !terminalEnabled },
                      "Terminal setting failed"
                    );
                  }}
                  tone={accentColor}
                  value={terminalEnabled}
                />
              ) : null}
              <SettingToggle
                busy={savingConfigKey === "self_improving_skills_enabled"}
                detail="Let agents save reusable skills after complex tasks. When off, skill_save is withheld."
                disabled={savingConfigKey !== null}
                label="Self-improving skills"
                onPress={() => {
                  void saveConfigPatch(
                    "self_improving_skills_enabled",
                    { self_improving_skills_enabled: !selfImprovingSkillsEnabled },
                    "Self-improving skills setting failed"
                  );
                }}
                tone={accentColor}
                value={selfImprovingSkillsEnabled}
              />
              {MOBILE_SETTINGS_ROOT_CHROME.toolApprovalModeSelector ? (
                <SettingSelector
                  disabled={savingConfigKey !== null}
                  label="Tool approvals"
                  onSelect={(value) => {
                    void saveConfigPatch(
                      "tool_approval_mode",
                      { tool_approval_mode: value === "ask" ? "ask" : "always_allow" },
                      "Tool approval setting failed"
                    );
                  }}
                  options={[
                    { label: "Always Allow", value: "always_allow" },
                    { label: "Ask Me", value: "ask" },
                  ]}
                  selected={toolApprovalMode}
                  tone={accentColor}
                  variant="menu"
                />
              ) : null}
              {MOBILE_SETTINGS_ROOT_CHROME.reasoningEffortSelector ? (
                <SettingSelector
                  disabled={savingConfigKey !== null}
                  label="Reasoning effort"
                  onSelect={(value) => {
                    void saveConfigPatch(
                      "reasoning_effort",
                      { reasoning_effort: value },
                      "Reasoning effort setting failed"
                    );
                  }}
                  options={MOBILE_REASONING_EFFORT_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                  selected={reasoningEffort}
                  tone={accentColor}
                  variant="menu"
                />
              ) : null}
              {MOBILE_SETTINGS_ROOT_CHROME.dangerousToolPolicyToggle ? (
                <>
                  <SettingToggle
                    busy={savingConfigKey === "dangerous_tool_policy"}
                    detail="Guardrails for shell, wallet, and other high-impact tools."
                    disabled={savingConfigKey !== null}
                    label="Dangerous tool policy"
                    onPress={() => {
                      void saveConfigPatch(
                        "dangerous_tool_policy",
                        {
                          dangerous_tool_policy: {
                            enabled: !dangerousPolicy.enabled,
                            mode: dangerousPolicy.mode,
                          },
                        },
                        "Dangerous tool policy failed"
                      );
                    }}
                    tone={accentColor}
                    value={dangerousPolicy.enabled}
                  />
                  {dangerousPolicy.enabled ? (
                    <SettingSelector
                      disabled={savingConfigKey !== null}
                      label="Dangerous policy mode"
                      onSelect={(value) => {
                        void saveConfigPatch(
                          "dangerous_tool_policy",
                          {
                            dangerous_tool_policy: {
                              enabled: true,
                              mode: value === "block" ? "block" : "audit",
                            },
                          },
                          "Dangerous tool policy failed"
                        );
                      }}
                      options={[
                        { label: "Audit", value: "audit" },
                        { label: "Block", value: "block" },
                      ]}
                      selected={dangerousPolicy.mode}
                      tone={accentColor}
                      variant="segmented"
                    />
                  ) : null}
                </>
              ) : null}
              {MOBILE_SETTINGS_ROOT_CHROME.sandboxRuntimeControls ? (
                <>
                  <SettingToggle
                    busy={savingConfigKey === "sandbox_runtime"}
                    detail="Run supported command tools in an isolated runtime."
                    disabled={savingConfigKey !== null}
                    label="Command sandbox"
                    onPress={() => {
                      void saveConfigPatch(
                        "sandbox_runtime",
                        {
                          sandbox_runtime: {
                            ...sandboxRuntime,
                            enabled: !sandboxRuntime.enabled,
                          },
                        },
                        "Sandbox setting failed"
                      );
                    }}
                    tone={accentColor}
                    value={sandboxRuntime.enabled}
                  />
                  {sandboxRuntime.enabled ? (
                    <>
                      <SettingSelector
                        disabled={savingConfigKey !== null}
                        label="Sandbox provider"
                        onSelect={(value) => {
                          const provider =
                            value === "apple_sandbox" || value === "podman" || value === "docker"
                              ? value
                              : "auto";
                          void saveConfigPatch(
                            "sandbox_runtime",
                            {
                              sandbox_runtime: {
                                ...sandboxRuntime,
                                provider,
                              },
                            },
                            "Sandbox setting failed"
                          );
                        }}
                        options={[
                          { label: "Auto", value: "auto" },
                          { label: "Apple", value: "apple_sandbox" },
                          { label: "Podman", value: "podman" },
                          { label: "Docker", value: "docker" },
                        ]}
                        selected={sandboxRuntime.provider}
                        tone={accentColor}
                        variant="segmented"
                      />
                      <SettingSelector
                        disabled={savingConfigKey !== null}
                        label="Sandbox network"
                        onSelect={(value) => {
                          void saveConfigPatch(
                            "sandbox_runtime",
                            {
                              sandbox_runtime: {
                                ...sandboxRuntime,
                                network: value === "allow" ? "allow" : "deny",
                              },
                            },
                            "Sandbox setting failed"
                          );
                        }}
                        options={[
                          { label: "Deny", value: "deny" },
                          { label: "Allow", value: "allow" },
                        ]}
                        selected={sandboxRuntime.network}
                        tone={accentColor}
                        variant="segmented"
                      />
                    </>
                  ) : null}
                </>
              ) : null}
              {MOBILE_SETTINGS_ROOT_CHROME.walletAccessShortcut ? (
                <SettingToggle
                  busy={savingAgentAccess}
                  detail="Master switch for agent-initiated wallet actions."
                  disabled={!walletStatusAvailable || savingAgentAccess}
                  label="Agent wallet access"
                  onPress={() => {
                    void toggleAgentAccess();
                  }}
                  tone={accentColor}
                  value={agentAccessEnabled}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              label="Config unavailable"
              detail={endpointErrorDetail(
                summary?.availability.config,
                "The gateway did not return editable settings."
              )}
            />
          )}
        </SettingsSection>
        <SettingsSection title="Assistant">
          <Pressable
            accessibilityRole="button"
            style={styles.settingsNavigationRow}
            onPress={openSystemPrompt}
          >
            <View style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}>
              <Sparkles color={accentColor} size={20} strokeWidth={2.1} />
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>System Prompt</Text>
              <Text style={styles.listDetail} numberOfLines={1}>
                {systemPromptAvailable
                  ? summary?.systemPrompt?.identity?.name
                    ? `Identity: ${summary.systemPrompt.identity.name}`
                    : "Identity, instructions, and behavior"
                  : endpointStatusLabel(summary?.availability.systemPrompt)}
              </Text>
            </View>
            <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
          </Pressable>
          {MOBILE_SETTINGS_ROOT_CHROME.modelRouterControls ? (
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openModelRouter}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Network color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>Model Router</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  Provider routing, fallback, and spend caps
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          ) : null}
        </SettingsSection>
        {MOBILE_SETTINGS_ROOT_CHROME.speechControls ? (
          <SettingsSection title="Voice & Speech">
            <Pressable
              accessibilityRole="button"
              style={styles.settingsNavigationRow}
              onPress={openSpeech}
            >
              <View
                style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}
              >
                <Volume2 color={accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>Text-to-speech & dictation</Text>
                <Text style={styles.listDetail} numberOfLines={1}>
                  {configAvailable
                    ? "Voice output provider, model, and speech-to-text"
                    : endpointStatusLabel(summary?.availability.config)}
                </Text>
              </View>
              <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
            </Pressable>
          </SettingsSection>
        ) : null}
        <SettingsSection title="Gateway APIs">
          <SettingsRow
            Icon={Database}
            label="Config API"
            value={endpointStatusLabel(summary?.availability.config)}
          />
        </SettingsSection>
        <SettingsSection title="Gateway management">
          {MOBILE_SETTINGS_SURFACES.map((surface) => {
            const meta = surfaceMeta[surface];
            const Icon = meta.Icon;
            const rows = surfaceRows(surface, summary);
            return (
              <Pressable
                key={surface}
                style={styles.settingsNavigationRow}
                onPress={() => openSurface(surface)}
              >
                <View
                  style={[styles.settingsNavigationIcon, { backgroundColor: `${meta.tone}18` }]}
                >
                  <Icon color={meta.tone} size={20} strokeWidth={2.1} />
                </View>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>{meta.title}</Text>
                  <Text style={styles.listDetail} numberOfLines={1}>
                    {surfaceMenuDetail(surface, summary, counts, rows.length)}
                  </Text>
                </View>
                <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
              </Pressable>
            );
          })}
        </SettingsSection>
        <View style={styles.settingsSection}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.disconnectButton,
              pressed && styles.disconnectButtonPressed,
            ]}
            onPress={() => {
              haptics.warning();
              Alert.alert(
                "Disconnect gateway?",
                "This removes the pairing profile from this device. You'll need to pair again to reconnect.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Disconnect", style: "destructive", onPress: onDisconnect },
                ]
              );
            }}
          >
            <View style={styles.disconnectIcon}>
              <Trash2 color={colors.red} size={18} strokeWidth={2.4} />
            </View>
            <View style={styles.disconnectTextWrap}>
              <Text style={styles.disconnectTitle}>Disconnect Gateway</Text>
              <Text style={styles.disconnectDetail}>Remove this mobile pairing profile</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </GlassPanel>
  );
}
