import {
  useEffect,
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
  StyleSheet,
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
} from "../lib/api";
import {
  chatIsWaitingForAssistant,
  buildMobileWorkTimeline,
  hasUnicodeTextFallback,
  latestVisibleChatMessages,
  shouldUseSelectableNativeText,
  splitMessageContent,
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
  storageCategoryEntries,
  timeSeriesTotals,
  tokenFlowBars,
  totalFileOperations,
  type MetricsSnapshot,
} from "../lib/metrics";
import {
  accentPalette,
  colors,
  radius,
  spacing,
  subscribeColors,
  typography,
  type AccentKey,
} from "../theme/liquidGlass";
import cybaraLogo from "../../assets/cybara.png";

type IconGlyph = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

interface ModuleCard {
  key: string;
  label: string;
  detail: string;
  value: string;
  Icon: IconGlyph;
  tab: MobileTabKey;
  surface?: MobileSurfaceKey;
}

type EndpointState = FeatureSummary["availability"][FeatureEndpointKey] | undefined;
type DetailRoute =
  | { kind: "session"; id: string }
  | { kind: "newChat" }
  | { kind: "newTask" }
  | { kind: "systemPrompt" }
  | { kind: "modelRouter" }
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
  agents: { title: "Agents", Icon: Bot, get tone() { return colors.cyan; }, endpoint: "agents" },
  providers: { title: "Providers", Icon: Database, get tone() { return colors.blueText; }, endpoint: "providers" },
  tools: { title: "Tools", Icon: Wrench, get tone() { return colors.green; }, endpoint: "tools" },
  approvals: { title: "Approvals", Icon: ShieldCheck, get tone() { return colors.amber; }, endpoint: "approvals" },
  wallet: {
    title: "Wallet Policy",
    Icon: ShieldCheck,
    get tone() { return colors.green; },
    endpoint: "walletPolicy",
  },
  channels: { title: "Channels", Icon: Link2, get tone() { return colors.cyan; }, endpoint: "channels" },
  tasks: { title: "Tasks", Icon: CalendarCheck, get tone() { return colors.blueText; }, endpoint: "tasks" },
  memory: { title: "Memory", Icon: Brain, get tone() { return colors.green; }, endpoint: "memory" },
  logs: { title: "Logs", Icon: ListTodo, get tone() { return colors.textMuted; }, endpoint: "logs" },
  monitor: {
    title: "System Monitor",
    Icon: Cpu,
    get tone() { return colors.blueText; },
    endpoint: "systemMonitor",
  },
};

const agentTypeOptions = ["main", "research", "coder", "planner", "ops", "worker"] as const;

type WalletPolicyToggleKey = Extract<
  keyof WalletAgentPolicyUpdate,
  | "allowNativeSend"
  | "allowTokenSend"
  | "allowEthContractWrite"
  | "allowSolProgramInstruction"
  | "allowEthSwaps"
  | "allowDappInteraction"
  | "allowX402Payments"
>;

const walletPolicyToggleRows: Array<{
  key: WalletPolicyToggleKey;
  label: string;
  detail: string;
}> = [
  {
    key: "allowNativeSend",
    label: "Native sends",
    detail: "Allow agents to send native wallet assets.",
  },
  {
    key: "allowTokenSend",
    label: "Token sends",
    detail: "Allow agents to send token balances.",
  },
  {
    key: "allowEthContractWrite",
    label: "ETH contract writes",
    detail: "Allow Ethereum contract write calls within policy limits.",
  },
  {
    key: "allowSolProgramInstruction",
    label: "Solana program instructions",
    detail: "Allow Solana program instructions within policy limits.",
  },
  {
    key: "allowEthSwaps",
    label: "ETH swaps",
    detail: "Allow Uniswap and compatible Ethereum swap actions.",
  },
  {
    key: "allowDappInteraction",
    label: "Dapp interaction",
    detail: "Allow configured dapp adapters and host allowlists.",
  },
  {
    key: "allowX402Payments",
    label: "x402 payments",
    detail: "Allow agent-initiated x402 payment requests.",
  },
];

const systemPromptFeatureCopy: Record<SystemPromptFeatureKey, { label: string; detail: string }> = {
  memoryEnabled: {
    label: "Memory recall",
    detail: "Include durable memory context in agent prompts.",
  },
  skillsEnabled: {
    label: "Skills",
    detail: "Expose installed skills in the agent prompt.",
  },
  messagingEnabled: {
    label: "Messaging",
    detail: "Let agents use configured messaging surfaces.",
  },
  replyTagsEnabled: {
    label: "Reply tags",
    detail: "Include structured reply tags for channel responses.",
  },
};

const systemPromptFeatureRows = MOBILE_SYSTEM_PROMPT_FEATURE_KEYS.map((key) => ({
  key,
  ...systemPromptFeatureCopy[key],
}));

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function booleanSetting(record: Record<string, unknown> | null, key: string): boolean {
  return record?.[key] === true;
}

type MobileSpeechSettings = {
  tts: {
    provider: "auto" | "system" | "elevenlabs" | "openai";
    providerId: string;
    model: string;
    voice: string;
    outputFormat: string;
    speed: number;
    maxTextLength: number;
    fallbackToSystem: boolean;
  };
  stt: {
    provider: "auto" | "openai";
    providerId: string;
    model: string;
    language: string;
  };
};

function readMobileSpeechSettings(configRecord: Record<string, unknown> | null | undefined): MobileSpeechSettings {
  const speech = objectRecord(configRecord?.speech);
  const tts = objectRecord(speech?.tts);
  const stt = objectRecord(speech?.stt);
  const ttsProvider =
    tts?.provider === "system" || tts?.provider === "elevenlabs" || tts?.provider === "openai"
      ? tts.provider
      : "auto";
  const sttProvider = stt?.provider === "openai" ? "openai" : "auto";
  return {
    tts: {
      provider: ttsProvider,
      providerId: typeof tts?.providerId === "string" ? tts.providerId : "",
      model: typeof tts?.model === "string" ? tts.model : "",
      voice: typeof tts?.voice === "string" ? tts.voice : "",
      outputFormat: typeof tts?.outputFormat === "string" ? tts.outputFormat : "mp3",
      speed: typeof tts?.speed === "number" && Number.isFinite(tts.speed) ? tts.speed : 1,
      maxTextLength:
        typeof tts?.maxTextLength === "number" && Number.isFinite(tts.maxTextLength)
          ? tts.maxTextLength
          : 8000,
      fallbackToSystem: typeof tts?.fallbackToSystem === "boolean" ? tts.fallbackToSystem : true,
    },
    stt: {
      provider: sttProvider,
      providerId: typeof stt?.providerId === "string" ? stt.providerId : "",
      model: typeof stt?.model === "string" ? stt.model : "",
      language: typeof stt?.language === "string" ? stt.language : "",
    },
  };
}

function mobileSpeechProviderOptions(providers: ProviderSummary[], mode: "tts" | "stt") {
  return [
    { label: "Auto", value: "" },
    ...providers
      .filter((provider) => {
        if (mode === "tts") {
          return (
            provider.provider === "elevenlabs" ||
            provider.provider === "openai" ||
            provider.provider === "openai-codex"
          );
        }
        return provider.provider === "openai" || provider.provider === "openai-codex";
      })
      .map((provider) => ({
        label: provider.name,
        value: provider.id,
      })),
  ];
}

function arraySettingCount(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length === 0) return "None";
  return value.length === 1 ? "1 entry" : `${value.length} entries`;
}

function endpointErrorDetail(endpoint: EndpointState, fallback: string): string {
  if (!endpoint || endpoint.ok) return fallback;
  if (endpoint.status) return `Gateway returned ${endpoint.status}.`;
  return endpoint.error || fallback;
}

function endpointStatusLabel(endpoint: EndpointState): string {
  if (!endpoint) return "Loading";
  if (endpoint.ok) return "Online";
  return endpoint.status ? `Unavailable (${endpoint.status})` : "Unavailable";
}

function surfaceCount(
  summary: FeatureSummary | null,
  key: FeatureEndpointKey,
  count: number,
  suffix: string,
  empty: string,
  singularSuffix = suffix
): string {
  if (!summary) return "Loading";
  const endpoint = summary.availability[key];
  if (!endpoint.ok) return endpoint.status ? `Unavailable (${endpoint.status})` : "Unavailable";
  if (count === 0) return empty;
  return `${count} ${count === 1 ? singularSuffix : suffix}`;
}

function sessionMayBeInProgress(session: SessionSummary): boolean {
  return session.last_message?.role === "user";
}

function relativeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "recent";
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function absoluteTimestampLabel(value?: string): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

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

function displayFields(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(record)
    .filter(([key]) => !/secret|token|api[_-]?key|password|credential|mnemonic/i.test(key))
    .map(([label, value]) => ({
      label: label.replace(/_/g, " "),
      value: formatMobileValue(value),
    }));
}

function displayFieldLabel(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanSettingsFields(
  fields: Array<{ label: string; value: string }> = []
): Array<{ label: string; value: string }> {
  return fields
    .filter((field) => isMobileSettingsDetailFieldVisible(field.label))
    .map((field) => ({ ...field, label: displayFieldLabel(field.label) }));
}

function monitorPercent(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
}

function monitorPercentLabel(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : "n/a";
}

function monitorOverviewLabel(snapshot: SystemMonitorSnapshot | null | undefined): string {
  if (!snapshot) return "CPU loading - RAM loading - Disk loading";
  const disk = snapshot.disk ? monitorPercentLabel(snapshot.disk.usedPct) : "n/a";
  return `CPU ${monitorPercentLabel(snapshot.cpu.usagePct)} - RAM ${monitorPercentLabel(snapshot.memory.usedPct)} - Disk ${disk}`;
}

function monitorPlatformLabel(snapshot: SystemMonitorSnapshot | null | undefined): string {
  if (!snapshot) return "Telemetry unavailable";
  return `${snapshot.platform.type} ${snapshot.platform.arch} - ${snapshot.cpu.cores} cores`;
}

function agentProviderId(agent: AgentSummary | null | undefined): string {
  return agent?.provider_id || agent?.provider || "";
}

function agentIsRunning(agent: AgentSummary | null | undefined): boolean {
  return agent?.status === "running" || agent?.status === "active";
}

function remoteItemEnabled(item: RemoteItemSummary | ActivitySummary): boolean {
  if ("enabled" in item && typeof item.enabled === "boolean") return item.enabled;
  if (!("status" in item) || !item.status) return true;
  return !["disabled", "paused", "stopped", "inactive"].includes(item.status.toLowerCase());
}

function remoteTaskRunning(item: RemoteItemSummary | ActivitySummary): boolean {
  if (!("status" in item) || !item.status) return false;
  return ["running", "pending", "active", "enabled"].includes(item.status.toLowerCase());
}

function resolveAccentKey(summary: FeatureSummary | null): AccentKey {
  return readMobileAccent(summary?.config) as AccentKey;
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
          {detailRoute || activeTab === "settings" ? (
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              style={styles.backButton}
              onPress={detailRoute ? closeDetailRoute : () => selectTab("overview")}
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
        ) : !detailRoute && activeTab !== "settings" ? (
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            style={styles.iconButton}
            onPress={() => selectTab("settings")}
          >
            <Settings color={colors.text} size={22} strokeWidth={2.1} />
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
            />
          ) : null}
        </ScrollView>
      )}

      <LiquidGlass
        intensity={64}
        contentStyle={styles.tabBarPanel}
        style={[
          styles.tabBar,
          { bottom: insets.bottom + MOBILE_NAV_CHROME.floatingMargin },
        ]}
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
  const providerRows =
    insights?.providerEfficiency.slice(0, 6).map((provider) => ({
      label: provider.provider,
      value: `${formatMetricNumber(provider.tokensPerCall)} tok/call`,
      detail: `${formatMetricNumber(provider.calls)} calls - ${provider.sharePct}% share`,
      amount: provider.tokens,
    })) ??
    metrics?.providers?.providers.slice(0, 6).map((provider) => ({
      label: provider.provider,
      value: formatMetricNumber(provider.tokens),
      detail: `${formatMetricNumber(provider.hits)} hits`,
      amount: provider.tokens,
    })) ??
    [];
  const modelRows =
    insights?.modelInsights.slice(0, 6).map((model) => ({
      label: model.model,
      value: `${formatMetricNumber(model.totalTokens)} tokens`,
      detail: `${model.provider} - ${model.avgTps} tok/s - ${model.avgLatencyMs}ms`,
      amount: model.totalTokens,
    })) ??
    metrics?.models?.models.slice(0, 6).map((model) => ({
      label: model.model,
      value: `${formatMetricNumber(model.totalTokens)} tokens`,
      detail: `${model.provider} - ${model.avgTps} tok/s`,
      amount: model.totalTokens,
    })) ??
    [];
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
  const navFootprint =
    insets.bottom + MOBILE_NAV_CHROME.floatingMargin + MOBILE_NAV_CHROME.height;
  const [detail, setDetail] = useState<SessionDetailSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const draftRef = useRef("");
  const [sending, setSending] = useState(false);
  const [pinned, setPinned] = useState(sessionSummary?.pinned ?? false);
  const [pinning, setPinning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const headerActionRef = useRef<() => void>(() => {});
  const sessionRefreshInFlight = useRef(false);

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

  useEffect(() => {
    if (typeof sessionSummary?.pinned === "boolean") {
      setPinned(sessionSummary.pinned);
    }
  }, [sessionId, sessionSummary?.pinned]);

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
    const interval = setInterval(
      () => {
        void loadSession(false);
      },
      sending ? 1800 : 3500
    );
    return () => clearInterval(interval);
  }, [api, sessionId, sending]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [detail?.messages.length, sending]);

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
    if (!message || sending) return;
    resetComposerDraft();
    setSending(true);
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
      await api.sendChat({
        message,
        sessionId,
        agentId: detail?.agentId,
        workspaceDir: detail?.workspaceDir,
      });
      await loadSession(false);
    } catch (error) {
      setComposerDraft(message);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
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
    const providerName = mobileFirstNonEmptyString(detail?.providerName, sessionSummary?.provider_name);
    const workspaceDir = mobileFirstNonEmptyString(detail?.workspaceDir, sessionSummary?.workspace_dir);
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

  const visibleMessages = useMemo(
    () => latestVisibleChatMessages(detail?.messages ?? []),
    [detail?.messages]
  );
  const waitingForAssistant = chatIsWaitingForAssistant(detail?.messages ?? [], sending);

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
          { paddingBottom: navFootprint + MOBILE_CHAT_COMPOSER.maxHeight + spacing.md },
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
              />
            ))}
            {waitingForAssistant ? (
              <View style={styles.typingRow}>
                <ActivityIndicator color={accentColor} size="small" />
                <Text style={styles.listDetail}>Waiting for assistant response</Text>
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
        <View style={styles.composer}>
          <TextInput
            blurOnSubmit={false}
            editable={!sending}
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
            disabled={!draft.trim() || sending}
            onPress={sendMessage}
            style={[
              styles.sendButton,
              {
                backgroundColor: draft.trim() ? accentColor : colors.inset,
                opacity: draft.trim() || sending ? 1 : 0.55,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Send color={colors.text} size={19} strokeWidth={2.4} />
            )}
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

function ChatMessageRow({
  accentColor,
  message,
}: {
  accentColor: string;
  message: SessionDetailSummary["messages"][number];
}) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.chatMessageRow, isUser && styles.chatMessageRowUser]}>
      <View
        style={[
          styles.chatAvatar,
          { backgroundColor: isUser ? `${accentColor}22` : `${colors.green}18` },
        ]}
      >
        {isUser ? (
          <User color={accentColor} size={16} strokeWidth={2.2} />
        ) : (
          <Bot color={colors.green} size={16} strokeWidth={2.2} />
        )}
      </View>
      <View
        style={[
          styles.messageBubble,
          !isUser && styles.assistantMessageBubble,
          isUser ? [styles.userMessageBubble, { borderColor: `${accentColor}55` }] : null,
        ]}
      >
        {!isUser &&
        (message.thinking || message.processActivities?.length || message.toolCalls?.length) ? (
          <WorkTimeline message={message} />
        ) : null}
        <MessageContent content={message.content || "(empty message)"} />
        {message.timestamp ? (
          <Text style={[styles.messageTime, isUser && styles.messageTimeUser]}>
            {relativeTimestamp(message.timestamp)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function WorkActivityIcon({ phase, toolName }: { phase: string; toolName?: string }) {
  if (toolName === "__thought") {
    return <Sparkles color={colors.blueText} size={13} strokeWidth={2.2} />;
  }
  if (phase === "start") {
    return <Loader2 color={colors.amber} size={13} strokeWidth={2.2} />;
  }
  if (phase === "error") {
    return <AlertTriangle color={colors.red} size={13} strokeWidth={2.2} />;
  }
  return <CheckCircle2 color={colors.green} size={13} strokeWidth={2.2} />;
}

function WorkTimeline({ message }: { message: SessionDetailSummary["messages"][number] }) {
  const timeline = buildMobileWorkTimeline(message);
  if (timeline.activities.length === 0) return null;

  return (
    <View style={styles.workTimeline}>
      <Text style={styles.workedForText}>Worked for {timeline.workedDuration}</Text>
      <View style={styles.messageActivityList}>
        {timeline.activities.map((activity) => (
          <View key={activity.id} style={styles.messageActivityRow}>
            <View style={styles.messageActivityIcon}>
              <WorkActivityIcon phase={activity.phase} toolName={activity.toolName} />
            </View>
            <Text
              numberOfLines={activity.toolName === "__thought" ? 3 : 2}
              style={[
                styles.messageActivityText,
                activity.toolName === "__thought" && styles.messageThoughtText,
              ]}
            >
              {activity.text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MessageContent({ content }: { content: string }) {
  return (
    <View style={styles.messageContent}>
      {splitMessageContent(content).map((part, index) =>
        part.type === "code" ? (
          <View key={`code-${index}`} style={styles.codeBlock}>
            <Text style={styles.codeHeader}>{part.language}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <UnicodeText
                content={part.content}
                selectable={shouldUseSelectableNativeText(part.content)}
                style={[
                  styles.codeText,
                  !hasUnicodeTextFallback(part.content) && styles.codeTextMonospace,
                ]}
              />
            </ScrollView>
          </View>
        ) : (
          <UnicodeText
            key={`text-${index}`}
            content={part.content.trim().length > 0 ? part.content : "\n"}
            selectable={shouldUseSelectableNativeText(part.content)}
            style={styles.messageText}
          />
        )
      )}
    </View>
  );
}

function UnicodeText({
  content,
  numberOfLines,
  selectable,
  style,
}: {
  content: string;
  numberOfLines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={style}>
      {content}
    </Text>
  );
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
              style={[styles.listIcon, styles.tasksEmptyIcon, { backgroundColor: `${accentColor}18` }]}
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
      const result = await api.updateConfig({ workspace_indexer: { embeddingProvider: value } });
      if (result.success === false) {
        throw new Error("Config update failed");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert("Memory method setting failed", error instanceof Error ? error.message : String(error));
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
            { label: "Voyage", value: "voyage" },
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
              {loadingMoreLogs ? <ActivityIndicator color={colors.blueText} size="small" /> : null}
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

function SettingsTextField({
  autoCapitalize = "none",
  help,
  label,
  multiline,
  onBlur,
  onChangeText,
  onSubmitEditing,
  placeholder,
  returnKeyType,
  secureTextEntry,
  value,
}: {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  help?: string;
  label: string;
  multiline?: boolean;
  onBlur?: () => void;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  returnKeyType?: "done" | "next" | "go" | "send";
  secureTextEntry?: boolean;
  value: string;
}) {
  return (
    <View style={styles.settingsField}>
      <Text style={styles.settingsFieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        onBlur={onBlur}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        style={[styles.settingsInput, multiline && styles.settingsTextArea]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value}
      />
      {help ? <Text style={styles.settingsFieldHelp}>{help}</Text> : null}
    </View>
  );
}

function SettingSelector({
  disabled,
  label,
  options,
  selected,
  tone = colors.cyan,
  variant = "chips",
  onSelect,
}: {
  disabled?: boolean;
  label: string;
  options: Array<{ label: string; value: string }>;
  selected: string;
  tone?: string;
  variant?: "chips" | "segmented" | "menu";
  onSelect: (value: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (options.length === 0) return null;
  const segmented = variant === "segmented";

  if (variant === "menu") {
    const current = options.find((option) => option.value === selected);
    const openMenu = () => {
      if (disabled) return;
      haptics.select();
      if (Platform.OS === "ios") {
        const labels = options.map((option) => option.label);
        ActionSheetIOS.showActionSheetWithOptions(
          { title: label, options: [...labels, "Cancel"], cancelButtonIndex: labels.length },
          (index) => {
            const option = options[index];
            if (option) onSelect(option.value);
          }
        );
      } else {
        setMenuOpen(true);
      }
    };
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current?.label ?? "Select"}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={openMenu}
          style={[styles.settingsMenuRow, disabled && styles.settingsActionButtonDisabled]}
        >
          <Text style={styles.settingsMenuLabel}>{label}</Text>
          <View style={styles.settingsMenuValueWrap}>
            <Text numberOfLines={1} style={styles.settingsMenuValue}>
              {current?.label ?? "Select"}
            </Text>
            <ChevronDown color={colors.textDim} size={16} strokeWidth={2.2} />
          </View>
        </Pressable>
        {Platform.OS !== "ios" ? (
          <Modal
            transparent
            visible={menuOpen}
            animationType="fade"
            onRequestClose={() => setMenuOpen(false)}
          >
            <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
              <View style={styles.menuSheet}>
                <Text style={styles.menuSheetTitle}>{label}</Text>
                {options.map((option) => {
                  const isSelected = option.value === selected;
                  return (
                    <Pressable
                      key={option.value}
                      style={styles.menuSheetRow}
                      onPress={() => {
                        haptics.select();
                        onSelect(option.value);
                        setMenuOpen(false);
                      }}
                    >
                      <Text
                        style={[styles.menuSheetRowText, isSelected && { color: tone, fontWeight: "700" }]}
                      >
                        {option.label}
                      </Text>
                      {isSelected ? <Check color={tone} size={18} strokeWidth={2.4} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          </Modal>
        ) : null}
      </>
    );
  }

  if (segmented) {
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selected)
    );
    return (
      <View style={[styles.settingsField, styles.settingsSegmentField]}>
        <Text style={styles.settingsFieldLabel}>{label}</Text>
        <SegmentedControl
          appearance="dark"
          enabled={!disabled}
          values={options.map((option) => option.label)}
          selectedIndex={selectedIndex}
          onChange={(event) => {
            const index = event.nativeEvent.selectedSegmentIndex;
            const option = options[index];
            if (!option) return;
            haptics.select();
            onSelect(option.value);
          }}
          tintColor={tone}
          backgroundColor={colors.inset}
          fontStyle={{ color: colors.textMuted }}
          activeFontStyle={{ color: colors.background, fontWeight: "600" }}
        />
      </View>
    );
  }

  return (
    <View style={styles.settingsField}>
      <Text style={styles.settingsFieldLabel}>{label}</Text>
      <View style={styles.settingsChipRow}>
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ disabled, selected: isSelected }}
              disabled={disabled}
              key={option.value}
              onPress={() => {
                haptics.select();
                onSelect(option.value);
              }}
              style={[
                styles.settingsChip,
                isSelected && [
                  styles.settingsChipActive,
                  { backgroundColor: `${tone}16`, borderColor: `${tone}88` },
                ],
                disabled && styles.settingsActionButtonDisabled,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.settingsChipText,
                  isSelected && styles.settingsChipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// iOS-style grouped info section: an uppercase header over an inset card of
// key-value rows (label left, value right, hairline dividers) — the standard
// Settings layout, replacing flat stacked "label above value" dumps.
function DetailInfoSection({
  title,
  fields,
}: {
  title?: string;
  fields: Array<{ label: string; value: string }>;
}) {
  if (fields.length === 0) return null;
  return (
    <View style={styles.infoSection}>
      {title ? <Text style={styles.infoSectionTitle}>{title}</Text> : null}
      <View style={styles.infoCard}>
        {fields.map((field, index) => (
          <View
            key={`${field.label}-${index}`}
            style={[styles.infoRow, index > 0 && styles.infoRowDivider]}
          >
            <Text style={styles.infoLabel}>{field.label}</Text>
            <Text selectable style={styles.infoValue}>
              {field.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DetailActionButton({
  Icon,
  busy,
  disabled,
  label,
  onPress,
  tone = colors.cyan,
}: {
  Icon: IconGlyph;
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.settingsActionButton,
        { borderColor: `${tone}55`, backgroundColor: `${tone}12` },
        (disabled || busy) && styles.settingsActionButtonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone} size="small" />
      ) : (
        <Icon color={tone} size={17} strokeWidth={2.3} />
      )}
      <Text style={[styles.settingsActionText, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

function SettingToggle({
  busy,
  detail,
  disabled,
  label,
  onPress,
  tone = colors.cyan,
  value,
}: {
  busy?: boolean;
  detail?: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: string;
  value: boolean;
}) {
  const inactive = disabled || busy;
  const handleToggle = () => {
    haptics.light();
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: inactive }}
      disabled={inactive}
      onPress={handleToggle}
      style={[styles.settingToggleRow, inactive && styles.settingToggleRowDisabled]}
    >
      <View style={styles.toggleTextWrap}>
        <Text style={styles.toggleTitle}>{label}</Text>
        {detail ? <Text style={styles.toggleDetail}>{detail}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={value ? tone : colors.textMuted} size="small" />
      ) : (
        <View pointerEvents="none" style={styles.nativeSwitchWrap}>
          <Switch
            disabled={inactive}
            ios_backgroundColor="rgba(120, 132, 143, 0.28)"
            onValueChange={handleToggle}
            thumbColor={Platform.OS === "android" ? colors.text : undefined}
            trackColor={{
              false: "rgba(120, 132, 143, 0.28)",
              true: `${tone}92`,
            }}
            value={value}
          />
        </View>
      )}
    </Pressable>
  );
}

function SettingsSection({
  accessory,
  children,
  title,
}: {
  accessory?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <View style={styles.settingsSection}>
      {title ? (
        <View style={styles.settingsSectionHeader}>
          <Text style={styles.settingsSectionTitle}>{title}</Text>
          {accessory}
        </View>
      ) : null}
      <View style={styles.settingsGroup}>{children}</View>
    </View>
  );
}

function AgentSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const summaryAgent = summary?.agents.find((agent) => agent.id === item.id);
  const itemType = "type" in item ? item.type : undefined;
  const itemStatus = "status" in item ? item.status : undefined;
  const agent: AgentSummary = summaryAgent ?? {
    id: item.id,
    name: item.title,
    model: itemType,
    status: itemStatus,
  };
  const [name, setName] = useState(agent.name);
  const [type, setType] = useState(agent.type || "main");
  const [providerId, setProviderId] = useState(agentProviderId(agent));
  const [model, setModel] = useState(agent.model || "");
  const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt || "");
  const [saving, setSaving] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const providerOptions = summary?.providers ?? [];
  const running = agentIsRunning(agent);

  useEffect(() => {
    setName(agent.name);
    setType(agent.type || "main");
    setProviderId(agentProviderId(agent));
    setModel(agent.model || "");
    setSystemPrompt(agent.system_prompt || "");
  }, [
    agent.id,
    agent.model,
    agent.name,
    agent.provider,
    agent.provider_id,
    agent.system_prompt,
    agent.type,
  ]);

  const saveAgent = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the agent a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      await api.updateAgent(agent.id, {
        name: trimmedName,
        type,
        provider_id: providerId || undefined,
        model: model.trim() || undefined,
        system_prompt: systemPrompt,
      });
      await refreshSummary();
      Alert.alert("Agent saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Agent save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const toggleAgentRuntime = async () => {
    setRunningAction(true);
    try {
      const result = running ? await api.stopAgent(agent.id) : await api.startAgent(agent.id);
      await refreshSummary();
      if (result.success === false) {
        throw new Error(
          running ? "The gateway did not stop this agent." : "The gateway did not start this agent."
        );
      }
    } catch (error) {
      Alert.alert("Agent action failed", error instanceof Error ? error.message : String(error));
    } finally {
      setRunningAction(false);
    }
  };

  const deleteAgent = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteAgent(agent.id);
      if (result.success === false) throw new Error("The gateway did not delete this agent.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete agent?", `${agent.name} will be removed from this gateway.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteAgent();
        },
      },
    ]);
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.cyan}18` }]}>
          <Bot color={colors.cyan} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {agent.name}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {[agent.status || "stopped", agent.model || "model not set"].join(" - ")}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingsTextField
          autoCapitalize="words"
          label="Display name"
          onChangeText={setName}
          placeholder="Agent name"
          value={name}
        />
        <SettingSelector
          label="Type"
          variant="menu"
          options={agentTypeOptions.map((value) => ({ label: displayFieldLabel(value), value }))}
          selected={type}
          onSelect={setType}
        />
        <SettingSelector
          label="Provider"
          variant="menu"
          options={providerOptions.map((provider) => ({
            label: provider.name,
            value: provider.id,
          }))}
          selected={providerId}
          onSelect={setProviderId}
        />
        <SettingsTextField
          label="Model"
          onChangeText={setModel}
          placeholder="Model name"
          value={model}
        />
        <SettingsTextField
          help="Used as this agent's operating instructions."
          label="System prompt"
          multiline
          onChangeText={setSystemPrompt}
          placeholder="You are a helpful AI assistant..."
          value={systemPrompt}
        />
      </View>

      <View style={styles.settingsActionRow}>
        <DetailActionButton Icon={Save} busy={saving} label="Save" onPress={saveAgent} />
        <DetailActionButton
          Icon={running ? Square : Play}
          busy={runningAction}
          label={running ? "Stop" : "Start"}
          onPress={toggleAgentRuntime}
          tone={running ? colors.amber : colors.green}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </GlassPanel>
  );
}

function ProviderSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const summaryProvider = summary?.providers.find((provider) => provider.id === item.id);
  const itemType = "type" in item ? item.type : undefined;
  const provider: ProviderSummary = summaryProvider ?? {
    id: item.id,
    name: item.title,
    provider: itemType || item.detail || "provider",
  };
  const [name, setName] = useState(provider.name);
  const [baseUrl, setBaseUrl] = useState(provider.base_url || "");
  const [apiKey, setApiKey] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [isDefault, setIsDefault] = useState(Boolean(provider.is_default));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthStatus, setOauthStatus] = useState("");
  const [oauthDeviceCode, setOauthDeviceCode] = useState("");
  const authType = provider.authType || "api_key";
  const usesApiKey = authType === "api_key";
  const usesOAuth = authType === "oauth";
  const usesAccessToken = authType === "bearer" || authType === "token";
  const usesAwsSdk = authType === "aws-sdk";
  const usesNoAuth = authType === "none";

  useEffect(() => {
    setName(provider.name);
    setBaseUrl(provider.base_url || "");
    setApiKey("");
    setAccessToken("");
    setIsDefault(Boolean(provider.is_default));
    setOauthBusy(false);
    setOauthStatus("");
    setOauthDeviceCode("");
  }, [provider.base_url, provider.id, provider.is_default, provider.name]);

  const saveProvider = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the provider a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateProvider(provider.id, {
        name: trimmedName,
        base_url: baseUrl.trim() || undefined,
        api_key: usesApiKey ? apiKey.trim() || undefined : undefined,
        access_token: usesOAuth || usesAccessToken ? accessToken.trim() || undefined : undefined,
        is_default: isDefault,
      });
      if (result.success === false) throw new Error("The gateway did not save this provider.");
      setApiKey("");
      setAccessToken("");
      await refreshSummary();
      Alert.alert("Provider saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Provider save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const openGatewayOrLocalUrl = async (url: string) => {
    try {
      await api.openUrlOnGateway(url);
      return;
    } catch {
      await Linking.openURL(url);
    }
  };

  const pollOAuthCallback = async (state: string) => {
    const expiresAt = Date.now() + 600_000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const status = await api.providerOAuthCallbackStatus(state);
      if (status.status === "success" && status.access_token) {
        setAccessToken(status.access_token);
        setOauthStatus("Connected. Save this provider to store the token.");
        return;
      }
      if (status.status === "error") {
        throw new Error(status.error || "Authorization failed.");
      }
    }
    throw new Error("Authorization timed out. Please try again.");
  };

  const pollOAuthDeviceCode = async (deviceCode: string, intervalSeconds: number, expiresIn: number) => {
    const intervalMs = Math.max(5, intervalSeconds || 5) * 1000;
    const expiresAt = Date.now() + Math.max(60, expiresIn || 900) * 1000;
    while (Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const status = await api.pollProviderDeviceCodeOAuth(provider.provider, deviceCode);
      if (status.status === "success" && status.access_token) {
        setAccessToken(status.access_token);
        setOauthStatus("Connected. Save this provider to store the token.");
        return;
      }
      if (status.status === "expired" || status.status === "denied" || status.status === "error") {
        throw new Error(
          status.error ||
            (status.status === "denied"
              ? "Authorization was denied."
              : "Authorization expired. Please try again.")
        );
      }
    }
    throw new Error("Authorization timed out. Please try again.");
  };

  const startOAuth = async () => {
    if (!provider.hasOAuthConfig) {
      if (provider.oauthLoginUrl) {
        await Linking.openURL(provider.oauthLoginUrl);
      }
      return;
    }
    setOauthBusy(true);
    setOauthStatus("Starting sign-in...");
    setOauthDeviceCode("");
    try {
      if (provider.oauthFlow === "device_code") {
        const response = await api.startProviderDeviceCodeOAuth(provider.provider);
        setOauthDeviceCode(response.user_code);
        setOauthStatus("Enter the code in the browser window, then keep this screen open.");
        await openGatewayOrLocalUrl(response.verification_uri);
        await pollOAuthDeviceCode(response.device_code, response.interval, response.expires_in);
      } else {
        const response = await api.startProviderOAuth(provider.provider);
        setOauthStatus("Complete sign-in in the browser window, then keep this screen open.");
        await openGatewayOrLocalUrl(response.auth_url);
        await pollOAuthCallback(response.state);
      }
    } catch (error) {
      Alert.alert("OAuth failed", error instanceof Error ? error.message : String(error));
      setOauthStatus("Sign-in failed. Try again.");
    } finally {
      setOauthBusy(false);
    }
  };

  const testProvider = async () => {
    setTesting(true);
    try {
      const result = await api.testProvider(provider.id);
      Alert.alert(
        result.success ? "Provider connected" : "Provider test failed",
        result.message ||
          result.error ||
          (result.success ? "Connection verified." : "Connection failed.")
      );
    } catch (error) {
      Alert.alert("Provider test failed", error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const deleteProvider = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteProvider(provider.id);
      if (result.success === false) throw new Error("The gateway did not delete this provider.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete provider?",
      `${provider.name} will be removed. Agents using this provider may stop working.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteProvider();
          },
        },
      ]
    );
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.blueText}18` }]}>
          <Database color={colors.blueText} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {provider.name}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {`${provider.provider}${provider.is_default ? " - default" : ""}`}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingsTextField
          autoCapitalize="words"
          label="Display name"
          onChangeText={setName}
          placeholder="Provider name"
          value={name}
        />
        <SettingsTextField
          help="Only change this for local or self-hosted model providers."
          label="Base URL"
          onChangeText={setBaseUrl}
          placeholder="Provider default"
          value={baseUrl}
        />
        {usesApiKey ? (
          <SettingsTextField
            help={
              MOBILE_SETTINGS_DETAIL_CHROME.providerCredentialUpdateMode === "blank-keeps-existing"
                ? "Leave blank to keep the saved API key."
                : undefined
            }
            label="API key"
            onChangeText={setApiKey}
            placeholder={provider.hasCredentials ? "Saved credential" : "Paste API key"}
            secureTextEntry
            value={apiKey}
          />
        ) : null}
        {usesOAuth ? (
          <View style={styles.settingsInfoBox}>
            <Text style={styles.settingsInfoTitle}>OAuth provider</Text>
            <Text style={styles.settingsInfoText}>
              {provider.hasOAuthConfig
                ? "Sign in through the gateway. No API key is required."
                : "Paste an access token for this OAuth provider."}
            </Text>
            {provider.hasOAuthConfig || provider.oauthLoginUrl ? (
              <DetailActionButton
                Icon={Link2}
                busy={oauthBusy}
                label={provider.hasOAuthConfig ? "Sign in" : "Open provider"}
                onPress={startOAuth}
                tone={colors.blueText}
              />
            ) : null}
            {oauthDeviceCode ? (
              <Text selectable style={styles.settingsInfoCode}>
                {oauthDeviceCode}
              </Text>
            ) : null}
            {oauthStatus ? <Text style={styles.settingsInfoText}>{oauthStatus}</Text> : null}
            {!provider.hasOAuthConfig ? (
              <SettingsTextField
                help="Leave blank to keep the saved access token."
                label="Access token"
                onChangeText={setAccessToken}
                placeholder={provider.hasCredentials ? "Saved credential" : "Paste access token"}
                secureTextEntry
                value={accessToken}
              />
            ) : null}
          </View>
        ) : null}
        {usesAccessToken ? (
          <SettingsTextField
            help="Leave blank to keep the saved token."
            label="Access token"
            onChangeText={setAccessToken}
            placeholder={provider.hasCredentials ? "Saved credential" : "Paste access token"}
            secureTextEntry
            value={accessToken}
          />
        ) : null}
        {usesAwsSdk || usesNoAuth ? (
          <View style={styles.settingsInfoBox}>
            <Text style={styles.settingsInfoTitle}>
              {usesAwsSdk ? "AWS SDK authentication" : "No authentication required"}
            </Text>
            <Text style={styles.settingsInfoText}>
              {usesAwsSdk
                ? "Use AWS environment variables, CLI profiles, or instance credentials on the gateway."
                : "This provider connects without saved credentials."}
            </Text>
          </View>
        ) : null}
        <SettingToggle
          detail="New chats use this provider when no agent-specific provider is selected."
          label="Default provider"
          onPress={() => setIsDefault((value) => !value)}
          value={isDefault}
        />
      </View>

      <View style={styles.settingsActionRow}>
        <DetailActionButton Icon={Save} busy={saving} label="Save" onPress={saveProvider} />
        <DetailActionButton
          Icon={Zap}
          busy={testing}
          label="Test"
          onPress={testProvider}
          tone={colors.green}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </GlassPanel>
  );
}

function ChannelSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
}) {
  const [name, setName] = useState(item.title);
  const [enabled, setEnabled] = useState(remoteItemEnabled(item));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(item.title);
    setEnabled(remoteItemEnabled(item));
  }, [item]);

  const saveChannel = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the channel a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateChannel(item.id, {
        name: trimmedName,
        enabled,
      });
      if (result.success === false) throw new Error("The gateway did not save this channel.");
      await refreshSummary();
      Alert.alert("Channel saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Channel save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const testChannel = async () => {
    setTesting(true);
    try {
      const result = await api.testChannel(item.id);
      Alert.alert(
        result.success ? "Channel connected" : "Channel test failed",
        result.message ||
          result.error ||
          (result.success ? "Connection verified." : "Connection failed.")
      );
    } catch (error) {
      Alert.alert("Channel test failed", error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const deleteChannel = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteChannel(item.id);
      if (result.success === false) throw new Error("The gateway did not delete this channel.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete channel?", `${item.title} will no longer receive remote messages.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteChannel();
        },
      },
    ]);
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.cyan}18` }]}>
          <Link2 color={colors.cyan} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {item.detail}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingsTextField
          autoCapitalize="words"
          label="Display name"
          onChangeText={setName}
          placeholder="Channel name"
          value={name}
        />
        <SettingToggle
          detail="Disabled channels stay configured but stop handling messages."
          label="Enabled"
          onPress={() => setEnabled((value) => !value)}
          value={enabled}
        />
      </View>

      <View style={styles.settingsActionRow}>
        <DetailActionButton Icon={Save} busy={saving} label="Save" onPress={saveChannel} />
        <DetailActionButton
          Icon={Zap}
          busy={testing}
          label="Test"
          onPress={testChannel}
          tone={colors.green}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </GlassPanel>
  );
}

function TaskSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const running = remoteTaskRunning(item);

  const toggleTask = async () => {
    setToggling(true);
    try {
      const result = running ? await api.stopTask(item.id) : await api.startTask(item.id);
      if (result.success === false) {
        throw new Error(
          running ? "The gateway did not stop this task." : "The gateway did not start this task."
        );
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert("Task action failed", error instanceof Error ? error.message : String(error));
    } finally {
      setToggling(false);
    }
  };

  const runTask = async () => {
    setRunningNow(true);
    try {
      const result = await api.runTask(item.id);
      if (result.success === false) throw new Error("The gateway did not run this task.");
      await refreshSummary();
      Alert.alert("Task started", `${item.title} was triggered.`);
    } catch (error) {
      Alert.alert("Task run failed", error instanceof Error ? error.message : String(error));
    } finally {
      setRunningNow(false);
    }
  };

  const deleteTask = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteTask(item.id);
      if (result.success === false) throw new Error("The gateway did not delete this task.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete task?", `${item.title} will be removed from the scheduler.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteTask();
        },
      },
    ]);
  };

  const fields = [
    ...("status" in item && item.status ? [{ label: "Status", value: item.status }] : []),
    ...("type" in item && item.type ? [{ label: "Type", value: item.type }] : []),
    ...cleanSettingsFields(item.fields),
  ];

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.blueText}18` }]}>
          <CalendarCheck color={colors.blueText} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {item.detail}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingToggle
          busy={toggling}
          detail={
            running
              ? "The scheduler reports this task as running. Tap to stop it."
              : "The scheduler reports this task as stopped. Tap to start it."
          }
          label="Running"
          onPress={toggleTask}
          value={running}
        />
      </View>

      <DetailInfoSection title="Details" fields={fields} />

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={Zap}
          busy={runningNow}
          label="Run now"
          onPress={runTask}
          tone={colors.cyan}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </GlassPanel>
  );
}

function ApprovalSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
}) {
  const [decision, setDecision] = useState<ToolApprovalDecision | null>(null);
  const fields = cleanSettingsFields(item.fields);

  const resolveApproval = async (nextDecision: ToolApprovalDecision) => {
    setDecision(nextDecision);
    try {
      const result = await api.resolveToolApproval(item.id, nextDecision);
      if (result.success === false) {
        throw new Error(result.error || "The gateway did not resolve this approval.");
      }
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Approval failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDecision(null);
    }
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.amber}18` }]}>
          <ShieldCheck color={colors.amber} size={21} strokeWidth={2.2} />
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

      <DetailInfoSection title="Details" fields={fields} />

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={ShieldCheck}
          busy={decision === "approve_once"}
          label="Approve once"
          onPress={() => {
            void resolveApproval("approve_once");
          }}
          tone={colors.green}
        />
        <DetailActionButton
          Icon={ShieldCheck}
          busy={decision === "approve_session"}
          label="Session"
          onPress={() => {
            void resolveApproval("approve_session");
          }}
          tone={colors.cyan}
        />
        <DetailActionButton
          Icon={ShieldCheck}
          busy={decision === "approve_always"}
          label="Always"
          onPress={() => {
            void resolveApproval("approve_always");
          }}
          tone={colors.blueText}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={decision === "deny"}
          label="Deny"
          onPress={() => {
            void resolveApproval("deny");
          }}
          tone={colors.red}
        />
      </View>
    </GlassPanel>
  );
}

function WalletPolicyPanel({
  api,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const [savingPolicyKey, setSavingPolicyKey] = useState<WalletPolicyToggleKey | null>(null);
  const [savingAgentAccess, setSavingAgentAccess] = useState(false);
  const policy = objectRecord(summary?.walletPolicy);
  const status = objectRecord(summary?.walletStatus);
  const agentAccessEnabled = booleanSetting(status, "agentAccessEnabled");
  const policyAvailable = Boolean(policy);
  const statusAvailable = Boolean(status);

  const updateAgentAccess = async () => {
    if (!statusAvailable) return;
    const nextValue = !agentAccessEnabled;
    setSavingAgentAccess(true);
    try {
      const result = await api.setWalletAgentAccess(nextValue);
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

  const updatePolicyToggle = async (key: WalletPolicyToggleKey) => {
    if (!policyAvailable) return;
    const payload: WalletAgentPolicyUpdate = {};
    payload[key] = !booleanSetting(policy, key);
    setSavingPolicyKey(key);
    try {
      const result = await api.updateWalletAgentPolicy(payload);
      if (result.success === false) {
        throw new Error("The gateway did not update the wallet agent policy.");
      }
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Wallet policy update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSavingPolicyKey(null);
    }
  };

  const policyDetails = [
    { label: "ETH contract allowlist", value: arraySettingCount(policy, "allowedEthContracts") },
    { label: "Solana program allowlist", value: arraySettingCount(policy, "allowedSolPrograms") },
    { label: "Dapp host allowlist", value: arraySettingCount(policy, "allowedDappHosts") },
    { label: "x402 networks", value: arraySettingCount(policy, "allowedX402Networks") },
    {
      label: "Send recipient allowlist",
      value: arraySettingCount(policy, "allowedSendRecipients"),
    },
    {
      label: "Max send amount",
      value: formatMobileValue(policy?.maxSendAmount, "No cap"),
    },
    {
      label: "x402 max amount",
      value: formatMobileValue(policy?.x402MaxAmountAtomic, "Default"),
    },
  ];
  const statusFields = cleanSettingsFields(displayFields(status || {})).filter(
    (field) =>
      field.label !== "Agent Access Enabled" &&
      field.label !== "Primary Addresses" &&
      field.label !== "Kdf"
  );

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.green}18` }]}>
          <ShieldCheck color={colors.green} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.itemDetail}>
            {policyAvailable || statusAvailable
              ? "Agent wallet access and policy limits"
              : item.detail}
          </Text>
        </View>
      </View>

      <View style={styles.settingsForm}>
        <SettingToggle
          busy={savingAgentAccess}
          disabled={!statusAvailable || savingPolicyKey !== null}
          detail="Master switch for agent-initiated wallet actions."
          label="Agent wallet access"
          onPress={updateAgentAccess}
          value={agentAccessEnabled}
        />
        {walletPolicyToggleRows.map((toggle) => (
          <SettingToggle
            busy={savingPolicyKey === toggle.key}
            detail={toggle.detail}
            disabled={!policyAvailable || savingAgentAccess || savingPolicyKey !== null}
            key={toggle.key}
            label={toggle.label}
            onPress={() => {
              void updatePolicyToggle(toggle.key);
            }}
            value={booleanSetting(policy, toggle.key)}
          />
        ))}
      </View>

      <Text style={styles.subsectionTitle}>Policy limits</Text>
      {policyAvailable ? (
        <View>
          {policyDetails.map((field) => (
            <View key={field.label} style={styles.listRow}>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{field.label}</Text>
                <Text numberOfLines={1} style={styles.listDetail}>
                  {field.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          label="Wallet policy unavailable"
          detail={endpointErrorDetail(
            summary?.availability.walletPolicy,
            "The gateway did not return wallet policy settings."
          )}
        />
      )}

      <DetailInfoSection title="Wallet status" fields={statusFields} />
    </GlassPanel>
  );
}

function MonitorUsageBar({
  detail,
  label,
  tone,
  value,
}: {
  detail?: string;
  label: string;
  tone: string;
  value: number | null | undefined;
}) {
  const pct = monitorPercent(value);
  return (
    <View style={styles.monitorUsageRow}>
      <View style={styles.monitorUsageHeader}>
        <Text style={styles.listTitle}>{label}</Text>
        <Text style={[styles.counterText, { color: tone }]}>{monitorPercentLabel(value)}</Text>
      </View>
      <View style={styles.monitorUsageTrack}>
        <View style={[styles.monitorUsageFill, { backgroundColor: tone, width: `${pct}%` }]} />
      </View>
      {detail ? <Text style={styles.listDetail}>{detail}</Text> : null}
    </View>
  );
}

function SystemMonitorDetailPanel({
  item,
  refreshSummary,
  summary,
}: {
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const [refreshingMonitor, setRefreshingMonitor] = useState(false);
  const snapshot = summary?.systemMonitor ?? null;
  const disk = snapshot?.disk ?? null;
  const fields = (() => {
    if (!snapshot) return cleanSettingsFields(item.fields);
    if (item.id === "cpu") {
      return [
        { label: "Model", value: snapshot.cpu.model },
        { label: "Cores", value: String(snapshot.cpu.cores) },
        { label: "Load average", value: snapshot.cpu.loadAverage.join(", ") },
        { label: "Load", value: monitorPercentLabel(snapshot.cpu.loadPct) },
      ];
    }
    if (item.id === "memory") {
      const fields = [
        { label: "Total", value: formatMetricBytes(snapshot.memory.totalBytes) },
        { label: "Used", value: formatMetricBytes(snapshot.memory.usedBytes) },
        { label: "Free", value: formatMetricBytes(snapshot.memory.freeBytes) },
      ];
      if (snapshot.memory.swap) {
        fields.push({
          label: "Swap used",
          value: `${formatMetricBytes(snapshot.memory.swap.usedBytes)} of ${formatMetricBytes(snapshot.memory.swap.totalBytes)}`,
        });
      }
      return fields;
    }
    if (item.id === "swap" && snapshot.memory.swap) {
      return [
        { label: "Total", value: formatMetricBytes(snapshot.memory.swap.totalBytes) },
        { label: "Used", value: formatMetricBytes(snapshot.memory.swap.usedBytes) },
        { label: "Free", value: formatMetricBytes(snapshot.memory.swap.freeBytes) },
      ];
    }
    if (item.id === "process") {
      return [
        { label: "PID", value: String(snapshot.process.pid) },
        { label: "Uptime", value: formatUptime(snapshot.process.uptimeSeconds) },
        { label: "RSS", value: formatMetricBytes(snapshot.process.memory.rssBytes) },
        { label: "Heap used", value: formatMetricBytes(snapshot.process.memory.heapUsedBytes) },
        { label: "Heap total", value: formatMetricBytes(snapshot.process.memory.heapTotalBytes) },
        { label: "External", value: formatMetricBytes(snapshot.process.memory.externalBytes) },
      ];
    }
    if (item.id === "disk" && disk) {
      return [
        { label: "Path", value: disk.path },
        { label: "Total", value: formatStorageBytes(disk.totalBytes) },
        { label: "Used", value: formatStorageBytes(disk.usedBytes) },
        { label: "Free", value: formatStorageBytes(disk.freeBytes) },
      ];
    }
    return [
      { label: "Platform", value: snapshot.platform.type },
      { label: "Architecture", value: snapshot.platform.arch },
      { label: "Release", value: snapshot.platform.release },
      { label: "Snapshot", value: absoluteTimestampLabel(snapshot.timestamp) },
      { label: "Sample interval", value: `${snapshot.sampleIntervalMs}ms` },
    ];
  })();

  const refreshMonitor = async () => {
    setRefreshingMonitor(true);
    try {
      await refreshSummary();
    } finally {
      setRefreshingMonitor(false);
    }
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.blueText}18` }]}>
          <Cpu color={colors.blueText} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={2} style={styles.itemDetail}>
            {snapshot ? item.detail : "Waiting for system telemetry from the gateway"}
          </Text>
        </View>
      </View>

      {snapshot ? (
        <View style={styles.settingsForm}>
          {item.id === "cpu" ? (
            <>
              <MonitorUsageBar
                detail={`${snapshot.cpu.cores} cores - ${snapshot.cpu.model}`}
                label="CPU usage"
                tone={colors.blueText}
                value={snapshot.cpu.usagePct}
              />
              <MonitorUsageBar
                detail={
                  snapshot.platform.type === "win32"
                    ? "Load average unavailable on Windows"
                    : "1-minute normalized load"
                }
                label="CPU load"
                tone={colors.cyan}
                value={snapshot.cpu.loadPct}
              />
            </>
          ) : null}
          {item.id === "memory" ? (
            <MonitorUsageBar
              detail={`${formatMetricBytes(snapshot.memory.usedBytes)} of ${formatMetricBytes(snapshot.memory.totalBytes)} used`}
              label="Memory used"
              tone={colors.green}
              value={snapshot.memory.usedPct}
            />
          ) : null}
          {item.id === "swap" && snapshot.memory.swap ? (
            <MonitorUsageBar
              detail={`${formatMetricBytes(snapshot.memory.swap.usedBytes)} of ${formatMetricBytes(snapshot.memory.swap.totalBytes)} used`}
              label="Swap used"
              tone={colors.amber}
              value={snapshot.memory.swap.usedPct}
            />
          ) : null}
          {item.id === "process" ? (
            <>
              <MonitorUsageBar
                detail="Cybara gateway process CPU"
                label="Process CPU"
                tone={colors.amber}
                value={snapshot.process.cpuUsagePct}
              />
              <MonitorUsageBar
                detail={`${formatMetricBytes(snapshot.process.memory.heapUsedBytes)} of ${formatMetricBytes(snapshot.process.memory.heapTotalBytes)} heap used`}
                label="Heap used"
                tone={colors.cyan}
                value={
                  (snapshot.process.memory.heapUsedBytes /
                    Math.max(1, snapshot.process.memory.heapTotalBytes)) *
                  100
                }
              />
            </>
          ) : null}
          {item.id === "disk" && disk ? (
            <MonitorUsageBar
              detail={`${formatStorageBytes(disk.usedBytes)} of ${formatStorageBytes(disk.totalBytes)} used`}
              label="Disk used"
              tone={colors.blueText}
              value={disk.usedPct}
            />
          ) : null}
        </View>
      ) : (
        <EmptyState
          label="System telemetry unavailable"
          detail={endpointErrorDetail(
            summary?.availability.systemMonitor,
            "The gateway did not return host system telemetry."
          )}
        />
      )}

      <DetailInfoSection title="Details" fields={fields} />

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={RefreshCw}
          busy={refreshingMonitor}
          label="Refresh"
          onPress={() => {
            void refreshMonitor();
          }}
          tone={colors.blueText}
        />
      </View>
    </GlassPanel>
  );
}

function ModelRouterPanel({
  api,
  accentColor,
  summary,
}: {
  api: CybaraMobileApi;
  accentColor: string;
  summary: FeatureSummary | null;
}) {
  const [routerConfig, setRouterConfig] = useState<RouterConfig | null>(null);
  const [routerStatus, setRouterStatus] = useState<RouterStatus | null>(null);
  const [routerError, setRouterError] = useState<string | null>(null);
  const [routerDailyLimitDraft, setRouterDailyLimitDraft] = useState("");
  const [moaMaxAgentsDraft, setMoaMaxAgentsDraft] = useState("");
  const [savingRouterConfig, setSavingRouterConfig] = useState(false);

  const routerStrategy = readMobileRouterStrategy(routerConfig?.strategy);
  const routerRouteCount =
    routerStatus?.routes.length ?? Object.keys(routerConfig?.routes ?? {}).length;
  const routerAvailableCount = routerStatus?.routes.filter((route) => route.available).length;
  const routerSpendToday =
    typeof routerStatus?.globalSpendToday === "number" ? routerStatus.globalSpendToday : null;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [nextConfig, nextStatus] = await Promise.all([
          api.routerConfig(),
          api.routerStatus().catch(() => null),
        ]);
        if (!mounted) return;
        setRouterConfig(nextConfig);
        setRouterStatus(nextStatus);
        setRouterDailyLimitDraft(
          nextConfig.globalSpendLimitDaily && nextConfig.globalSpendLimitDaily > 0
            ? String(nextConfig.globalSpendLimitDaily)
            : ""
        );
        setMoaMaxAgentsDraft(nextConfig.moaMaxAgents ? String(nextConfig.moaMaxAgents) : "");
        setRouterError(null);
      } catch (error) {
        if (mounted) setRouterError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [api]);

  const saveRouterConfigPatch = async (patch: Partial<RouterConfig>) => {
    if (!routerConfig || savingRouterConfig) return;
    const previous = routerConfig;
    const next = { ...routerConfig, ...patch };
    setRouterConfig(next);
    setSavingRouterConfig(true);
    setRouterError(null);
    try {
      const result = await api.updateRouterConfig(next);
      if (result.success === false) throw new Error("Router config update failed");
      const nextStatus = await api.routerStatus().catch(() => null);
      setRouterStatus(nextStatus);
    } catch (error) {
      setRouterConfig(previous);
      setRouterError(error instanceof Error ? error.message : String(error));
      Alert.alert("Router update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRouterConfig(false);
    }
  };

  const saveRouterDailyLimit = () => {
    if (!routerConfig) return;
    const trimmed = routerDailyLimitDraft.trim();
    const numeric = trimmed.length > 0 ? Number(trimmed) : 0;
    const nextLimit = Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
    const currentLimit =
      routerConfig.globalSpendLimitDaily && routerConfig.globalSpendLimitDaily > 0
        ? routerConfig.globalSpendLimitDaily
        : undefined;
    if (nextLimit === currentLimit) return;
    void saveRouterConfigPatch({ globalSpendLimitDaily: nextLimit });
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${accentColor}18` }]}>
          <Network color={accentColor} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text style={styles.itemTitle}>Model Router</Text>
          <Text style={styles.itemDetail}>
            Route chats across providers with fallback and selection strategies
          </Text>
        </View>
      </View>

      {routerConfig ? (
        <>
          <View style={styles.settingsGroup}>
            <SettingToggle
              busy={savingRouterConfig}
              detail="Route chats across configured model providers with fallback rules."
              disabled={savingRouterConfig}
              label="Model router"
              onPress={() => {
                void saveRouterConfigPatch({ enabled: !routerConfig.enabled });
              }}
              tone={accentColor}
              value={routerConfig.enabled}
            />
            <SettingSelector
              disabled={savingRouterConfig}
              label="Selection strategy"
              variant="menu"
              onSelect={(value) => {
                void saveRouterConfigPatch({ strategy: readMobileRouterStrategy(value) });
              }}
              options={MOBILE_ROUTER_STRATEGY_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              selected={routerStrategy}
              tone={accentColor}
            />
            {routerStrategy === "mixture_of_agents" ? (
              <>
                <View style={styles.settingsSegmentField}>
                  <Text style={styles.settingsFieldLabel}>Max proposer agents</Text>
                  <TextInput
                    editable={!savingRouterConfig}
                    keyboardType="number-pad"
                    onBlur={() => {
                      const n = Math.floor(Number(moaMaxAgentsDraft.trim()));
                      const next = Number.isFinite(n) && n > 0 ? n : undefined;
                      if (next !== routerConfig.moaMaxAgents) {
                        void saveRouterConfigPatch({ moaMaxAgents: next });
                      }
                    }}
                    onChangeText={setMoaMaxAgentsDraft}
                    placeholder="4"
                    placeholderTextColor={colors.textDim}
                    returnKeyType="done"
                    style={styles.settingsInput}
                    value={moaMaxAgentsDraft}
                  />
                  <Text style={styles.settingsFieldHelp}>
                    How many agents propose before one synthesizes the answer.
                  </Text>
                </View>
                <SettingSelector
                  disabled={savingRouterConfig}
                  label="Aggregator agent"
                  variant="menu"
                  onSelect={(value) => {
                    void saveRouterConfigPatch({
                      moaAggregatorAgentId: value === "auto" ? undefined : value,
                    });
                  }}
                  options={[
                    { label: "Auto (first proposer)", value: "auto" },
                    ...(summary?.agents ?? []).map((agent) => ({
                      label: agent.name || agent.id,
                      value: agent.id,
                    })),
                  ]}
                  selected={routerConfig.moaAggregatorAgentId || "auto"}
                  tone={accentColor}
                />
              </>
            ) : null}
            <SettingToggle
              busy={savingRouterConfig}
              detail="Use any healthy provider when configured routes are unavailable."
              disabled={savingRouterConfig}
              label="Fallback providers"
              onPress={() => {
                void saveRouterConfigPatch({ fallbackToAny: !routerConfig.fallbackToAny });
              }}
              tone={accentColor}
              value={routerConfig.fallbackToAny}
            />
            <View style={styles.settingsSegmentField}>
              <Text style={styles.settingsFieldLabel}>Daily spend cap</Text>
              <TextInput
                editable={!savingRouterConfig}
                keyboardType="decimal-pad"
                onBlur={saveRouterDailyLimit}
                onChangeText={setRouterDailyLimitDraft}
                placeholder="No cap"
                placeholderTextColor={colors.textDim}
                returnKeyType="done"
                style={styles.settingsInput}
                value={routerDailyLimitDraft}
              />
              <Text style={styles.settingsFieldHelp}>USD per day. Leave blank for no cap.</Text>
            </View>
          </View>

          <DetailInfoSection
            title="Status"
            fields={[
              { label: "Providers in rotation", value: String(routerRouteCount) },
              {
                label: "Available now",
                value: routerAvailableCount === undefined ? "Unknown" : String(routerAvailableCount),
              },
              { label: "Strategy", value: routerStrategy.replace(/_/g, " ") },
              {
                label: "Spent today",
                value: routerSpendToday === null ? "Unknown" : `$${routerSpendToday.toFixed(4)}`,
              },
              {
                label: "Daily cap",
                value:
                  routerConfig.globalSpendLimitDaily && routerConfig.globalSpendLimitDaily > 0
                    ? `$${routerConfig.globalSpendLimitDaily}`
                    : "None",
              },
            ]}
          />
          {routerError ? <Text style={styles.errorText}>{routerError}</Text> : null}
        </>
      ) : (
        <EmptyState
          label="Router unavailable"
          detail={routerError || "The gateway did not return model router settings."}
        />
      )}
    </GlassPanel>
  );
}

function SystemPromptPanel({
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
  const [savingPromptKey, setSavingPromptKey] = useState<SystemPromptFeatureKey | null>(null);
  const [identityDraft, setIdentityDraft] = useState({ name: "", emoji: "", creature: "", vibe: "" });
  const [customPromptDraft, setCustomPromptDraft] = useState("");
  const [savingSystemPrompt, setSavingSystemPrompt] = useState(false);

  const available =
    summary?.availability.systemPrompt.ok === true && Boolean(summary.systemPrompt);
  const syncKey = summary?.systemPrompt
    ? `${JSON.stringify(summary.systemPrompt.identity)}|${summary.systemPrompt.customPrompt}`
    : "";

  useEffect(() => {
    const sp = summary?.systemPrompt;
    if (!sp) return;
    setIdentityDraft({
      name: sp.identity?.name || "",
      emoji: sp.identity?.emoji || "",
      creature: sp.identity?.creature || "",
      vibe: sp.identity?.vibe || "",
    });
    setCustomPromptDraft(sp.customPrompt || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const saveSystemPromptConfig = async () => {
    const sp = summary?.systemPrompt;
    if (!sp || savingSystemPrompt) return;
    const nextIdentity = { ...sp.identity, ...identityDraft };
    const identityChanged =
      nextIdentity.name !== (sp.identity?.name || "") ||
      nextIdentity.emoji !== (sp.identity?.emoji || "") ||
      nextIdentity.creature !== (sp.identity?.creature || "") ||
      nextIdentity.vibe !== (sp.identity?.vibe || "");
    const promptChanged = customPromptDraft !== (sp.customPrompt || "");
    if (!identityChanged && !promptChanged) return;
    setSavingSystemPrompt(true);
    try {
      const result = await api.updateSystemPrompt({
        ...sp,
        identity: nextIdentity,
        customPrompt: customPromptDraft,
      });
      if (result.success === false) throw new Error("System prompt update failed");
      await refreshSummary();
    } catch (error) {
      Alert.alert("Identity update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSystemPrompt(false);
    }
  };

  const toggleSystemPromptFeature = async (key: SystemPromptFeatureKey) => {
    if (!summary?.systemPrompt || savingPromptKey) return;
    setSavingPromptKey(key);
    try {
      const nextFeatures = {
        ...summary.systemPrompt.features,
        [key]: summary.systemPrompt.features[key] !== true,
      };
      const result = await api.updateSystemPrompt({ ...summary.systemPrompt, features: nextFeatures });
      if (result.success === false) throw new Error("System prompt update failed");
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Prompt feature update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSavingPromptKey(null);
    }
  };

  return (
    <GlassPanel elevated style={[styles.detailPanel, styles.mainTabPanel]}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${accentColor}18` }]}>
          <Sparkles color={accentColor} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text style={styles.itemTitle}>System Prompt</Text>
          <Text style={styles.itemDetail}>Identity and instructions applied to every agent</Text>
        </View>
      </View>

      {available && summary?.systemPrompt ? (
        <>
          <Text style={styles.subsectionTitle}>Identity</Text>
          <View style={styles.settingsGroup}>
            <SettingsTextField
              autoCapitalize="words"
              help="Shown as “You are …” in the system prompt. Leave blank to default to Cybara."
              label="Name"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(name) => setIdentityDraft((prev) => ({ ...prev, name }))}
              onSubmitEditing={() => void saveSystemPromptConfig()}
              placeholder="Cybara"
              returnKeyType="done"
              value={identityDraft.name}
            />
            <SettingsTextField
              autoCapitalize="none"
              label="Emoji"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(emoji) => setIdentityDraft((prev) => ({ ...prev, emoji }))}
              placeholder="🐹"
              value={identityDraft.emoji}
            />
            <SettingsTextField
              autoCapitalize="none"
              label="Creature / role"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(creature) => setIdentityDraft((prev) => ({ ...prev, creature }))}
              placeholder="AI assistant"
              value={identityDraft.creature}
            />
            <SettingsTextField
              autoCapitalize="sentences"
              label="Vibe"
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={(vibe) => setIdentityDraft((prev) => ({ ...prev, vibe }))}
              placeholder="concise and friendly"
              value={identityDraft.vibe}
            />
            <SettingsTextField
              autoCapitalize="sentences"
              help="Appended to every agent's system prompt."
              label="Custom instructions"
              multiline
              onBlur={() => void saveSystemPromptConfig()}
              onChangeText={setCustomPromptDraft}
              placeholder="e.g. Always answer in metric units."
              value={customPromptDraft}
            />
          </View>

          <Text style={styles.subsectionTitle}>Behavior</Text>
          <View style={styles.settingsGroup}>
            {systemPromptFeatureRows.map((row) => (
              <SettingToggle
                busy={savingPromptKey === row.key}
                detail={row.detail}
                disabled={savingPromptKey !== null}
                key={row.key}
                label={row.label}
                onPress={() => {
                  void toggleSystemPromptFeature(row.key);
                }}
                tone={accentColor}
                value={summary.systemPrompt?.features[row.key] === true}
              />
            ))}
          </View>
        </>
      ) : (
        <EmptyState
          label="Prompt settings unavailable"
          detail={endpointErrorDetail(
            summary?.availability.systemPrompt,
            "The gateway did not return system prompt settings."
          )}
        />
      )}
    </GlassPanel>
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
  const healthUnavailable = Boolean(connectionError) || summary?.availability.health.ok === false;
  const gatewayStatusColor = healthy ? colors.green : healthUnavailable ? colors.red : colors.amber;
  const gatewayStatusLabel = healthy
    ? "Gateway connected"
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
  const speechSettings = readMobileSpeechSettings(summary?.config);
  const [speechDraft, setSpeechDraft] = useState(speechSettings);
  const walletStatus = objectRecord(summary?.walletStatus);
  const walletStatusAvailable = Boolean(walletStatus);
  const agentAccessEnabled = booleanSetting(walletStatus, "agentAccessEnabled");

  useEffect(() => {
    setSpeechDraft(speechSettings);
  }, [
    speechSettings.stt.language,
    speechSettings.stt.model,
    speechSettings.stt.provider,
    speechSettings.stt.providerId,
    speechSettings.tts.fallbackToSystem,
    speechSettings.tts.maxTextLength,
    speechSettings.tts.model,
    speechSettings.tts.outputFormat,
    speechSettings.tts.provider,
    speechSettings.tts.providerId,
    speechSettings.tts.speed,
    speechSettings.tts.voice,
  ]);

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

  const saveSpeechPatch = async (
    section: "tts" | "stt",
    patch: Partial<MobileSpeechSettings["tts"]> | Partial<MobileSpeechSettings["stt"]>
  ) => {
    const nextSpeech: MobileSpeechSettings = {
      ...speechDraft,
      [section]: {
        ...speechDraft[section],
        ...patch,
      },
    };
    setSpeechDraft(nextSpeech);
    await saveConfigPatch("speech", { speech: nextSpeech }, "Speech setting failed");
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
              <View style={[styles.settingsNavigationIcon, { backgroundColor: `${accentColor}18` }]}>
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
          <SettingsSection title="Speech">
            {configAvailable ? (
              <>
                <SettingSelector
                  disabled={savingConfigKey !== null}
                  label="TTS provider"
                  onSelect={(value) => {
                    const provider =
                      value === "system" || value === "elevenlabs" || value === "openai"
                        ? value
                        : "auto";
                    void saveSpeechPatch("tts", { provider });
                  }}
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "ElevenLabs", value: "elevenlabs" },
                    { label: "OpenAI", value: "openai" },
                    { label: "System", value: "system" },
                  ]}
                  selected={speechDraft.tts.provider}
                  tone={accentColor}
                  variant="menu"
                />
                <SettingSelector
                  disabled={savingConfigKey !== null}
                  label="TTS account"
                  onSelect={(providerId) => {
                    void saveSpeechPatch("tts", { providerId });
                  }}
                  options={mobileSpeechProviderOptions(summary?.providers || [], "tts")}
                  selected={speechDraft.tts.providerId}
                  tone={accentColor}
                  variant="menu"
                />
                <View style={styles.settingsInfoBox}>
                  <View style={styles.settingsInfoHeader}>
                    <Volume2 color={accentColor} size={18} strokeWidth={2.1} />
                    <Text style={styles.settingsInfoTitle}>Text to speech</Text>
                  </View>
                  <SettingsTextField
                    label="TTS model"
                    onBlur={() => {
                      void saveSpeechPatch("tts", { model: speechDraft.tts.model });
                    }}
                    onChangeText={(model) =>
                      setSpeechDraft((current) => ({
                        ...current,
                        tts: { ...current.tts, model },
                      }))
                    }
                    placeholder="eleven_multilingual_v2"
                    value={speechDraft.tts.model}
                  />
                  <SettingsTextField
                    label="Voice"
                    onBlur={() => {
                      void saveSpeechPatch("tts", { voice: speechDraft.tts.voice });
                    }}
                    onChangeText={(voice) =>
                      setSpeechDraft((current) => ({
                        ...current,
                        tts: { ...current.tts, voice },
                      }))
                    }
                    placeholder="Voice ID or name"
                    value={speechDraft.tts.voice}
                  />
                  <SettingSelector
                    disabled={savingConfigKey !== null}
                    label="Audio format"
                    onSelect={(outputFormat) => {
                      void saveSpeechPatch("tts", { outputFormat });
                    }}
                    options={[
                      { label: "MP3", value: "mp3" },
                      { label: "M4A", value: "m4a" },
                      { label: "WAV", value: "wav" },
                      { label: "Opus", value: "opus" },
                      { label: "AAC", value: "aac" },
                      { label: "AIFF", value: "aiff" },
                    ]}
                    selected={speechDraft.tts.outputFormat}
                    tone={accentColor}
                    variant="menu"
                  />
                  <SettingToggle
                    busy={savingConfigKey === "speech"}
                    detail="Use macOS system voice if no cloud TTS provider is configured."
                    disabled={savingConfigKey !== null}
                    label="System voice fallback"
                    onPress={() => {
                      void saveSpeechPatch("tts", {
                        fallbackToSystem: !speechDraft.tts.fallbackToSystem,
                      });
                    }}
                    tone={accentColor}
                    value={speechDraft.tts.fallbackToSystem}
                  />
                </View>
                <View style={styles.settingsInfoBox}>
                  <View style={styles.settingsInfoHeader}>
                    <Mic color={accentColor} size={18} strokeWidth={2.1} />
                    <Text style={styles.settingsInfoTitle}>Speech to text</Text>
                  </View>
                  <SettingSelector
                    disabled={savingConfigKey !== null}
                    label="STT account"
                    onSelect={(providerId) => {
                      void saveSpeechPatch("stt", { providerId });
                    }}
                    options={mobileSpeechProviderOptions(summary?.providers || [], "stt")}
                    selected={speechDraft.stt.providerId}
                    tone={accentColor}
                    variant="menu"
                  />
                  <SettingsTextField
                    label="STT model"
                    onBlur={() => {
                      void saveSpeechPatch("stt", { model: speechDraft.stt.model });
                    }}
                    onChangeText={(model) =>
                      setSpeechDraft((current) => ({
                        ...current,
                        stt: { ...current.stt, model },
                      }))
                    }
                    placeholder="gpt-4o-mini-transcribe"
                    value={speechDraft.stt.model}
                  />
                  <SettingsTextField
                    label="Language"
                    onBlur={() => {
                      void saveSpeechPatch("stt", { language: speechDraft.stt.language });
                    }}
                    onChangeText={(language) =>
                      setSpeechDraft((current) => ({
                        ...current,
                        stt: { ...current.stt, language },
                      }))
                    }
                    placeholder="en"
                    value={speechDraft.stt.language}
                  />
                </View>
              </>
            ) : (
              <EmptyState
                label="Speech settings unavailable"
                detail={endpointErrorDetail(
                  summary?.availability.config,
                  "The gateway did not return editable speech settings."
                )}
              />
            )}
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

function SummaryTile({
  Icon,
  label,
  value,
  detail,
  tone,
}: {
  Icon: IconGlyph;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <View style={styles.summaryTile}>
      <View style={[styles.summaryIcon, { backgroundColor: `${tone}18` }]}>
        <Icon color={tone} size={19} strokeWidth={2.2} />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.summaryValue, { color: tone }]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={styles.summaryDetail}>
        {detail}
      </Text>
    </View>
  );
}

function GatewayDetailPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.gatewayDetailPill}>
      <Text style={styles.gatewayDetailLabel}>{label}</Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.gatewayDetailValue}>
        {value}
      </Text>
    </View>
  );
}

function SettingsRow({ Icon, label, value }: { Icon: IconGlyph; label: string; value: string }) {
  return (
    <View style={styles.settingsNavigationRow}>
      <View style={styles.settingsNavigationIcon}>
        <Icon color={colors.cyan} size={20} strokeWidth={2.1} />
      </View>
      <View style={styles.listText}>
        <Text style={styles.listTitle}>{label}</Text>
        <Text style={styles.listDetail} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function EmptyState({ label, detail }: { label: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{label}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    paddingBottom: MOBILE_NAV_CHROME.height + spacing.lg,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  brandWrap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
  },
  logoMark: {
    alignItems: "center",
    backgroundColor: colors.softCyan,
    borderColor: colors.softCyanBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    overflow: "hidden",
    width: 50,
  },
  logoImage: {
    height: 40,
    width: 40,
  },
  backButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
  },
  detailTitle: {
    fontSize: 22,
    lineHeight: 26,
  },
  headerDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 17,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: 28,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  iconButtonDisabled: {
    opacity: 0.55,
  },
  connectionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  liveDot: {
    borderRadius: 7,
    height: 14,
    shadowColor: colors.green,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    width: 14,
  },
  connectionText: {
    fontSize: typography.body,
    fontWeight: "700",
  },
  gatewayTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  gatewayIdentity: {
    flex: 1,
    gap: 4,
  },
  gatewayName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  gatewayMeta: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  settingsGatewayCard: {
    backgroundColor: colors.surfaceLift,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    padding: spacing.md,
  },
  gatewayDetailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  gatewayDetailPill: {
    backgroundColor: colors.inset,
    borderRadius: radius.sm,
    flexBasis: "48%",
    flexGrow: 1,
    gap: 3,
    minHeight: 58,
    minWidth: 132,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  gatewayDetailLabel: {
    color: colors.textDim,
    fontSize: typography.tiny,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  gatewayDetailValue: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: "800",
  },
  errorText: {
    color: colors.red,
    fontSize: typography.label,
    lineHeight: 18,
  },
  overviewInset: {
    gap: spacing.sm,
    paddingHorizontal: MOBILE_HOME_CHROME.managementGridEdgeToEdge ? 0 : spacing.lg,
  },
  moduleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  moduleTile: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexBasis: "48%",
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 108,
    padding: spacing.md,
  },
  moduleIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceLift,
    borderRadius: radius.md,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  moduleText: {
    flex: 1,
    justifyContent: "flex-end",
  },
  moduleTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  moduleDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
    marginTop: 3,
  },
  monitorTile: {
    alignItems: "center",
    flexBasis: "100%",
    flexDirection: "row",
    minHeight: 72,
  },
  monitorTilePrimary: {
    backgroundColor: colors.surface,
    minHeight: 78,
  },
  monitorText: {
    flex: 1,
  },
  activityPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    gap: spacing.sm,
  },
  panelHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  panelHeaderTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: "800",
  },
  smallButton: {
    backgroundColor: colors.inset,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  smallButtonText: {
    fontSize: typography.label,
    fontWeight: "800",
  },
  newChatButton: {
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  newChatButtonPressed: {
    backgroundColor: colors.insetStrong,
  },
  newChatIcon: {
    alignItems: "center",
    borderRadius: 11,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  newChatButtonText: {
    fontSize: typography.label,
    fontWeight: "900",
  },
  logPageFooter: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  loadMoreButton: {
    alignItems: "center",
    backgroundColor: colors.inset,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    width: "100%",
  },
  loadMoreButtonDisabled: {
    opacity: 0.65,
  },
  loadMoreButtonText: {
    color: colors.blueText,
    fontSize: typography.body,
    fontWeight: "900",
  },
  activityRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
  },
  activityDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  activityIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceLift,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  activityText: {
    flex: 1,
    gap: 3,
  },
  activityTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  activityDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  statePill: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  stateText: {
    fontSize: typography.label,
    fontWeight: "800",
  },
  detailPanel: {
    gap: spacing.md,
  },
  mainTabPanel: {
    borderLeftWidth: 0,
    borderRadius: MOBILE_MAIN_TAB_CHROME.panelRadius,
    borderRightWidth: 0,
  },
  settingsRootContent: {
    gap: 0,
    paddingHorizontal: 0,
  },
  settingsNativePage: {
    gap: spacing.lg,
  },
  settingsSection: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  settingsSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 24,
    paddingHorizontal: spacing.sm,
  },
  settingsSectionTitle: {
    color: colors.textDim,
    fontSize: typography.tiny,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  settingsGroup: {
    backgroundColor: colors.surfaceLift,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  settingsNavigationRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingsNavigationIcon: {
    alignItems: "center",
    backgroundColor: colors.inset,
    borderRadius: radius.sm,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  metricMicroGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  itemHero: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  itemHeroText: {
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: "900",
  },
  itemDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 18,
  },
  infoSection: {
    gap: spacing.sm,
  },
  infoSectionTitle: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginLeft: spacing.xs,
    textTransform: "uppercase",
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  infoRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  infoRowDivider: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: typography.body,
    maxWidth: "42%",
  },
  infoValue: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    fontWeight: "600",
    textAlign: "right",
  },
  chatShell: {
    flex: 1,
    position: "relative",
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    gap: spacing.sm,
    paddingBottom:
      MOBILE_CHAT_CHROME.composerReservedBottom + MOBILE_CHAT_COMPOSER.maxHeight + spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  chatMessageRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  chatMessageRowUser: {
    flexDirection: "row-reverse",
  },
  chatAvatar: {
    alignItems: "center",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    marginTop: 2,
    width: 32,
  },
  messageBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexShrink: 1,
    gap: spacing.xs,
    maxWidth: "86%",
    padding: spacing.md,
  },
  assistantMessageBubble: {
    maxWidth: "92%",
  },
  userMessageBubble: {
    backgroundColor: colors.surfaceLift,
  },
  messageThinking: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontStyle: "italic",
    lineHeight: 18,
  },
  messageText: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 22,
  },
  messageTime: {
    color: colors.textDim,
    fontSize: typography.tiny,
    marginTop: 2,
  },
  messageTimeUser: {
    textAlign: "right",
  },
  messageContent: {
    gap: spacing.sm,
  },
  codeBlock: {
    backgroundColor: colors.scrim,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  codeHeader: {
    backgroundColor: colors.surfaceLift,
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textTransform: "uppercase",
  },
  codeText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    padding: spacing.sm,
  },
  codeTextMonospace: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  workTimeline: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  workedForText: {
    color: colors.textDim,
    fontSize: typography.label,
    paddingHorizontal: 2,
  },
  messageActivityList: {
    gap: spacing.xs,
    paddingHorizontal: 2,
  },
  messageActivityRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
  },
  messageActivityIcon: {
    alignItems: "center",
    height: 16,
    justifyContent: "center",
    marginTop: 1,
    width: 16,
  },
  messageActivityText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.label,
    lineHeight: 18,
  },
  messageThoughtText: {
    color: colors.text,
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  typingRow: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  composer: {
    alignItems: "flex-end",
    backgroundColor: colors.surfaceLift,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chatComposerBar: {
    bottom: MOBILE_CHAT_CHROME.composerReservedBottom + MOBILE_CHAT_CHROME.composerGapToNav,
    left: 0,
    minHeight: MOBILE_CHAT_CHROME.composerHeight,
    position: "absolute",
    right: 0,
  },
  chatComposerContent: {
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  composerInput: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    includeFontPadding: false,
    lineHeight: 20,
    maxHeight: MOBILE_CHAT_COMPOSER.maxHeight,
    minHeight: MOBILE_CHAT_COMPOSER.minHeight,
    paddingHorizontal: spacing.sm,
    paddingTop: Platform.OS === "ios" ? 10 : 8,
    paddingBottom: Platform.OS === "ios" ? 8 : 7,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: radius.md,
    height: MOBILE_CHAT_COMPOSER.minHeight,
    justifyContent: "center",
    width: MOBILE_CHAT_COMPOSER.minHeight,
  },
  accentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
  },
  accentSwatch: {
    alignItems: "center",
    backgroundColor: colors.inset,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexBasis: "30%",
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 44,
    minWidth: 86,
    paddingHorizontal: spacing.sm,
  },
  accentSwatchDot: {
    borderRadius: 8,
    height: 16,
    shadowOpacity: 0.42,
    shadowRadius: 8,
    width: 16,
  },
  accentSwatchDotActive: {
    height: 18,
    width: 18,
  },
  accentSwatchLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.tiny,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  settingsForm: {
    gap: spacing.md,
  },
  settingsField: {
    gap: spacing.xs,
  },
  settingsSegmentField: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  settingsMenuRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingsMenuLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "600",
  },
  settingsMenuValueWrap: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xs,
  },
  settingsMenuValue: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: typography.body,
  },
  menuBackdrop: {
    backgroundColor: colors.scrim,
    flex: 1,
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: colors.backgroundLift,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing.xs,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  menuSheetTitle: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  menuSheetRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  menuSheetRowText: {
    color: colors.text,
    fontSize: typography.body,
  },
  settingsFieldLabel: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  settingsInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  settingsTextArea: {
    lineHeight: 20,
    minHeight: 140,
  },
  settingsFieldHelp: {
    color: colors.textDim,
    fontSize: typography.tiny,
    lineHeight: 16,
  },
  settingsInfoBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  settingsInfoHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  settingsInfoTitle: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: "900",
  },
  settingsInfoText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 18,
  },
  settingsInfoCode: {
    color: colors.text,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: typography.title,
    fontWeight: "900",
    letterSpacing: 2,
  },
  routerSummaryBox: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  routerSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  routerSummaryLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.label,
  },
  routerSummaryValue: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  settingsChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  settingsSegmentedControl: {
    backgroundColor: colors.inset,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexWrap: "nowrap",
    gap: 2,
    padding: 2,
  },
  settingsChip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  settingsSegment: {
    borderRadius: 8,
    borderWidth: 0,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: 10,
  },
  settingsChipActive: {
    backgroundColor: `${colors.cyan}16`,
    borderColor: `${colors.cyan}88`,
  },
  settingsChipText: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: "800",
  },
  settingsSegmentText: {
    fontSize: typography.tiny,
    fontWeight: "900",
    textAlign: "center",
  },
  settingsChipTextActive: {
    color: colors.text,
  },
  settingsActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  settingsActionButton: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  settingsActionButtonDisabled: {
    opacity: 0.65,
  },
  settingsActionText: {
    fontSize: typography.label,
    fontWeight: "900",
  },
  settingToggleRow: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingToggleRowDisabled: {
    opacity: 0.72,
  },
  toggleTextWrap: {
    flex: 1,
    gap: 3,
  },
  toggleTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
  toggleDetail: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    lineHeight: 16,
  },
  nativeSwitchWrap: {
    alignItems: "flex-end",
    justifyContent: "center",
    minWidth: 52,
  },
  monitorUsageRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  monitorUsageHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  monitorUsageTrack: {
    backgroundColor: colors.inset,
    borderRadius: 5,
    height: 10,
    overflow: "hidden",
  },
  monitorUsageFill: {
    borderRadius: 5,
    height: "100%",
    minWidth: 2,
  },
  disconnectButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceLift,
    borderColor: colors.softRedBorder,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    padding: spacing.md,
  },
  disconnectButtonPressed: {
    backgroundColor: colors.softRed,
  },
  disconnectIcon: {
    alignItems: "center",
    backgroundColor: colors.softRed,
    borderRadius: radius.sm,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  disconnectTextWrap: {
    flex: 1,
    gap: 2,
  },
  disconnectTitle: {
    color: colors.red,
    fontSize: typography.body,
    fontWeight: "900",
  },
  disconnectDetail: {
    color: colors.textMuted,
    fontSize: typography.tiny,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryTile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: "48%",
    flexGrow: 1,
    gap: 3,
    minHeight: 116,
    padding: spacing.md,
  },
  summaryIcon: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  summaryValue: {
    fontSize: typography.heading,
    fontWeight: "900",
  },
  summaryDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  subsectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  subsectionHeaderTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  subsectionTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "900",
  },
  counterText: {
    color: colors.cyan,
    fontSize: typography.heading,
    fontWeight: "900",
  },
  pageDetailText: {
    color: colors.textMuted,
    fontSize: typography.label,
    lineHeight: 18,
  },
  listRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 64,
    paddingTop: spacing.md,
  },
  listIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceLift,
    borderRadius: radius.md,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  listText: {
    flex: 1,
    gap: 3,
  },
  listTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  sessionTitleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
  },
  sessionListTitle: {
    flex: 1,
    lineHeight: 20,
  },
  sessionPinnedDot: {
    alignItems: "center",
    backgroundColor: `${colors.amber}16`,
    borderRadius: 9,
    height: 18,
    justifyContent: "center",
    marginTop: 1,
    width: 18,
  },
  sessionPreview: {
    color: colors.textDim,
    fontSize: typography.tiny,
  },
  listDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  tasksHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  tasksHeaderText: {
    flex: 1,
    gap: 2,
  },
  tasksTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: "800",
  },
  tasksSubtitle: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  tasksNewButton: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  tasksNewText: {
    fontSize: typography.body,
    fontWeight: "800",
  },
  tasksEmpty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  tasksEmptyIcon: {
    borderRadius: radius.lg,
    height: 52,
    width: 52,
  },
  tasksEmptyTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: "800",
  },
  tasksEmptyDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
    paddingHorizontal: spacing.md,
    textAlign: "center",
  },
  tasksEmptyCta: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  tasksEmptyCtaText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  emptyState: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  emptyDetail: {
    color: colors.textMuted,
    fontSize: typography.label,
    textAlign: "center",
  },
  tabBar: {
    borderColor: colors.borderStrong,
    borderRadius: MOBILE_NAV_CHROME.outerRadius,
    borderWidth: 1,
    height: MOBILE_NAV_CHROME.height,
    left: MOBILE_MAIN_TAB_CHROME.outerHorizontalPadding,
    overflow: "hidden",
    position: "absolute",
    right: MOBILE_MAIN_TAB_CHROME.outerHorizontalPadding,
  },
  tabBarPanel: {
    flex: 1,
    borderRadius: MOBILE_NAV_CHROME.outerRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  tabBarFill: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
  },
  tabItem: {
    alignItems: "center",
    borderRadius: radius.sm,
    flex: 1,
    gap: 2,
    height: 48,
    justifyContent: "center",
  },
  tabItemActive: {
    backgroundColor: colors.softCyan,
    borderColor: colors.softCyanBorder,
    borderWidth: 1,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: colors.cyan,
  },
});

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
