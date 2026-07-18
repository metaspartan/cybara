import type { ChatAppearanceSettings } from "cybara-shared/chat-appearance";

export interface SystemAccessibilityPreferences {
  highContrast: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

export const defaultSystemAccessibilityPreferences: SystemAccessibilityPreferences = {
  highContrast: false,
  reduceMotion: false,
  reduceTransparency: false,
};

export function mergeSystemAccessibilityPreferences(
  appearance: ChatAppearanceSettings,
  system: SystemAccessibilityPreferences
): ChatAppearanceSettings {
  return {
    ...appearance,
    highContrast: appearance.highContrast || system.highContrast,
    reduceMotion: appearance.reduceMotion || system.reduceMotion,
    reduceTransparency: appearance.reduceTransparency || system.reduceTransparency,
  };
}
