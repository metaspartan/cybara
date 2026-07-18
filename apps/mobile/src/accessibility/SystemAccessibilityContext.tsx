import type { ChatAppearanceSettings } from "cybara-shared/chat-appearance";
import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import {
  defaultSystemAccessibilityPreferences,
  mergeSystemAccessibilityPreferences,
  type SystemAccessibilityPreferences,
} from "../lib/systemAccessibility";

const SystemAccessibilityContext = createContext(defaultSystemAccessibilityPreferences);
let currentPreferences = defaultSystemAccessibilityPreferences;
const preferenceListeners = new Set<() => void>();

function publishPreferences(preferences: SystemAccessibilityPreferences): void {
  currentPreferences = preferences;
  for (const listener of preferenceListeners) listener();
}

function updatePreference(preference: Partial<SystemAccessibilityPreferences>): void {
  publishPreferences({ ...currentPreferences, ...preference });
}

async function readSystemPreferences(): Promise<SystemAccessibilityPreferences> {
  const [reduceMotion, reduceTransparency, highContrast] = await Promise.all([
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
    Platform.OS === "ios"
      ? AccessibilityInfo.isReduceTransparencyEnabled().catch(() => false)
      : Promise.resolve(false),
    Platform.OS === "ios"
      ? AccessibilityInfo.isDarkerSystemColorsEnabled().catch(() => false)
      : AccessibilityInfo.isHighTextContrastEnabled().catch(() => false),
  ]);
  return { highContrast, reduceMotion, reduceTransparency };
}

function subscribeSystemPreferences(listener: () => void): () => void {
  preferenceListeners.add(listener);
  let active = true;
  void readSystemPreferences().then((preferences) => {
    if (active) publishPreferences(preferences);
  });
  const motionSubscription = AccessibilityInfo.addEventListener(
    "reduceMotionChanged",
    (reduceMotion) => updatePreference({ reduceMotion })
  );
  const transparencySubscription =
    Platform.OS === "ios"
      ? AccessibilityInfo.addEventListener("reduceTransparencyChanged", (reduceTransparency) =>
          updatePreference({ reduceTransparency })
        )
      : null;
  const contrastSubscription =
    Platform.OS === "ios"
      ? AccessibilityInfo.addEventListener("darkerSystemColorsChanged", (highContrast) =>
          updatePreference({ highContrast })
        )
      : AccessibilityInfo.addEventListener("highTextContrastChanged", (highContrast) =>
          updatePreference({ highContrast })
        );
  return () => {
    active = false;
    preferenceListeners.delete(listener);
    motionSubscription.remove();
    transparencySubscription?.remove();
    contrastSubscription.remove();
  };
}

function getSystemPreferences(): SystemAccessibilityPreferences {
  return currentPreferences;
}

export function SystemAccessibilityProvider({ children }: { children: ReactNode }) {
  const preferences = useSyncExternalStore(
    subscribeSystemPreferences,
    getSystemPreferences,
    getSystemPreferences
  );

  return (
    <SystemAccessibilityContext.Provider value={preferences}>
      {children}
    </SystemAccessibilityContext.Provider>
  );
}

export function useSystemAccessibility(): SystemAccessibilityPreferences {
  return useContext(SystemAccessibilityContext);
}

export function useEffectiveChatAppearance(
  appearance: ChatAppearanceSettings
): ChatAppearanceSettings {
  const system = useSystemAccessibility();
  return useMemo(
    () => mergeSystemAccessibilityPreferences(appearance, system),
    [appearance, system]
  );
}
