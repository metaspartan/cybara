import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatMetricNumber, type MetricsAvailability, type MetricsSnapshot } from "../lib/metrics";
import { colors, radius, spacing, subscribeColors, typography } from "../theme/liquidGlass";

export function MetricSection({
  children,
  detail,
  title,
}: {
  children: ReactNode;
  detail?: string;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.title}>{title}</Text>
        {detail ? (
          <Text numberOfLines={2} style={styles.detail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function MetricMicro({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.micro}>
      <Text style={styles.microLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.microValue}>
        {value}
      </Text>
    </View>
  );
}

export function MetricBreakdown({
  data,
  tone,
}: {
  data: Array<{ label: string; value: number }>;
  tone: string;
}) {
  const total = Math.max(
    1,
    data.reduce((sum, entry) => sum + entry.value, 0)
  );
  return (
    <View style={styles.breakdown}>
      {data.map((entry) => (
        <View key={entry.label} style={styles.breakdownRow}>
          <View style={styles.breakdownHeader}>
            <Text style={styles.rowTitle}>{entry.label}</Text>
            <Text style={styles.detail}>{formatMetricNumber(entry.value)}</Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.trackFill,
                {
                  backgroundColor: tone,
                  width: `${Math.max(2, (entry.value / total) * 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export function MetricBarChart({
  data,
  tone,
}: {
  data: Array<{ label: string; value: number }>;
  tone: string;
}) {
  const max = Math.max(1, ...data.map((entry) => entry.value));
  return (
    <View style={styles.barChart}>
      {data.map((entry) => (
        <View key={entry.label} style={styles.barSlot}>
          <View
            style={[
              styles.bar,
              {
                backgroundColor: tone,
                height: Math.max(3, (entry.value / max) * 58),
              },
            ]}
          />
          <Text numberOfLines={1} style={styles.barLabel}>
            {entry.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function MetricAreaChart({
  data,
  tone,
}: {
  data: Array<{ label: string; value: number; detail?: string }>;
  tone: string;
}) {
  const max = Math.max(1, ...data.map((entry) => entry.value));
  if (data.length === 0) {
    return <Text style={styles.detail}>No trend data yet</Text>;
  }
  return (
    <View style={styles.areaChart}>
      <View style={styles.areaColumns}>
        {data.map((entry, index) => (
          <View key={`${entry.label}-${index}`} style={styles.areaSlot}>
            <View
              style={[
                styles.areaColumn,
                {
                  backgroundColor: tone,
                  height: Math.max(5, (entry.value / max) * 82),
                  opacity: 0.16 + Math.min(0.68, (entry.value / max) * 0.68),
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.areaLabels}>
        <Text numberOfLines={1} style={styles.barLabel}>
          {data[0]?.label}
        </Text>
        <Text numberOfLines={1} style={styles.barLabel}>
          {data[data.length - 1]?.label}
        </Text>
      </View>
    </View>
  );
}

export function TokenHeatmap({
  tokenAnalysis,
  tone,
}: {
  tokenAnalysis: MetricsSnapshot["tokenAnalysis"];
  tone: string;
}) {
  const days = tokenAnalysis?.tokenHeatmap?.days || [];
  if (days.length === 0) {
    return <Text style={styles.detail}>No heatmap data yet</Text>;
  }
  return (
    <View style={styles.heatmap}>
      {days.map((day) => (
        <View key={day.date} style={styles.heatmapRow}>
          <Text style={styles.heatmapLabel}>{day.dayLabel}</Text>
          <View style={styles.heatmapCells}>
            {day.hours.map((hour) => (
              <View
                key={`${day.date}-${hour.hour}`}
                style={[
                  styles.heatmapCell,
                  {
                    backgroundColor: tone,
                    opacity: 0.08 + hour.intensity * 0.9,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function MetricShareRows({
  rows,
  tone,
}: {
  rows: Array<{
    label: string;
    value: string;
    detail?: string;
    amount: number;
    progress?: number;
    tone?: string;
  }>;
  tone: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.amount));
  if (rows.length === 0) {
    return <Text style={styles.detail}>No data yet</Text>;
  }
  return (
    <View style={styles.rows}>
      {rows.map((row) => (
        <View key={`${row.label}-${row.value}`} style={styles.shareRow}>
          <View style={styles.shareText}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {row.label}
            </Text>
            <Text numberOfLines={1} style={styles.detail}>
              {row.detail || row.value}
            </Text>
          </View>
          <View style={styles.shareValue}>
            <Text style={[styles.counter, { color: row.tone ?? tone }]}>{row.value}</Text>
            <View style={styles.trackSmall}>
              <View
                style={[
                  styles.trackFill,
                  {
                    backgroundColor: row.tone ?? tone,
                    width: `${Math.max(4, row.progress ?? (row.amount / max) * 100)}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

export function MetricTokenCloud({
  entries,
}: {
  entries: NonNullable<MetricsSnapshot["tokenAnalysis"]>["tokenCloud"] | undefined;
}) {
  const visible = entries?.slice(0, 20) || [];
  return (
    <View style={styles.cloud}>
      {visible.map((entry) => (
        <View key={`${entry.category}-${entry.token}`} style={styles.cloudPill}>
          <Text style={styles.cloudText}>{entry.token}</Text>
          <Text style={styles.cloudMeta}>{entry.category}</Text>
        </View>
      ))}
      {visible.length === 0 ? <Text style={styles.detail}>No token cloud data yet</Text> : null}
    </View>
  );
}

export function MetricEndpointGrid({
  availability,
}: {
  availability: MetricsAvailability | null | undefined;
}) {
  if (!availability) {
    return <Text style={styles.detail}>Loading metrics feeds</Text>;
  }
  return (
    <View style={styles.endpointGrid}>
      {Object.entries(availability).map(([key, endpoint]) => (
        <View key={key} style={styles.endpointPill}>
          <View
            style={[
              styles.endpointDot,
              { backgroundColor: endpoint.ok ? colors.green : colors.amber },
            ]}
          />
          <Text style={styles.endpointText}>{key}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    section: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: spacing.md,
      padding: spacing.md,
    },
    sectionHeader: {
      gap: 3,
    },
    title: {
      color: colors.text,
      fontSize: typography.heading,
      fontWeight: "800",
    },
    detail: {
      color: colors.textMuted,
      fontSize: typography.label,
    },
    rowTitle: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "800",
    },
    counter: {
      fontSize: typography.label,
      fontWeight: "900",
    },
    micro: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexBasis: "31%",
      flexGrow: 1,
      gap: 3,
      minHeight: 58,
      padding: spacing.sm,
    },
    microLabel: {
      color: colors.textDim,
      fontSize: typography.tiny,
      fontWeight: "800",
      textTransform: "uppercase",
    },
    microValue: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "900",
    },
    breakdown: {
      gap: spacing.sm,
    },
    breakdownRow: {
      gap: spacing.xs,
    },
    breakdownHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    track: {
      backgroundColor: colors.inset,
      borderRadius: 999,
      height: 9,
      overflow: "hidden",
    },
    trackSmall: {
      backgroundColor: colors.inset,
      borderRadius: 999,
      height: 5,
      overflow: "hidden",
      width: 90,
    },
    trackFill: {
      borderRadius: 999,
      height: "100%",
      minWidth: 2,
    },
    barChart: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: spacing.xs,
      minHeight: 92,
    },
    barSlot: {
      alignItems: "center",
      flex: 1,
      gap: spacing.xs,
      justifyContent: "flex-end",
      minWidth: 18,
    },
    bar: {
      borderRadius: 4,
      opacity: 0.86,
      width: "70%",
    },
    barLabel: {
      color: colors.textDim,
      fontSize: 9,
      maxWidth: 38,
    },
    areaChart: {
      gap: spacing.xs,
      minHeight: 112,
    },
    areaColumns: {
      alignItems: "flex-end",
      backgroundColor: colors.inset,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: "row",
      gap: 2,
      minHeight: 92,
      overflow: "hidden",
      paddingHorizontal: 6,
      paddingTop: 8,
    },
    areaSlot: {
      alignItems: "stretch",
      flex: 1,
      justifyContent: "flex-end",
      minWidth: 4,
    },
    areaColumn: {
      borderTopLeftRadius: 5,
      borderTopRightRadius: 5,
      minHeight: 5,
    },
    areaLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    heatmap: {
      gap: spacing.xs,
    },
    heatmapRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
    },
    heatmapLabel: {
      color: colors.textMuted,
      fontSize: typography.tiny,
      fontWeight: "800",
      width: 28,
    },
    heatmapCells: {
      flex: 1,
      flexDirection: "row",
      gap: 2,
    },
    heatmapCell: {
      borderRadius: 2,
      flex: 1,
      height: 9,
    },
    rows: {
      gap: spacing.sm,
    },
    shareRow: {
      alignItems: "center",
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 54,
      paddingTop: spacing.sm,
    },
    shareText: {
      flex: 1,
      gap: 2,
    },
    shareValue: {
      alignItems: "flex-end",
      gap: spacing.xs,
      minWidth: 104,
    },
    cloud: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    cloudPill: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      gap: 2,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    cloudText: {
      color: colors.text,
      fontSize: typography.label,
      fontWeight: "800",
    },
    cloudMeta: {
      color: colors.textDim,
      fontSize: 9,
      textTransform: "uppercase",
    },
    endpointGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    endpointPill: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    endpointDot: {
      borderRadius: 4,
      height: 8,
      width: 8,
    },
    endpointText: {
      color: colors.textMuted,
      fontSize: typography.tiny,
      fontWeight: "800",
    },
  });

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
