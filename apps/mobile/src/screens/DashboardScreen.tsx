import { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { GlassButton, GlassPanel, MetricPill } from "../components/Glass";
import { CybaraMobileApi, type FeatureSummary } from "../lib/api";
import type { GatewayProfile } from "../lib/connection";
import { colors, spacing, typography } from "../theme/liquidGlass";

const modules = [
  ["Sessions", "Chat history and artifacts"],
  ["Agents", "Models, loops, subagents"],
  ["Providers", "Keys and model routing"],
  ["Tools", "Approvals and policies"],
  ["Wallet", "Access and spend policy"],
  ["Channels", "DMs, pairings, webhooks"],
  ["Tasks", "Schedules and runs"],
  ["Memory", "Search and durable notes"],
  ["Terminal", "Remote terminal surfaces"],
  ["Logs", "Activity and system traces"],
] as const;

export function DashboardScreen({ profile, onDisconnect }: { profile: GatewayProfile; onDisconnect: () => void }) {
  const api = useMemo(() => new CybaraMobileApi(profile), [profile]);
  const [summary, setSummary] = useState<FeatureSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setSummary(await api.featureSummary());
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [profile.id]);

  const health = summary?.health;
  const statusColor = health?.status === "healthy" ? colors.green : colors.amber;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl tintColor={colors.cyan} refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Cybara</Text>
          <Text style={styles.subtitle}>{profile.name}</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      <GlassPanel elevated style={styles.hero}>
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.panelTitle}>Gateway</Text>
            <Text style={styles.url}>{profile.baseUrl}</Text>
          </View>
          <Text style={[styles.status, { color: statusColor }]}>{health?.status || "checking"}</Text>
        </View>
        <View style={styles.metrics}>
          <MetricPill label="Sessions" value={summary?.sessions.length ?? "-"} />
          <MetricPill label="Agents" value={summary?.agents.length ?? "-"} />
          <MetricPill label="Providers" value={summary?.providers.length ?? "-"} />
        </View>
        <View style={styles.actions}>
          <GlassButton label="Refresh" detail="Pull latest API state" onPress={refresh} />
          <GlassButton label="Disconnect" detail="Switch gateway" onPress={onDisconnect} />
        </View>
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.panelTitle}>Live sessions</Text>
        {(summary?.sessions || []).slice(0, 4).map((session) => (
          <View key={session.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{session.title || session.id.slice(0, 8)}</Text>
              <Text style={styles.rowSub}>{session.message_count} messages · {new Date(session.updated_at).toLocaleString()}</Text>
            </View>
          </View>
        ))}
        {summary && summary.sessions.length === 0 ? <Text style={styles.empty}>No sessions yet.</Text> : null}
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.panelTitle}>Remote surfaces</Text>
        <View style={styles.moduleGrid}>
          {modules.map(([label, detail]) => (
            <View key={label} style={styles.moduleCell}>
              <GlassButton label={label} detail={detail} />
            </View>
          ))}
        </View>
      </GlassPanel>

      <GlassPanel style={styles.card}>
        <Text style={styles.panelTitle}>Settings summary</Text>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Tool approval</Text>
          <Text style={styles.rowSub}>{String(summary?.config.tool_approval_mode || "unknown")}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Dangerous tools</Text>
          <Text style={styles.rowSub}>{String(summary?.config.dangerous_tool_policy || "unknown")}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Wallet policy</Text>
          <Text style={styles.rowSub}>{summary?.walletPolicy ? "loaded" : "unavailable"}</Text>
        </View>
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: 96,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  hero: {
    gap: spacing.lg,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  panelTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: "800",
  },
  url: {
    color: colors.textMuted,
    fontSize: typography.label,
    marginTop: 4,
  },
  status: {
    fontSize: typography.label,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metrics: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  card: {
    gap: spacing.md,
  },
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  rowText: {
    gap: 3,
  },
  rowTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
  rowSub: {
    color: colors.textMuted,
    fontSize: typography.label,
  },
  empty: {
    color: colors.textDim,
  },
  moduleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  moduleCell: {
    width: "48%",
  },
});
