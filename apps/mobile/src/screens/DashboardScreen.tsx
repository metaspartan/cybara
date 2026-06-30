import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Activity,
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
  Gauge,
  HeartPulse,
  House,
  Link2,
  ListTodo,
  MessageCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  SquareTerminal,
  UsersRound,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react-native";
import { GlassButton, GlassPanel } from "../components/Glass";
import {
  CybaraMobileApi,
  type ActivitySummary,
  type FeatureEndpointKey,
  type FeatureSummary,
  type RemoteItemSummary,
  type SessionDetailSummary,
  type SessionSummary,
} from "../lib/api";
import type { GatewayProfile } from "../lib/connection";
import {
  MOBILE_NAV_CHROME,
  MOBILE_SURFACES,
  MOBILE_TABS,
  buildMobileHeaderCopy,
  compactHost,
  formatUptime,
  formatMobileValue,
  lastUpdatedLabel,
  summarizeFeatureCounts,
  type FeatureCounts,
  type MobileSurfaceKey,
  type MobileTabKey,
} from "../lib/dashboard";
import { colors, radius, spacing, typography } from "../theme/liquidGlass";
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
  | { kind: "surface"; surface: MobileSurfaceKey }
  | { kind: "item"; surface: MobileSurfaceKey; item: RemoteItemSummary | ActivitySummary };

const tabIcons: Record<MobileTabKey, IconGlyph> = {
  overview: House,
  sessions: UsersRound,
  tools: Wrench,
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
  wallet: { title: "Wallet Policy", Icon: ShieldCheck, tone: colors.green, endpoint: "walletPolicy" },
  channels: { title: "Channels", Icon: Link2, tone: colors.cyan, endpoint: "channels" },
  tasks: { title: "Tasks", Icon: CalendarCheck, tone: colors.blueText, endpoint: "tasks" },
  memory: { title: "Memory", Icon: Brain, tone: colors.green, endpoint: "memory" },
  terminal: { title: "Terminal", Icon: SquareTerminal, tone: colors.cyan },
  logs: { title: "Logs", Icon: ListTodo, tone: colors.textMuted, endpoint: "logs" },
  monitor: { title: "System Monitor", Icon: Activity, tone: colors.blueText, endpoint: "health" },
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
  empty: string
): string {
  if (!summary) return "Loading";
  const endpoint = summary.availability[key];
  if (!endpoint.ok) return endpoint.status ? `Unavailable (${endpoint.status})` : "Unavailable";
  if (count === 0) return empty;
  return `${count} ${suffix}`;
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

function displayFields(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(record)
    .filter(([key]) => !/secret|token|api[_-]?key|password|credential|mnemonic/i.test(key))
    .map(([label, value]) => ({ label: label.replace(/_/g, " "), value: formatMobileValue(value) }));
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

function routeHeader(
  route: DetailRoute | null,
  fallback: { title: string; detail: string }
): { title: string; detail: string } {
  if (!route) return fallback;
  if (route.kind === "session") return { title: "Session", detail: route.id };
  if (route.kind === "surface") {
    const meta = surfaceMeta[route.surface];
    return { title: meta.title, detail: "Live gateway data" };
  }
  const meta = surfaceMeta[route.surface];
  return { title: route.item.title, detail: meta.title };
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
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileTabKey>("overview");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setSummary(await api.featureSummary());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [profile.id]);

  const health = summary?.health;
  const healthy = health?.status === "healthy";
  const statusColor = healthy ? colors.green : error ? colors.red : colors.amber;
  const sessions = summary?.sessions ?? [];
  const counts = summarizeFeatureCounts(summary);
  const headerCopy = buildMobileHeaderCopy(activeTab, counts, profile);

  const modules: ModuleCard[] = [
    {
      key: "sessions",
      label: "Chat Sessions",
      detail: surfaceCount(summary, "sessions", counts.sessions, "active", "No active chats"),
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
      tab: "tools",
    },
    {
      key: "providers",
      label: "Providers",
      detail: surfaceCount(summary, "providers", counts.providers, "enabled", "None enabled"),
      value: String(counts.providers),
      Icon: Box,
      tab: "tools",
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
      tab: "tools",
    },
    {
      key: "wallet",
      label: "Wallet Policy",
      detail: summary?.walletPolicy ? "Limits & rules" : "Unavailable",
      value: summary?.walletPolicy ? "On" : "-",
      Icon: ShieldCheck,
      tab: "settings",
    },
    {
      key: "channels",
      label: "Channels",
      detail: surfaceCount(summary, "channels", counts.channels, "configured", "None configured"),
      value: String(counts.channels),
      Icon: Link2,
      tab: "tools",
    },
    {
      key: "tasks",
      label: "Tasks",
      detail: surfaceCount(summary, "tasks", counts.tasks, "scheduled", "No tasks"),
      value: String(counts.tasks),
      Icon: CalendarCheck,
      tab: "tools",
    },
    {
      key: "memory",
      label: "Memory",
      detail: surfaceCount(summary, "memory", counts.memory, "files", "No memory files"),
      value: String(counts.memory),
      Icon: Brain,
      tab: "tools",
    },
    {
      key: "terminal",
      label: "Terminal",
      detail: "Web shell",
      value: "CLI",
      Icon: SquareTerminal,
      tab: "tools",
    },
    {
      key: "logs",
      label: "Logs",
      detail: surfaceCount(summary, "logs", counts.logs, "events", "No recent events"),
      value: String(counts.logs),
      Icon: ListTodo,
      tab: "tools",
    },
  ];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl tintColor={colors.cyan} refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <View style={styles.header}>
          <View style={styles.brandWrap}>
            <View style={styles.logoMark}>
              <Image
                accessibilityIgnoresInvertColors
                source={cybaraLogo}
                style={styles.logoImage}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{headerCopy.title}</Text>
              <Text numberOfLines={1} style={styles.headerDetail}>
                {headerCopy.detail}
              </Text>
            </View>
          </View>
          <Pressable style={styles.iconButton} onPress={() => setActiveTab("settings")}>
            <Settings color={colors.text} size={22} strokeWidth={2.1} />
          </Pressable>
        </View>

        {activeTab === "overview" ? (
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
              <Pressable style={styles.reconnectButton} onPress={refresh}>
                <RefreshCw color={colors.blueText} size={18} strokeWidth={2.2} />
                <Text style={styles.reconnectText}>{refreshing ? "Refreshing" : "Reconnect"}</Text>
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
                label="Sessions"
                value={`${counts.sessions} active`}
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
                value="/api/v1"
                onPress={() => showValue("API Base", "/api/v1")}
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

            <Pressable style={styles.disclosureRow} onPress={() => setActiveTab("settings")}>
              <Text style={styles.disclosureText}>View connection details</Text>
              <ChevronRight color={colors.text} size={22} strokeWidth={2.1} />
            </Pressable>
          </GlassPanel>
        ) : null}

        {activeTab === "overview" ? (
          <OverviewPanel
            modules={modules}
            sessions={sessions}
            logs={summary?.logs ?? []}
            selectTab={setActiveTab}
          />
        ) : null}
        {activeTab === "sessions" ? <SessionsPanel sessions={sessions} summary={summary} /> : null}
        {activeTab === "tools" ? <ToolsPanel counts={counts} summary={summary} /> : null}
        {activeTab === "settings" ? (
          <SettingsPanel profile={profile} summary={summary} onDisconnect={onDisconnect} />
        ) : null}
      </ScrollView>

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
                onPress={() => setActiveTab(key)}
                style={[styles.tabItem, selected && styles.tabItemActive]}
              >
                <Icon
                  color={selected ? colors.cyan : colors.textMuted}
                  size={21}
                  strokeWidth={2.2}
                />
                <Text
                  maxFontSizeMultiplier={1.05}
                  numberOfLines={1}
                  style={[styles.tabLabel, selected && styles.tabLabelActive]}
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
}: {
  modules: ModuleCard[];
  sessions: SessionSummary[];
  logs: ActivitySummary[];
  selectTab: (tab: MobileTabKey) => void;
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
          <ModuleTile key={module.key} module={module} onPress={() => selectTab(module.tab)} />
        ))}
        <Pressable
          style={[styles.moduleTile, styles.monitorTile]}
          onPress={() => selectTab("tools")}
        >
          <View style={styles.moduleIcon}>
            <Activity color={colors.text} size={23} strokeWidth={2.1} />
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
              title="No active sessions"
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
}: {
  Icon: IconGlyph;
  title: string;
  detail: string;
  state: string;
  tone: string;
}) {
  return (
    <View style={styles.activityRow}>
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
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
    </View>
  );
}

function SessionsPanel({
  sessions,
  summary,
}: {
  sessions: SessionSummary[];
  summary: FeatureSummary | null;
}) {
  const latest = sessions[0];
  const endpoint = summary?.availability.sessions;

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={MessageCircle}
          label="Active"
          value={String(sessions.length)}
          detail="sessions"
          tone={colors.cyan}
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
        <Text style={styles.subsectionTitle}>Live queue</Text>
        <Text style={styles.counterText}>{sessions.length}</Text>
      </View>
      {sessions.slice(0, 10).map((session) => (
        <View key={session.id} style={styles.listRow}>
          <View style={styles.listIcon}>
            <MessageCircle color={colors.cyan} size={20} strokeWidth={2.1} />
          </View>
          <View style={styles.listText}>
            <Text style={styles.listTitle}>{session.title || session.id.slice(0, 8)}</Text>
            <Text style={styles.listDetail}>
              {session.message_count} messages - {lastUpdatedLabel(session)}
            </Text>
          </View>
          <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
        </View>
      ))}
      {sessions.length === 0 ? (
        endpoint?.ok === false ? (
          <EmptyState
            label="Sessions unavailable"
            detail={endpointErrorDetail(endpoint, "The gateway did not return sessions.")}
          />
        ) : (
          <EmptyState label="No sessions yet" detail="Create a Cybara session from the gateway." />
        )
      ) : null}
    </GlassPanel>
  );
}

function ToolsPanel({
  counts,
  summary,
}: {
  counts: FeatureCounts;
  summary: FeatureSummary | null;
}) {
  const agentRows =
    summary?.agents.map((agent) => ({
      id: agent.id,
      title: agent.name,
      detail: [agent.status, agent.model, agent.type].filter(Boolean).join(" - ") || "Configured",
      status: agent.status,
      type: agent.type,
    })) ?? [];
  const providerRows =
    summary?.providers.map((provider) => ({
      id: provider.id,
      title: provider.name,
      detail: `${provider.provider}${provider.is_default ? " - default" : ""}`,
      status: provider.is_default ? "default" : undefined,
      type: provider.provider,
    })) ?? [];

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.summaryGrid}>
        <SummaryTile
          Icon={Gauge}
          label="Tools"
          value={String(counts.tools)}
          detail="registered"
          tone={colors.green}
        />
        <SummaryTile
          Icon={ShieldCheck}
          label="Approvals"
          value={String(counts.approvals)}
          detail="pending"
          tone={counts.approvals > 0 ? colors.amber : colors.cyan}
        />
        <SummaryTile
          Icon={Bot}
          label="Agents"
          value={String(counts.agents)}
          detail="configured"
          tone={colors.cyan}
        />
        <SummaryTile
          Icon={Database}
          label="Providers"
          value={String(counts.providers)}
          detail="enabled"
          tone={colors.blueText}
        />
      </View>
      <SurfaceSection
        title="Agents"
        endpoint="agents"
        rows={agentRows}
        Icon={Bot}
        tone={colors.cyan}
        summary={summary}
        emptyDetail="No agents are configured on this gateway."
      />
      <SurfaceSection
        title="Providers"
        endpoint="providers"
        rows={providerRows}
        Icon={Database}
        tone={colors.blueText}
        summary={summary}
        emptyDetail="No providers are enabled on this gateway."
      />
      <SurfaceSection
        title="Tools"
        endpoint="tools"
        rows={summary?.tools ?? []}
        Icon={Wrench}
        tone={colors.green}
        summary={summary}
        emptyDetail="No tools were returned by the gateway."
        maxRows={8}
      />
      <SurfaceSection
        title="Approvals"
        endpoint="approvals"
        rows={summary?.approvals ?? []}
        Icon={ShieldCheck}
        tone={counts.approvals > 0 ? colors.amber : colors.green}
        summary={summary}
        emptyDetail="No pending approval requests."
      />
      <SurfaceSection
        title="Channels"
        endpoint="channels"
        rows={summary?.channels ?? []}
        Icon={Link2}
        tone={colors.cyan}
        summary={summary}
        emptyDetail="No communication channels are configured."
      />
      <SurfaceSection
        title="Tasks"
        endpoint="tasks"
        rows={summary?.tasks ?? []}
        Icon={CalendarCheck}
        tone={colors.blueText}
        summary={summary}
        emptyDetail="No scheduled tasks are configured."
      />
      <SurfaceSection
        title="Memory"
        endpoint="memory"
        rows={summary?.memory ?? []}
        Icon={Brain}
        tone={colors.green}
        summary={summary}
        emptyDetail="No memory files are indexed yet."
      />
      <SurfaceSection
        title="Recent Logs"
        endpoint="logs"
        rows={summary?.logs ?? []}
        Icon={ListTodo}
        tone={colors.textMuted}
        summary={summary}
        emptyDetail="No recent log activity was returned."
        maxRows={6}
      />
      <Text style={styles.subsectionTitle}>Runtime controls</Text>
      <View style={styles.listRow}>
        <View style={styles.listIcon}>
          <SquareTerminal color={colors.cyan} size={20} strokeWidth={2.1} />
        </View>
        <View style={styles.listText}>
          <Text style={styles.listTitle}>Terminal</Text>
          <Text style={styles.listDetail}>Remote shell surface from the gateway</Text>
        </View>
        <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
      </View>
      <View style={styles.listRow}>
        <View style={styles.listIcon}>
          <Activity color={colors.blueText} size={20} strokeWidth={2.1} />
        </View>
        <View style={styles.listText}>
          <Text style={styles.listTitle}>System Monitor</Text>
          <Text style={styles.listDetail}>CPU, memory, and disk telemetry from health checks</Text>
        </View>
        <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
      </View>
    </GlassPanel>
  );
}

function SurfaceSection({
  title,
  endpoint,
  rows,
  Icon,
  tone,
  summary,
  emptyDetail,
  maxRows = 4,
}: {
  title: string;
  endpoint: FeatureEndpointKey;
  rows: Array<RemoteItemSummary | ActivitySummary>;
  Icon: IconGlyph;
  tone: string;
  summary: FeatureSummary | null;
  emptyDetail: string;
  maxRows?: number;
}) {
  const state = summary?.availability[endpoint];
  const visibleRows = rows.slice(0, maxRows);

  return (
    <View style={styles.surfaceSection}>
      <View style={styles.subsectionHeader}>
        <Text style={styles.subsectionTitle}>{title}</Text>
        <Text style={styles.counterText}>{endpointStatusLabel(state)}</Text>
      </View>
      {!summary ? (
        <EmptyState label={`${title} loading`} detail="Refreshing from the gateway." />
      ) : state?.ok === false ? (
        <EmptyState
          label={`${title} unavailable`}
          detail={endpointErrorDetail(state, "The gateway did not return this surface.")}
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState label={`No ${title.toLowerCase()}`} detail={emptyDetail} />
      ) : (
        visibleRows.map((row) => (
          <View key={row.id} style={styles.listRow}>
            <View style={[styles.listIcon, { backgroundColor: `${tone}18` }]}>
              <Icon color={tone} size={20} strokeWidth={2.1} />
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
          </View>
        ))
      )}
    </View>
  );
}

function SettingsPanel({
  profile,
  summary,
  onDisconnect,
}: {
  profile: GatewayProfile;
  summary: FeatureSummary | null;
  onDisconnect: () => void;
}) {
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
        value={String(summary?.config.tool_approval_mode || "unknown")}
      />
      <SettingsRow
        Icon={ShieldCheck}
        label="Dangerous tools"
        value={String(summary?.config.dangerous_tool_policy || "unknown")}
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
  content: {
    gap: spacing.md,
    paddingBottom: 92,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
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
    backgroundColor: "rgba(16, 34, 47, 0.72)",
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
    backgroundColor: "rgba(255,255,255,0.065)",
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
  surfaceSection: {
    gap: spacing.sm,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryTile: {
    backgroundColor: "rgba(4, 13, 20, 0.34)",
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
    backgroundColor: "rgba(255,255,255,0.065)",
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
