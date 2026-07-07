import type { PropsWithChildren } from "react";
import { BlurView } from "expo-blur";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, subscribeColors } from "../theme/liquidGlass";
import { useThemeControls } from "../theme/ThemeContext";
import { useNativeGlassContainer, useNativeGlassView } from "./glassSupport";

/**
 * Groups adjacent glass surfaces so they merge correctly on iOS 26 (Apple's
 * recommended pattern). On the native path it renders a GlassContainer whose
 * `spacing` controls when neighboring glass elements start blending; elsewhere
 * it's a plain View, so callers can always wrap a cluster of panels/tiles.
 */
export function GlassGroup({
  children,
  style,
  spacing = 12,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; spacing?: number }>) {
  const GlassContainer = useNativeGlassContainer();
  if (GlassContainer) {
    return (
      <GlassContainer spacing={spacing} style={style}>
        {children}
      </GlassContainer>
    );
  }
  return <View style={style}>{children}</View>;
}

export function LiquidGlass({
  children,
  style,
  contentStyle,
  intensity = 40,
  tintColor,
  interactive = false,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
  tintColor?: string;
  interactive?: boolean;
}>) {
  const { scheme } = useThemeControls();
  const GlassView = useNativeGlassView();

  if (GlassView) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        colorScheme={scheme}
        tintColor={tintColor}
        style={[styles.base, style]}
      >
        <View style={[styles.content, contentStyle]}>{children}</View>
      </GlassView>
    );
  }

  return (
    <BlurView
      intensity={intensity}
      tint={scheme === "light" ? "light" : "dark"}
      style={[styles.base, styles.fallbackBorder, style]}
    >
      <View pointerEvents="none" style={styles.fallbackFill} />
      <View pointerEvents="none" style={styles.sheen} />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </BlurView>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    base: {
      overflow: "hidden",
    },
    content: {
      flex: 1,
    },
    fallbackBorder: {
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
    },
    fallbackFill: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.chrome,
    },
    sheen: {
      backgroundColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 999,
      height: 1,
      left: 16,
      opacity: 0.7,
      position: "absolute",
      right: 16,
      top: 0.5,
    },
  });

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
