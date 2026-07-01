import type { PropsWithChildren } from "react";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme/liquidGlass";

export function GlassPanel({
  children,
  contentStyle,
  style,
  elevated = false,
}: PropsWithChildren<{
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}>) {
  return (
    <BlurView
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={elevated ? 46 : 32}
      tint="dark"
      style={[styles.panel, elevated && styles.elevated, elevated && shadows.glass, style]}
    >
      <View pointerEvents="none" style={styles.liquidWash} />
      <View pointerEvents="none" style={styles.liquidHighlight} />
      <View style={[styles.panelFill, contentStyle]}>{children}</View>
    </BlurView>
  );
}

export function GlassButton({
  label,
  detail,
  onPress,
  selected,
}: {
  label: string;
  detail?: string;
  onPress?: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
      {detail ? <Text style={styles.buttonDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

export function MetricPill({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: 1,
    overflow: "hidden",
  },
  liquidWash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.22)",
  },
  liquidHighlight: {
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderRadius: 999,
    height: 1,
    left: 14,
    opacity: 0.75,
    position: "absolute",
    right: 14,
    top: 1,
  },
  panelFill: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  elevated: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.glassElevated,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(8, 8, 10, 0.9)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  selected: {
    borderColor: colors.cyan,
    backgroundColor: "rgba(12, 50, 64, 0.36)",
  },
  pressed: {
    backgroundColor: colors.glassPressed,
  },
  buttonLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "700",
  },
  buttonDetail: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: typography.tiny,
  },
  metric: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(8, 8, 10, 0.78)",
    padding: spacing.md,
  },
  metricValue: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: "800",
  },
  metricLabel: {
    marginTop: 2,
    color: colors.textDim,
    fontSize: typography.tiny,
    textTransform: "uppercase",
  },
});
