import type { PropsWithChildren } from "react";
import { useEffect, useState } from "react";
import { BlurView } from "expo-blur";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, subscribeColors } from "../theme/liquidGlass";
import { useThemeControls } from "../theme/ThemeContext";

type GlassModule = typeof import("expo-glass-effect");
type GlassComponent = GlassModule["GlassView"];

// expo-glass-effect's iOS entry calls requireNativeViewManager() at module
// scope, which throws on a build that lacks the native module (e.g. a dev
// client not yet rebuilt, or iOS < 26). Loading it through a guarded dynamic
// import keeps the JS bundle from crashing and lets us fall back to a blurred
// surface until Liquid Glass is genuinely available.
let glassProbe: Promise<{ GlassView: GlassComponent | null }> | null = null;
let glassResolved: { GlassView: GlassComponent | null } | null = null;

function loadNativeGlass() {
  if (!glassProbe) {
    glassProbe = (async () => {
      try {
        const mod = await import("expo-glass-effect");
        return { GlassView: mod.isLiquidGlassAvailable() ? mod.GlassView : null };
      } catch {
        return { GlassView: null };
      }
    })().then((result) => {
      glassResolved = result;
      return result;
    });
  }
  return glassProbe;
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
  const [resolved, setResolved] = useState(glassResolved);

  useEffect(() => {
    if (glassResolved) return;
    let active = true;
    loadNativeGlass().then((result) => {
      if (active) setResolved(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const GlassView = resolved?.GlassView;
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
      blurMethod="dimezisBlurViewSdk31Plus"
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
