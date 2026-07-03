import type { PropsWithChildren } from "react";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import {
  colors,
  radius,
  shadows,
  spacing,
  subscribeColors,
  typography,
} from "../theme/liquidGlass";
import { useThemeControls } from "../theme/ThemeContext";
import { useNativeGlassView } from "./glassSupport";

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
  const { scheme } = useThemeControls();
  const GlassView = useNativeGlassView();

  // On iOS 26 use the genuine Liquid Glass material for every panel (this is the
  // app's primary surface, used ~20×). The real material supplies its own
  // translucency and edge highlight, so the BlurView wash/highlight overlays are
  // only needed on the fallback path.
  if (GlassView) {
    // Shape only — no opaque fill. The native material IS the surface; painting
    // colors.glass over it (0.82-opaque white in light mode) flattened it back
    // into a solid card and defeated the Liquid Glass look.
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={false}
        colorScheme={scheme}
        style={[styles.panelShape, elevated && styles.panelShapeElevated, style]}
      >
        <View style={[styles.panelFill, contentStyle]}>{children}</View>
      </GlassView>
    );
  }

  return (
    <BlurView
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={elevated ? 46 : 32}
      tint={scheme === "light" ? "light" : "dark"}
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
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityRole="button"
      accessibilityState={{ selected: selected === true }}
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

const makeStyles = () =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.glass,
      borderRadius: radius.lg,
      borderColor: colors.border,
      borderWidth: 1,
      overflow: "hidden",
    },
    // Native-glass surfaces: keep the rounded clip + hairline edge, but let the
    // real material provide the translucency (no opaque background fill).
    panelShape: {
      borderRadius: radius.lg,
      borderColor: colors.border,
      borderWidth: 1,
      overflow: "hidden",
    },
    panelShapeElevated: {
      borderColor: colors.borderStrong,
    },
    liquidWash: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.wash,
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
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      justifyContent: "center",
    },
    selected: {
      borderColor: colors.cyan,
      backgroundColor: colors.softCyan,
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
      backgroundColor: colors.surface,
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

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
