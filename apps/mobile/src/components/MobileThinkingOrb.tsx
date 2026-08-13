import { useEffect, useState } from "react";
import { Animated, type StyleProp, StyleSheet, type TextStyle, View } from "react-native";
import { useSystemAccessibility } from "../accessibility/SystemAccessibilityContext";
import { useTheme } from "../theme/ThemeContext";

export type MobileThinkingOrbState = "composing" | "solving";

export function MobileThinkingOrb({
  reduceMotion: reduceMotionOverride,
  state,
  size = 14,
}: {
  reduceMotion?: boolean;
  state: MobileThinkingOrbState;
  size?: number;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const colors = useTheme();
  const { reduceMotion: systemReduceMotion } = useSystemAccessibility();
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(0.45);
      return;
    }
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: state === "composing" ? 1200 : 950,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, state]);

  const rotation = progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const pulse = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.55, 1, 0.55],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.78, 1.08, 0.78],
  });

  if (state === "solving") {
    return (
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.orb,
          { height: size, opacity: pulse, transform: [{ rotate: rotation }], width: size },
        ]}
      >
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={[
              styles.solvingDot,
              {
                backgroundColor: colors.textMuted,
                height: Math.max(2, size * 0.24),
                transform: [{ rotate: `${index * 120}deg` }, { translateY: -size * 0.34 }],
                width: Math.max(2, size * 0.24),
              },
            ]}
          />
        ))}
      </Animated.View>
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.orb, { height: size, width: size }]}
    >
      <Animated.View
        style={[
          styles.composingOuter,
          {
            borderColor: colors.textMuted,
            height: size,
            opacity: pulse,
            transform: [{ scale }],
            width: size,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.composingInner,
          {
            backgroundColor: colors.textMuted,
            height: size * 0.42,
            opacity: pulse,
            transform: [{ scale }],
            width: size * 0.42,
          },
        ]}
      />
    </View>
  );
}

export function MobileLiveStatusText({
  children,
  reduceMotion: reduceMotionOverride,
  style,
}: {
  children: string;
  reduceMotion?: boolean;
  style: StyleProp<TextStyle>;
}) {
  const [progress] = useState(() => new Animated.Value(0.72));
  const { reduceMotion: systemReduceMotion } = useSystemAccessibility();
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0.48, duration: 700, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  return (
    <Animated.Text selectable style={[style, { opacity: progress }]}>
      {children}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  composingInner: {
    borderRadius: 999,
    position: "absolute",
  },
  composingOuter: {
    borderRadius: 999,
    borderWidth: 1.25,
    position: "absolute",
  },
  orb: {
    alignItems: "center",
    justifyContent: "center",
  },
  solvingDot: {
    borderRadius: 999,
    position: "absolute",
  },
});
