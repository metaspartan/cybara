import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ArrowLeft,
  Bot,
  Box,
  Brain,
  CalendarCheck,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Database,
  HeartPulse,
  House,
  Link2,
  ListTodo,
  MessageCircle,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  SquareTerminal,
  User,
  UsersRound,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react-native";
import { GlassButton, GlassPanel } from "../components/Glass";
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
import {
  CybaraMobileApi,
  sortSessionSummaries,
  type ActivitySummary,
  type FeatureEndpointKey,
  type FeatureSummary,
  type RemoteItemSummary,
  type SessionDetailSummary,
  type SessionSummary,
} from "../lib/api";
import {
  chatIsWaitingForAssistant,
  splitMessageContent,
  visibleChatMessages,
} from "../lib/chat-format";
import type { GatewayProfile } from "../lib/connection";
import {
  MOBILE_NAV_CHROME,
  MOBILE_CHAT_COMPOSER,
  MOBILE_CHAT_CHROME,
  MOBILE_SETTINGS_SURFACES,
  MOBILE_TABS,
  boundedMobileComposerHeight,
  buildMobileHeaderCopy,
  compactHost,
  formatUptime,
  formatMobileValue,
  lastUpdatedLabel,
  readMobileAccent,
  summarizeFeatureCounts,
  type FeatureCounts,
  type MobileSurfaceKey,
  type MobileTabKey,
} from "../lib/dashboard";
import {
  formatMetricBytes,
  formatMetricNumber,
  metricSuccessRate,
  storageCategoryEntries,
  timeSeriesTotals,
  tokenFlowBars,
  totalFileOperations,
  type MetricsSnapshot,
} from "../lib/metrics";
import { accentPalette, colors, radius, spacing, typography } from "../theme/liquidGlass";
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
  | { kind: "surface"; surface: MobileSurfaceKey }
  | { kind: "item"; surface: MobileSurfaceKey; item: RemoteItemSummary | ActivitySummary };

const tabIcons: Record<MobileTabKey, IconGlyph> = {
  overview: House,
  sessions: UsersRound,
  metrics: Cpu,
  settings: Settings,
};

const surfaceMeta: Record<
  MobileSurfaceKey,
  { title: string; Icon: IconGlyph; tone: string; endpoint?: FeatureEndpointKey }
> = {
  agents: { title: "Agents", Icon: Bot, tone: colors.cyan, endpoint: "agents" },
  providers: { title: "Providers", Icon: Database, tone: colors.blueText, endpoint: "providers" },
  tools: { title: "Tools", Icon: Wrench, tone: colors.green, endpoint: "tools" },
  approvals: { title: "Approvals", Icon: ShieldCheck, tone: colors.amber, endpoint: "approvals" },
  wallet: {
    title: "Wallet Policy",
    Icon: ShieldCheck,
    tone: colors.green,
    endpoint: "walletPolicy",
  },
  channels: { title: "Channels", Icon: Link2, tone: colors.cyan, endpoint: "channels" },
  tasks: { title: "Tasks", Icon: CalendarCheck, tone: colors.blueText, endpoint: "tasks" },
  memory: { title: "Memory", Icon: Brain, tone: colors.green, endpoint: "memory" },
  terminal: { title: "Terminal", Icon: SquareTerminal, tone: colors.cyan },
  logs: { title: "Logs", Icon: ListTodo, tone: colors.textMuted, endpoint: "logs" },
  monitor: { title: "System Monitor", Icon: Cpu, tone: colors.blueText, endpoint: "health" },
};

const sparkBars = [8, 10, 7, 12, 9, 14, 20, 12, 8, 13, 11, 16, 9, 13, 18, 12, 25];

function showValue(label: string, value: string) {
  Alert.alert(label, value);
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

function displayFields(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(record)
    .filter(([key]) => !/secret|token|api[_-]?key|password|credential|mnemonic/i.test(key))
    .map(([label, value]) => ({
      label: label.replace(/_/g, " "),
      value: formatMobileValue(value),
    }));
}

function resolveAccentColor(summary: FeatureSummary | null): string {
  const key = readMobileAccent(summary?.config) as keyof typeof accentPalette;
  return accentPalette[key] || accentPalette.cyan;
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
  summary: FeatureSummary | null,
  profile: GatewayProfile
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
    case "terminal":
      return [
        itemFromRecord("terminal", "Gateway terminal", "Open the gateway terminal surface", {
          url: `${profile.baseUrl}/terminal`,
          status: "available from gateway web UI",
        }),
      ];
    case "monitor": {
      const checks = summary.health?.checks || {};
      return [
        itemFromRecord("runtime", "Runtime", summary.health?.version || "pending", {
          uptime: formatUptime(summary.health?.uptime),
          version: summary.health?.version || "pending",
          status: summary.health?.status || "unknown",
        }),
        ...Object.entries(checks).map(([key, value]) =>
          itemFromRecord(key, key, formatMobileValue(value), value as Record<string, unknown>)
        ),
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
    case "terminal":
      return "Open gateway terminal";
    case "monitor":
      return rowCount > 0 ? `${rowCount} health checks` : "Health checks";
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
  const [summary, setSummary] = useState<FeatureSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileTabKey>("overview");
  const [detailRoute, setDetailRoute] = useState<DetailRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const refresh = async (showRefreshing = true) => {
    if (showRefreshing) setRefreshing(true);
    setError(null);
    try {
      setSummary(await api.featureSummary());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      if (showRefreshing) setRefreshing(false);
    }
  };

  const refreshMetrics = async () => {
    setMetricsError(null);
    try {
      setMetrics(await api.metricsSnapshot());
    } catch (refreshError) {
      setMetricsError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  };

  const refreshAll = async (showRefreshing = true) => {
    if (showRefreshing) setRefreshing(true);
    await Promise.all([refresh(false), refreshMetrics()]);
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
    const interval = setInterval(() => {
      void refreshMetrics();
    }, 30000);
    return () => clearInterval(interval);
  }, [profile.id]);

  const health = summary?.health;
  const healthy = health?.status === "healthy";
  const statusColor = healthy ? colors.green : error ? colors.red : colors.amber;
  const sessions = summary?.sessions ?? [];
  const orderedSessions = useMemo(() => sortSessionSummaries(sessions), [sessions]);
  const counts = summarizeFeatureCounts(summary);
  const accentColor = resolveAccentColor(summary);
  const headerCopy = routeHeader(
    detailRoute,
    buildMobileHeaderCopy(activeTab, counts, profile),
    summary
  );

  const selectTab = (tab: MobileTabKey) => {
    setDetailRoute(null);
    setActiveTab(tab);
  };

  const openSurface = (surface: MobileSurfaceKey) => {
    setActiveTab("settings");
    setDetailRoute({ kind: "surface", surface });
  };

  const openItem = (surface: MobileSurfaceKey, item: RemoteItemSummary | ActivitySummary) => {
    setDetailRoute({ kind: "item", surface, item });
  };

  const modules: ModuleCard[] = [
    {
      key: "sessions",
      label: "Chats",
      detail: surfaceCount(summary, "sessions", counts.sessions, "chats", "No chats", "chat"),
      value: String(counts.sessions),
      Icon: MessageCircle,
      tab: "sessions",
    },
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
      key: "wallet",
      label: "Wallet Policy",
      detail: summary?.walletPolicy ? "Limits & rules" : "Unavailable",
      value: summary?.walletPolicy ? "On" : "-",
      Icon: ShieldCheck,
      tab: "settings",
      surface: "wallet",
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
      key: "tasks",
      label: "Tasks",
      detail: surfaceCount(summary, "tasks", counts.tasks, "scheduled", "No tasks"),
      value: String(counts.tasks),
      Icon: CalendarCheck,
      tab: "settings",
      surface: "tasks",
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
      key: "terminal",
      label: "Terminal",
      detail: "Web shell",
      value: "CLI",
      Icon: SquareTerminal,
      tab: "settings",
      surface: "terminal",
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
            <Pressable style={styles.backButton} onPress={() => setDetailRoute(null)}>
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
        {!detailRoute ? (
          <Pressable style={styles.iconButton} onPress={() => selectTab("settings")}>
            <Settings color={colors.text} size={22} strokeWidth={2.1} />
          </Pressable>
        ) : null}
      </View>

      {detailRoute?.kind === "session" ? (
        <SessionDetailPanel
          accentColor={accentColor}
          api={api}
          closeDetail={() => setDetailRoute(null)}
          refreshSummary={() => refresh(false)}
          sessionId={detailRoute.id}
        />
      ) : (
        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              tintColor={accentColor}
              refreshing={refreshing}
              onRefresh={() => refreshAll(true)}
            />
          }
        >
          {!detailRoute && activeTab === "overview" ? (
            <GlassPanel elevated style={styles.gatewayPanel}>
              <View style={styles.connectionRow}>
                <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.connectionText, { color: statusColor }]}>
                  {healthy ? "Gateway connected" : error ? "Gateway degraded" : "Checking gateway"}
                </Text>
              </View>

              <View style={styles.gatewayTop}>
                <View style={styles.gatewayIdentity}>
                  <Text style={styles.gatewayName}>{profile.name}</Text>
                  <Text style={styles.gatewayMeta}>
                    {compactHost(profile.baseUrl)} - {health?.version || "version pending"}
                  </Text>
                </View>
                <Pressable style={styles.reconnectButton} onPress={() => refreshAll(true)}>
                  <RefreshCw color={colors.blueText} size={18} strokeWidth={2.2} />
                  <Text style={styles.reconnectText}>
                    {refreshing ? "Refreshing" : "Reconnect"}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.metricStrip}>
                <StatusMetric
                  Icon={HeartPulse}
                  label="Health"
                  value={healthy ? "Healthy" : "Check"}
                  tone={statusColor}
                />
                <StatusMetric
                  Icon={Wifi}
                  label="API"
                  value={health ? "Online" : "Waiting"}
                  tone={colors.cyan}
                />
                <StatusMetric
                  Icon={UsersRound}
                  label="Chats"
                  value={`${counts.sessions} chats`}
                  tone={colors.blueText}
                />
                <StatusMetric
                  Icon={Box}
                  label="Providers"
                  value={`${counts.providers} enabled`}
                  tone={colors.textMuted}
                />
              </View>

              <View style={styles.detailTable}>
                <DetailRow
                  label="Gateway URL"
                  value={profile.baseUrl}
                  onPress={() => showValue("Gateway URL", profile.baseUrl)}
                />
                <DetailRow
                  label="API Base"
                  value="/api"
                  onPress={() => showValue("API Base", "/api")}
                />
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Uptime</Text>
                  <Text style={styles.detailValue}>{formatUptime(health?.uptime)}</Text>
                  <View style={styles.sparkline}>
                    {sparkBars.map((height, index) => (
                      <View key={`${height}-${index}`} style={[styles.sparkBar, { height }]} />
                    ))}
                  </View>
                </View>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable style={styles.disclosureRow} onPress={() => selectTab("settings")}>
                <Text style={styles.disclosureText}>View connection details</Text>
                <ChevronRight color={colors.text} size={22} strokeWidth={2.1} />
              </Pressable>
            </GlassPanel>
          ) : null}

          {detailRoute ? (
            <DetailContent
              api={api}
              profile={profile}
              route={detailRoute}
              summary={summary}
              openItem={openItem}
              accentColor={accentColor}
              closeDetail={() => setDetailRoute(null)}
              refreshSummary={() => refresh(false)}
              openSession={(id) => setDetailRoute({ kind: "session", id })}
            />
          ) : activeTab === "overview" ? (
            <OverviewPanel
              modules={modules}
              sessions={orderedSessions}
              logs={summary?.logs ?? []}
              selectTab={selectTab}
              openSurface={openSurface}
            />
          ) : null}
          {!detailRoute && activeTab === "sessions" ? (
            <SessionsPanel
              sessions={orderedSessions}
              summary={summary}
              openSession={(id) => setDetailRoute({ kind: "session", id })}
              createChat={() => setDetailRoute({ kind: "newChat" })}
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
              refreshMetrics={refreshMetrics}
            />
          ) : null}
          {!detailRoute && activeTab === "settings" ? (
            <SettingsPanel
              profile={profile}
              summary={summary}
              onDisconnect={onDisconnect}
              openSurface={openSurface}
            />
          ) : null}
        </ScrollView>
      )}

      <GlassPanel elevated contentStyle={styles.tabBarPanel} style={styles.tabBar}>
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
      </GlassPanel>
    </View>
  );
}

function StatusMetric({
  Icon,
  label,
  value,
  tone,
}: {
  Icon: IconGlyph;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <View style={styles.metricCell}>
      <View style={[styles.metricIcon, { backgroundColor: `${tone}20` }]}>
        <Icon color={tone} size={20} strokeWidth={2.3} />
      </View>
      <View style={styles.metricText}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, { color: tone }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>
        {value}
      </Text>
      <Pressable style={styles.copyButton} onPress={onPress}>
        <Copy color={colors.textMuted} size={19} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function OverviewPanel({
  modules,
  sessions,
  logs,
  selectTab,
  openSurface,
}: {
  modules: ModuleCard[];
  sessions: SessionSummary[];
  logs: ActivitySummary[];
  selectTab: (tab: MobileTabKey) => void;
  openSurface: (surface: MobileSurfaceKey) => void;
}) {
  const activityRows =
    sessions.length > 0
      ? sessions.slice(0, 3).map((session, index) => ({
          id: session.id,
          Icon: index === 1 ? SquareTerminal : MessageCircle,
          title: session.title || session.id.slice(0, 8),
          detail: `${session.agent_id || "agent"} - ${lastUpdatedLabel(session)}`,
          state: "Active",
          tone: colors.green,
        }))
      : logs.slice(0, 3).map((log) => ({
          id: log.id,
          Icon: ListTodo,
          title: log.title,
          detail: `${log.source} - ${log.createdAt ? relativeTimestamp(log.createdAt) : "recent"}`,
          state: "Event",
          tone: colors.cyan,
        }));

  return (
    <>
      <Text style={styles.sectionTitle}>Remote management</Text>
      <View style={styles.moduleGrid}>
        {modules.slice(0, 9).map((module) => (
          <ModuleTile
            key={module.key}
            module={module}
            onPress={() => (module.surface ? openSurface(module.surface) : selectTab(module.tab))}
          />
        ))}
        <Pressable
          style={[styles.moduleTile, styles.monitorTile]}
          onPress={() => selectTab("metrics")}
        >
          <View style={styles.moduleIcon}>
            <Cpu color={colors.text} size={23} strokeWidth={2.1} />
          </View>
          <View style={styles.monitorText}>
            <Text style={styles.moduleTitle}>System Monitor</Text>
            <Text style={styles.moduleDetail}>CPU ready RAM ready Disk ready</Text>
          </View>
          <ChevronRight color={colors.text} size={22} strokeWidth={2.1} />
        </Pressable>
      </View>

      <GlassPanel elevated style={styles.activityPanel}>
        <View style={styles.panelHeader}>
          <View style={styles.panelHeaderTitle}>
            <Clock color={colors.textMuted} size={21} strokeWidth={2} />
            <Text style={styles.panelTitle}>Recent activity</Text>
          </View>
          <Pressable style={styles.smallButton} onPress={() => selectTab("sessions")}>
            <Text style={styles.smallButtonText}>View all</Text>
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
          />
        ))}
        {activityRows.length === 0 ? (
          <>
            <ActivityRow
              Icon={MessageCircle}
              title="No chats"
              detail="Start a chat from the gateway"
              state="Idle"
              tone={colors.amber}
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
        <Text style={styles.activityTitle}>{title}</Text>
        <Text style={styles.activityDetail}>{detail}</Text>
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
}: {
  accentColor: string;
  createChat: () => void;
  sessions: SessionSummary[];
  summary: FeatureSummary | null;
  openSession: (id: string) => void;
}) {
  const latest = sessions[0];
  const endpoint = summary?.availability.sessions;

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={MessageCircle}
          label="Chats"
          value={String(sessions.length)}
          detail="total"
          tone={accentColor}
        />
        <SummaryTile
          Icon={Clock}
          label="Latest"
          value={latest ? lastUpdatedLabel(latest) : "None"}
          detail={latest?.title || "No recent chat"}
          tone={colors.blueText}
        />
      </View>
      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Recent chats</Text>
        <Pressable style={styles.smallButton} onPress={createChat}>
          <Text style={styles.smallButtonText}>New</Text>
        </Pressable>
      </View>
      {sessions.slice(0, 20).map((session) => (
        <Pressable key={session.id} style={styles.listRow} onPress={() => openSession(session.id)}>
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
                {session.title || session.id.slice(0, 8)}
              </Text>
            </View>
            <Text numberOfLines={1} style={styles.listDetail}>
              {session.message_count} messages - {lastUpdatedLabel(session)}
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
  refreshMetrics,
}: {
  accentColor: string;
  counts: FeatureCounts;
  metrics: MetricsSnapshot | null;
  metricsError: string | null;
  summary: FeatureSummary | null;
  openSurface: (surface: MobileSurfaceKey) => void;
  refreshMetrics: () => void;
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
    <GlassPanel elevated style={styles.detailPanel}>
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
        <Pressable style={styles.smallButton} onPress={refreshMetrics}>
          <Text style={styles.smallButtonText}>Refresh</Text>
        </Pressable>
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
  if (route.kind === "item") {
    return <ItemDetailPanel profile={profile} route={route} />;
  }
  return (
    <SurfaceDetailPanel
      profile={profile}
      summary={summary}
      surface={route.surface}
      openItem={(item) => openItem(route.surface, item)}
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
}: {
  accentColor: string;
  api: CybaraMobileApi;
  closeDetail: () => void;
  refreshSummary: () => void;
  sessionSummary?: SessionSummary | null;
  sessionId: string;
}) {
  const [detail, setDetail] = useState<SessionDetailSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composerHeight, setComposerHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [sending, setSending] = useState(false);
  const [pinned, setPinned] = useState(sessionSummary?.pinned ?? false);
  const [pinning, setPinning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadSession = async (showLoading = false) => {
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

  const sendMessage = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setComposerHeight(MOBILE_CHAT_COMPOSER.minHeight);
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
      setDraft(message);
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
    const title = detail?.title || sessionSummary?.title || `Session ${sessionId.slice(0, 8)}`;
    Alert.alert(
      "Chat details",
      [
        title,
        `${messageCount} message${messageCount === 1 ? "" : "s"}`,
        `Updated: ${absoluteTimestampLabel(updatedAt)}`,
        `Agent: ${detail?.agentId || sessionSummary?.agent_id || "unknown"}`,
        `Workspace: ${compactWorkspace(detail?.workspaceDir || sessionSummary?.workspace_dir)}`,
        `Session: ${sessionId}`,
      ].join("\n"),
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

  const visibleMessages = visibleChatMessages(detail?.messages ?? []);
  const waitingForAssistant = chatIsWaitingForAssistant(detail?.messages ?? [], sending);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={MOBILE_NAV_CHROME.height}
      style={styles.chatShell}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.chatContent}
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
            <View style={styles.chatMetaBar}>
              <View style={styles.chatMetaChips}>
                {pinned ? (
                  <View style={[styles.chatMetaChip, styles.chatPinnedChip]}>
                    <ShieldCheck color={colors.amber} size={15} strokeWidth={2.2} />
                    <Text numberOfLines={1} style={[styles.chatMetaText, { color: colors.amber }]}>
                      Pinned
                    </Text>
                  </View>
                ) : null}
                <View style={styles.chatMetaChip}>
                  <Bot color={colors.green} size={15} strokeWidth={2.2} />
                  <Text numberOfLines={1} style={styles.chatMetaText}>
                    {detail.agentId || sessionSummary?.agent_id || "unknown agent"}
                  </Text>
                </View>
                <View style={styles.chatMetaChip}>
                  <Database color={colors.blueText} size={15} strokeWidth={2.2} />
                  <Text numberOfLines={1} style={styles.chatMetaText}>
                    {compactWorkspace(detail.workspaceDir || sessionSummary?.workspace_dir)}
                  </Text>
                </View>
              </View>
              <Pressable style={styles.chatActionButton} onPress={showChatActions}>
                {pinning ? (
                  <ActivityIndicator color={colors.textMuted} size="small" />
                ) : (
                  <Settings color={colors.textMuted} size={18} strokeWidth={2.1} />
                )}
              </Pressable>
            </View>

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

      <View style={styles.chatComposerBar}>
        <View style={styles.composer}>
          <TextInput
            editable={!sending}
            multiline
            onContentSizeChange={(event) => {
              setComposerHeight(
                boundedMobileComposerHeight(event.nativeEvent.contentSize.height)
              );
            }}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message this chat"
            placeholderTextColor={colors.textDim}
            scrollEnabled={composerHeight >= MOBILE_CHAT_COMPOSER.maxHeight}
            style={[styles.composerInput, { height: composerHeight }]}
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
                backgroundColor: draft.trim() ? accentColor : "rgba(255,255,255,0.08)",
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
      </View>
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
        {!isUser && message.thinking ? (
          <Text numberOfLines={4} style={styles.messageThinking}>
            {message.thinking}
          </Text>
        ) : null}
        {!isUser && message.processActivities?.length ? (
          <MessageActivityList message={message} />
        ) : null}
        <MessageContent content={message.content || "(empty message)"} />
        {message.toolCalls?.length ? <ToolCallStrip message={message} /> : null}
        {message.timestamp ? (
          <Text style={[styles.messageTime, isUser && styles.messageTimeUser]}>
            {relativeTimestamp(message.timestamp)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function MessageActivityList({ message }: { message: SessionDetailSummary["messages"][number] }) {
  return (
    <View style={styles.messageActivityList}>
      {message.processActivities?.map((activity) => (
        <View key={activity.id} style={styles.messageActivityRow}>
          <Zap
            color={activity.phase === "error" ? colors.red : colors.textMuted}
            size={14}
            strokeWidth={2}
          />
          <Text numberOfLines={2} style={styles.messageActivityText}>
            {activity.toolName ? `${activity.toolName}: ` : ""}
            {activity.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ToolCallStrip({ message }: { message: SessionDetailSummary["messages"][number] }) {
  return (
    <View style={styles.toolCallStrip}>
      {message.toolCalls?.map((toolCall) => (
        <View key={toolCall.id} style={styles.toolCallPill}>
          <Wrench color={colors.textMuted} size={13} strokeWidth={2} />
          <Text numberOfLines={1} style={styles.toolCallText}>
            {toolCall.name} - {toolCall.status}
          </Text>
        </View>
      ))}
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
              <Text selectable style={styles.codeText}>
                {part.content}
              </Text>
            </ScrollView>
          </View>
        ) : (
          <Text key={`text-${index}`} selectable style={styles.messageText}>
            {part.content.trim().length > 0 ? part.content : "\n"}
          </Text>
        )
      )}
    </View>
  );
}

function SurfaceDetailPanel({
  profile,
  summary,
  surface,
  openItem,
}: {
  profile: GatewayProfile;
  summary: FeatureSummary | null;
  surface: MobileSurfaceKey;
  openItem: (item: RemoteItemSummary | ActivitySummary) => void;
}) {
  const meta = surfaceMeta[surface];
  const rows = surfaceRows(surface, summary, profile);
  const endpoint = meta.endpoint ? summary?.availability[meta.endpoint] : undefined;

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>Live records</Text>
        <Text style={styles.counterText}>
          {endpoint ? endpointStatusLabel(endpoint) : rows.length}
        </Text>
      </View>
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
    </GlassPanel>
  );
}

function ItemDetailPanel({
  profile,
  route,
}: {
  profile: GatewayProfile;
  route: Extract<DetailRoute, { kind: "item" }>;
}) {
  const item = route.item;
  const meta = surfaceMeta[route.surface];
  const Icon = meta.Icon;
  const fields = [
    { label: "id", value: item.id },
    { label: "surface", value: meta.title },
    { label: "detail", value: item.detail },
    ...("source" in item ? [{ label: "source", value: item.source }] : []),
    ...("createdAt" in item && item.createdAt
      ? [{ label: "updated", value: relativeTimestamp(item.createdAt) }]
      : []),
    ...(item.fields || []),
  ];

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${meta.tone}18` }]}>
          <Icon color={meta.tone} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemDetail}>{item.detail}</Text>
        </View>
      </View>
      {route.surface === "terminal" ? (
        <GlassButton
          label="Open terminal"
          detail={compactHost(profile.baseUrl)}
          onPress={() => void Linking.openURL(`${profile.baseUrl}/terminal`)}
        />
      ) : null}
      <Text style={styles.subsectionTitle}>Details</Text>
      {fields.map((field, index) => (
        <View key={`${field.label}-${index}`} style={styles.listRow}>
          <View style={styles.listText}>
            <Text style={styles.listTitle}>{field.label}</Text>
            <Text selectable style={styles.listDetail}>
              {field.value}
            </Text>
          </View>
        </View>
      ))}
    </GlassPanel>
  );
}

function SettingsPanel({
  profile,
  summary,
  onDisconnect,
  openSurface,
}: {
  profile: GatewayProfile;
  summary: FeatureSummary | null;
  onDisconnect: () => void;
  openSurface: (surface: MobileSurfaceKey) => void;
}) {
  const counts = summarizeFeatureCounts(summary);

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={Wifi}
          label="Gateway"
          value={compactHost(profile.baseUrl)}
          detail="active endpoint"
          tone={colors.cyan}
        />
        <SummaryTile
          Icon={ShieldCheck}
          label="Device"
          value={profile.deviceId ? "Paired" : "Manual"}
          detail={profile.deviceId || "API key profile"}
          tone={colors.green}
        />
      </View>
      <Text style={styles.subsectionTitle}>Connection</Text>
      <SettingsRow Icon={Wifi} label="Gateway" value={profile.baseUrl} />
      <SettingsRow
        Icon={ShieldCheck}
        label="Device token"
        value={profile.deviceId || "manual key"}
      />
      <SettingsRow
        Icon={HeartPulse}
        label="Health API"
        value={endpointStatusLabel(summary?.availability.health)}
      />
      <Text style={styles.subsectionTitle}>Safety policy</Text>
      <SettingsRow
        Icon={Zap}
        label="Tool approval"
        value={formatMobileValue(summary?.config.tool_approval_mode)}
      />
      <SettingsRow
        Icon={ShieldCheck}
        label="Dangerous tools"
        value={formatMobileValue(summary?.config.dangerous_tool_policy)}
      />
      <SettingsRow
        Icon={ShieldCheck}
        label="Wallet policy"
        value={endpointStatusLabel(summary?.availability.walletPolicy)}
      />
      <Text style={styles.subsectionTitle}>Runtime</Text>
      <SettingsRow Icon={Cpu} label="Runtime" value={summary?.health?.version || "pending"} />
      <SettingsRow
        Icon={Database}
        label="Config API"
        value={endpointStatusLabel(summary?.availability.config)}
      />
      <Text style={styles.subsectionTitle}>Gateway management</Text>
      {MOBILE_SETTINGS_SURFACES.map((surface) => {
        const meta = surfaceMeta[surface];
        const Icon = meta.Icon;
        const rows = surfaceRows(surface, summary, profile);
        return (
          <Pressable key={surface} style={styles.listRow} onPress={() => openSurface(surface)}>
            <View style={[styles.listIcon, { backgroundColor: `${meta.tone}18` }]}>
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
      <GlassButton
        label="Disconnect gateway"
        detail="Remove active mobile profile"
        onPress={onDisconnect}
      />
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

function SettingsRow({ Icon, label, value }: { Icon: IconGlyph; label: string; value: string }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.listIcon}>
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

const styles = StyleSheet.create({
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
  },
  brandWrap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
  },
  logoMark: {
    alignItems: "center",
    backgroundColor: "rgba(85, 216, 255, 0.10)",
    borderColor: "rgba(85, 216, 255, 0.48)",
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
    backgroundColor: "rgba(255,255,255,0.07)",
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
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: colors.borderStrong,
    borderRadius: 28,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  gatewayPanel: {
    gap: spacing.sm,
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
  reconnectButton: {
    alignItems: "center",
    backgroundColor: "rgba(70, 143, 182, 0.22)",
    borderColor: "rgba(183, 230, 255, 0.42)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  reconnectText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
  metricStrip: {
    backgroundColor: "rgba(0, 0, 0, 0.16)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  metricCell: {
    alignItems: "center",
    flexBasis: "48%",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
  },
  metricIcon: {
    alignItems: "center",
    borderRadius: 22,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  metricText: {
    flex: 1,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  metricValue: {
    fontSize: typography.body,
    fontWeight: "800",
  },
  detailTable: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  detailRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: typography.body,
    width: 96,
  },
  detailValue: {
    color: colors.cyan,
    flex: 1,
    fontSize: typography.body,
    fontWeight: "600",
  },
  copyButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 40,
  },
  sparkline: {
    alignItems: "flex-end",
    flex: 1,
    flexDirection: "row",
    gap: 2,
    height: 34,
    justifyContent: "flex-end",
  },
  sparkBar: {
    backgroundColor: colors.cyan,
    borderRadius: 2,
    opacity: 0.8,
    width: 4,
  },
  errorText: {
    color: colors.red,
    fontSize: typography.label,
    lineHeight: 18,
  },
  disclosureRow: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  disclosureText: {
    color: colors.cyan,
    fontSize: typography.body,
    fontWeight: "700",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  moduleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  moduleTile: {
    backgroundColor: "rgba(8, 13, 19, 0.9)",
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
    backgroundColor: "rgba(255,255,255,0.065)",
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
  monitorText: {
    flex: 1,
  },
  activityPanel: {
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
    backgroundColor: "rgba(70, 143, 182, 0.22)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  smallButtonText: {
    color: colors.blueText,
    fontSize: typography.label,
    fontWeight: "800",
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
    backgroundColor: "rgba(255,255,255,0.04)",
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
  metricMicroGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  itemHero: {
    alignItems: "center",
    backgroundColor: "rgba(3, 7, 11, 0.58)",
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
  chatShell: {
    flex: 1,
    marginHorizontal: -spacing.lg,
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
  chatMetaBar: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingTop: spacing.xs,
  },
  chatMetaChips: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chatMetaChip: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  chatPinnedChip: {
    backgroundColor: `${colors.amber}14`,
    borderColor: `${colors.amber}40`,
  },
  chatMetaText: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "700",
    maxWidth: 180,
  },
  chatActionButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    minHeight: 30,
    width: 38,
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
    backgroundColor: "rgba(3, 7, 11, 0.72)",
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
    backgroundColor: "rgba(255,255,255,0.052)",
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
    backgroundColor: "rgba(0, 0, 0, 0.34)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  codeHeader: {
    backgroundColor: "rgba(255,255,255,0.045)",
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textTransform: "uppercase",
  },
  codeText: {
    color: colors.text,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
    padding: spacing.sm,
  },
  messageActivityList: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  messageActivityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  messageActivityText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.tiny,
    lineHeight: 16,
  },
  toolCallStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  toolCallPill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "100%",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  toolCallText: {
    color: colors.textMuted,
    fontSize: typography.tiny,
    fontWeight: "700",
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
    backgroundColor: "rgba(2, 6, 10, 0.94)",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  chatComposerBar: {
    backgroundColor: "rgba(3, 7, 11, 0.98)",
    borderTopColor: colors.borderStrong,
    borderTopWidth: 1,
    bottom: MOBILE_CHAT_CHROME.composerReservedBottom + MOBILE_CHAT_CHROME.composerGapToNav,
    left: 0,
    minHeight: MOBILE_CHAT_CHROME.composerHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    position: "absolute",
    right: 0,
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
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryTile: {
    backgroundColor: "rgba(3, 7, 11, 0.62)",
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
    backgroundColor: "rgba(255,255,255,0.04)",
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
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRadius: MOBILE_NAV_CHROME.outerRadius,
    borderRightWidth: 0,
    bottom: 0,
    height: MOBILE_NAV_CHROME.height,
    left: -spacing.lg,
    position: "absolute",
    right: -spacing.lg,
  },
  tabBarPanel: {
    flex: 1,
    backgroundColor: "rgba(5, 9, 14, 0.94)",
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
    backgroundColor: "rgba(85, 216, 255, 0.16)",
    borderColor: "rgba(190, 232, 255, 0.32)",
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
