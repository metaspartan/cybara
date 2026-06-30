import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Activity,
  Bot,
  Box,
  Brain,
  CalendarCheck,
  ChevronRight,
  CircuitBoard,
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
import { CybaraMobileApi, type FeatureSummary, type SessionSummary } from "../lib/api";
import type { GatewayProfile } from "../lib/connection";
import { colors, radius, spacing, typography } from "../theme/liquidGlass";

type IconGlyph = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
type TabKey = "overview" | "sessions" | "tools" | "settings";

interface ModuleCard {
  key: string;
  label: string;
  detail: string;
  value: string;
  Icon: IconGlyph;
  tab: TabKey;
}

const tabItems: Array<{ key: TabKey; label: string; Icon: IconGlyph }> = [
  { key: "overview", label: "Overview", Icon: House },
  { key: "sessions", label: "Sessions", Icon: UsersRound },
  { key: "tools", label: "Tools", Icon: Wrench },
  { key: "settings", label: "Settings", Icon: Settings },
];

const sparkBars = [8, 10, 7, 12, 9, 14, 20, 12, 8, 13, 11, 16, 9, 13, 18, 12, 25];

function formatUptime(seconds?: number): string {
  if (!seconds || seconds < 0) return "checking";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function compactHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

function lastUpdatedLabel(session: SessionSummary): string {
  const updated = Date.parse(session.updated_at);
  if (!Number.isFinite(updated)) return "recent";
  const minutes = Math.max(0, Math.round((Date.now() - updated) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function asCount(value: unknown[] | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

function showValue(label: string, value: string) {
  Alert.alert(label, value);
}

export function DashboardScreen({ profile, onDisconnect }: { profile: GatewayProfile; onDisconnect: () => void }) {
  const api = useMemo(() => new CybaraMobileApi(profile), [profile]);
  const [summary, setSummary] = useState<FeatureSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
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
  const sessionCount = sessions.length;
  const agentCount = summary?.agents.length ?? 0;
  const providerCount = summary?.providers.length ?? 0;
  const toolCount = asCount(summary?.tools);
  const approvalCount = asCount(summary?.approvals);
  const channelCount = asCount(summary?.channels);
  const taskCount = asCount(summary?.tasks);
  const memoryCount = asCount(summary?.memory);
  const logCount = asCount(summary?.logs);

  const modules: ModuleCard[] = [
    {
      key: "sessions",
      label: "Chat Sessions",
      detail: sessionCount === 1 ? "1 active" : `${sessionCount} active`,
      value: String(sessionCount),
      Icon: MessageCircle,
      tab: "sessions",
    },
    {
      key: "agents",
      label: "Agents",
      detail: agentCount === 1 ? "1 configured" : `${agentCount} configured`,
      value: String(agentCount),
      Icon: Bot,
      tab: "tools",
    },
    {
      key: "providers",
      label: "Providers",
      detail: providerCount === 1 ? "1 enabled" : `${providerCount} enabled`,
      value: String(providerCount),
      Icon: Box,
      tab: "tools",
    },
    {
      key: "tools",
      label: "Tools & Approvals",
      detail: approvalCount > 0 ? `${approvalCount} pending` : `${toolCount} tools`,
      value: String(toolCount),
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
      detail: channelCount === 1 ? "1 configured" : `${channelCount} configured`,
      value: String(channelCount),
      Icon: Link2,
      tab: "tools",
    },
    {
      key: "tasks",
      label: "Tasks",
      detail: taskCount === 1 ? "1 running" : `${taskCount} running`,
      value: String(taskCount),
      Icon: CalendarCheck,
      tab: "tools",
    },
    {
      key: "memory",
      label: "Memory",
      detail: memoryCount > 0 ? `${memoryCount} items` : "Vector store",
      value: String(memoryCount),
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
      detail: logCount > 0 ? `${logCount} events` : "System logs",
      value: String(logCount),
      Icon: ListTodo,
      tab: "tools",
    },
  ];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl tintColor={colors.cyan} refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={styles.header}>
          <View style={styles.brandWrap}>
            <View style={styles.logoMark}>
              <CircuitBoard color={colors.cyan} size={30} strokeWidth={2.5} />
            </View>
            <Text style={styles.title}>Cybara</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => setActiveTab("settings")}>
            <Settings color={colors.text} size={22} strokeWidth={2.1} />
          </Pressable>
        </View>

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
            <StatusMetric Icon={HeartPulse} label="Health" value={healthy ? "Healthy" : "Check"} tone={statusColor} />
            <StatusMetric Icon={Wifi} label="API" value={health ? "Online" : "Waiting"} tone={colors.cyan} />
            <StatusMetric Icon={UsersRound} label="Sessions" value={`${sessionCount} active`} tone={colors.blueText} />
            <StatusMetric Icon={Box} label="Providers" value={`${providerCount} enabled`} tone={colors.textMuted} />
          </View>

          <View style={styles.detailTable}>
            <DetailRow label="Gateway URL" value={profile.baseUrl} onPress={() => showValue("Gateway URL", profile.baseUrl)} />
            <DetailRow label="API Base" value="/api/v1" onPress={() => showValue("API Base", "/api/v1")} />
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

        {activeTab === "overview" ? (
          <OverviewPanel modules={modules} sessions={sessions} selectTab={setActiveTab} />
        ) : null}
        {activeTab === "sessions" ? <SessionsPanel sessions={sessions} /> : null}
        {activeTab === "tools" ? (
          <ToolsPanel
            agentCount={agentCount}
            providerCount={providerCount}
            toolCount={toolCount}
            approvalCount={approvalCount}
            channelCount={channelCount}
            taskCount={taskCount}
            memoryCount={memoryCount}
            logCount={logCount}
          />
        ) : null}
        {activeTab === "settings" ? (
          <SettingsPanel profile={profile} summary={summary} onDisconnect={onDisconnect} />
        ) : null}
      </ScrollView>

      <GlassPanel elevated style={styles.tabBar}>
        <View style={styles.tabBarFill}>
          {tabItems.map(({ key, label, Icon }) => {
            const selected = activeTab === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActiveTab(key)}
                style={[styles.tabItem, selected && styles.tabItemActive]}
              >
                <Icon color={selected ? colors.cyan : colors.textMuted} size={24} strokeWidth={2.2} />
                <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{label}</Text>
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

function DetailRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
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
  selectTab,
}: {
  modules: ModuleCard[];
  sessions: SessionSummary[];
  selectTab: (tab: TabKey) => void;
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>Remote management</Text>
      <View style={styles.moduleGrid}>
        {modules.slice(0, 9).map((module) => (
          <ModuleTile key={module.key} module={module} onPress={() => selectTab(module.tab)} />
        ))}
        <Pressable style={[styles.moduleTile, styles.monitorTile]} onPress={() => selectTab("tools")}>
          <View style={styles.moduleIcon}>
            <Activity color={colors.text} size={23} strokeWidth={2.1} />
          </View>
          <View style={styles.monitorText}>
            <Text style={styles.moduleTitle}>System Monitor</Text>
            <Text style={styles.moduleDetail}>CPU ready  RAM ready  Disk ready</Text>
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
        {sessions.slice(0, 3).map((session, index) => (
          <ActivityRow
            key={session.id}
            Icon={index === 2 ? Bot : index === 1 ? SquareTerminal : MessageCircle}
            title={session.title || session.id.slice(0, 8)}
            detail={`${session.agent_id || "agent"} - ${lastUpdatedLabel(session)}`}
            state={index === 2 ? "Idle" : "Active"}
            tone={index === 2 ? colors.amber : colors.green}
          />
        ))}
        {sessions.length === 0 ? (
          <>
            <ActivityRow Icon={MessageCircle} title="No active sessions" detail="Start a chat from the gateway" state="Idle" tone={colors.amber} />
            <ActivityRow Icon={Bot} title="Agents ready" detail="Remote orchestration available" state="Ready" tone={colors.green} />
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

function SessionsPanel({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.panelHeader}>
        <View style={styles.panelHeaderTitle}>
          <MessageCircle color={colors.cyan} size={22} strokeWidth={2.1} />
          <Text style={styles.panelTitle}>Chat Sessions</Text>
        </View>
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
      {sessions.length === 0 ? <EmptyState label="No sessions yet" detail="Create a Cybara session from the gateway." /> : null}
    </GlassPanel>
  );
}

function ToolsPanel({
  agentCount,
  providerCount,
  toolCount,
  approvalCount,
  channelCount,
  taskCount,
  memoryCount,
  logCount,
}: {
  agentCount: number;
  providerCount: number;
  toolCount: number;
  approvalCount: number;
  channelCount: number;
  taskCount: number;
  memoryCount: number;
  logCount: number;
}) {
  const rows = [
    { label: "Agents", detail: `${agentCount} configured`, Icon: Bot, tone: colors.cyan },
    { label: "Providers", detail: `${providerCount} enabled`, Icon: Database, tone: colors.blueText },
    { label: "Tools", detail: `${toolCount} registered`, Icon: Wrench, tone: colors.green },
    { label: "Approvals", detail: approvalCount > 0 ? `${approvalCount} pending` : "No pending approvals", Icon: ShieldCheck, tone: colors.amber },
    { label: "Channels", detail: `${channelCount} configured`, Icon: Link2, tone: colors.cyan },
    { label: "Tasks", detail: `${taskCount} scheduled or running`, Icon: CalendarCheck, tone: colors.blueText },
    { label: "Memory", detail: memoryCount > 0 ? `${memoryCount} records` : "Vector store available", Icon: Brain, tone: colors.green },
    { label: "Logs", detail: logCount > 0 ? `${logCount} recent events` : "No recent events loaded", Icon: ListTodo, tone: colors.textMuted },
    { label: "Terminal", detail: "Remote shell surface", Icon: SquareTerminal, tone: colors.cyan },
  ];

  return (
    <GlassPanel elevated style={styles.detailPanel}>
      <View style={styles.panelHeader}>
        <View style={styles.panelHeaderTitle}>
          <Gauge color={colors.cyan} size={22} strokeWidth={2.1} />
          <Text style={styles.panelTitle}>Tools & Runtime</Text>
        </View>
      </View>
      {rows.map(({ label, detail, Icon, tone }) => (
        <View key={label} style={styles.listRow}>
          <View style={[styles.listIcon, { backgroundColor: `${tone}18` }]}>
            <Icon color={tone} size={20} strokeWidth={2.1} />
          </View>
          <View style={styles.listText}>
            <Text style={styles.listTitle}>{label}</Text>
            <Text style={styles.listDetail}>{detail}</Text>
          </View>
          <ChevronRight color={colors.textMuted} size={20} strokeWidth={2} />
        </View>
      ))}
    </GlassPanel>
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
      <View style={styles.panelHeader}>
        <View style={styles.panelHeaderTitle}>
          <Settings color={colors.cyan} size={22} strokeWidth={2.1} />
          <Text style={styles.panelTitle}>Gateway Settings</Text>
        </View>
      </View>
      <SettingsRow Icon={Wifi} label="Gateway" value={profile.baseUrl} />
      <SettingsRow Icon={ShieldCheck} label="Device token" value={profile.deviceId || "manual key"} />
      <SettingsRow Icon={Zap} label="Tool approval" value={String(summary?.config.tool_approval_mode || "unknown")} />
      <SettingsRow Icon={ShieldCheck} label="Dangerous tools" value={String(summary?.config.dangerous_tool_policy || "unknown")} />
      <SettingsRow Icon={Cpu} label="Runtime" value={summary?.health?.version || "pending"} />
      <GlassButton label="Disconnect gateway" detail="Remove active mobile profile" onPress={onDisconnect} />
    </GlassPanel>
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
    gap: spacing.lg,
    paddingBottom: 124,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  brandWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  logoMark: {
    alignItems: "center",
    borderColor: "rgba(85, 216, 255, 0.48)",
    borderRadius: radius.md,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: colors.borderStrong,
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  gatewayPanel: {
    gap: spacing.md,
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
    fontSize: 25,
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
    minHeight: 50,
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
    minHeight: 48,
  },
  metricIcon: {
    alignItems: "center",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
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
    minHeight: 56,
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
    height: 38,
    justifyContent: "center",
    width: 44,
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
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  disclosureText: {
    color: colors.cyan,
    fontSize: typography.body,
    fontWeight: "700",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 24,
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
    minHeight: 128,
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
    fontSize: 17,
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
    minHeight: 84,
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
    minHeight: 68,
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
    bottom: 6,
    left: 0,
    position: "absolute",
    right: 0,
  },
  tabBarFill: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  tabItem: {
    alignItems: "center",
    borderRadius: radius.lg,
    flex: 1,
    gap: 4,
    minHeight: 64,
    justifyContent: "center",
  },
  tabItemActive: {
    backgroundColor: "rgba(85, 216, 255, 0.16)",
    borderColor: "rgba(190, 232, 255, 0.32)",
    borderWidth: 1,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: typography.label,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: colors.cyan,
  },
});
