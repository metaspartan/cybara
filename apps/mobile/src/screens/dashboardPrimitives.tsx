import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";

export type IconGlyph = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

export function SummaryTile({
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

export function GatewayDetailPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.gatewayDetailPill}>
      <Text style={styles.gatewayDetailLabel}>{label}</Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.gatewayDetailValue}>
        {value}
      </Text>
    </View>
  );
}

export function SettingsRow({ Icon, label, value }: { Icon: IconGlyph; label: string; value: string }) {
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

export function EmptyState({ label, detail }: { label: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{label}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}
