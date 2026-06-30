import type { PropsWithChildren } from "react";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing, typography } from "../theme/liquidGlass";

export function GlassPanel({
  children,
  contentStyle,
  style,
  elevated = false,
}: PropsWithChildren<{ contentStyle?: StyleProp<ViewStyle>; style?: StyleProp<ViewStyle>; elevated?: boolean }>) {
  return (
    <BlurView
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={elevated ? 58 : 38}
      tint="systemUltraThinMaterialDark"
      style={[styles.panel, elevated && styles.elevated, elevated && shadows.glass, style]}
    >
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
      style={({ pressed }) => [styles.button, selected && styles.selected, pressed && styles.pressed]}
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glass,
    overflow: "hidden",
  },
  panelFill: {
    padding: spacing.lg,
    gap: spacing.md,
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
    backgroundColor: "rgba(19, 39, 53, 0.58)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  selected: {
    borderColor: colors.cyan,
    backgroundColor: "rgba(47, 117, 142, 0.38)",
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
    backgroundColor: "rgba(255, 255, 255, 0.045)",
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
