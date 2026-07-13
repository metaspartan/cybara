export const chatFontSizeOptions = [
  { value: "compact", label: "Compact", pixels: 13 },
  { value: "standard", label: "Standard", pixels: 14 },
  { value: "large", label: "Large", pixels: 16 },
  { value: "extra_large", label: "Extra large", pixels: 18 },
] as const;

export const chatCodeFontSizeOptions = [
  { value: "compact", label: "Compact", pixels: 11 },
  { value: "standard", label: "Standard", pixels: 12 },
  { value: "large", label: "Large", pixels: 14 },
] as const;

export const chatLineSpacingOptions = [
  { value: "compact", label: "Compact", lineHeight: 1.45 },
  { value: "comfortable", label: "Comfortable", lineHeight: 1.6 },
  { value: "spacious", label: "Spacious", lineHeight: 1.8 },
] as const;

export type ChatFontSize = (typeof chatFontSizeOptions)[number]["value"];
export type ChatCodeFontSize = (typeof chatCodeFontSizeOptions)[number]["value"];
export type ChatLineSpacing = (typeof chatLineSpacingOptions)[number]["value"];

export interface ChatAppearanceSettings {
  fontSize: ChatFontSize;
  codeFontSize: ChatCodeFontSize;
  lineSpacing: ChatLineSpacing;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
  underlineLinks: boolean;
}

export const DEFAULT_CHAT_APPEARANCE_SETTINGS: ChatAppearanceSettings = {
  fontSize: "standard",
  codeFontSize: "standard",
  lineSpacing: "comfortable",
  reduceMotion: false,
  reduceTransparency: false,
  highContrast: false,
  underlineLinks: false,
};

const chatFontSizes = new Set<string>(chatFontSizeOptions.map((option) => option.value));
const chatCodeFontSizes = new Set<string>(chatCodeFontSizeOptions.map((option) => option.value));
const chatLineSpacings = new Set<string>(chatLineSpacingOptions.map((option) => option.value));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeOption<T extends string>(
  value: unknown,
  options: Set<string>,
  fallback: T
): T {
  return typeof value === "string" && options.has(value) ? (value as T) : fallback;
}

export function normalizeChatAppearanceSettings(value: unknown): ChatAppearanceSettings {
  const record = asRecord(value);
  return {
    fontSize: normalizeOption(
      record.fontSize ?? record.font_size,
      chatFontSizes,
      DEFAULT_CHAT_APPEARANCE_SETTINGS.fontSize
    ),
    codeFontSize: normalizeOption(
      record.codeFontSize ?? record.code_font_size,
      chatCodeFontSizes,
      DEFAULT_CHAT_APPEARANCE_SETTINGS.codeFontSize
    ),
    lineSpacing: normalizeOption(
      record.lineSpacing ?? record.line_spacing,
      chatLineSpacings,
      DEFAULT_CHAT_APPEARANCE_SETTINGS.lineSpacing
    ),
    reduceMotion:
      typeof (record.reduceMotion ?? record.reduce_motion) === "boolean"
        ? Boolean(record.reduceMotion ?? record.reduce_motion)
        : DEFAULT_CHAT_APPEARANCE_SETTINGS.reduceMotion,
    reduceTransparency:
      typeof (record.reduceTransparency ?? record.reduce_transparency) === "boolean"
        ? Boolean(record.reduceTransparency ?? record.reduce_transparency)
        : DEFAULT_CHAT_APPEARANCE_SETTINGS.reduceTransparency,
    highContrast:
      typeof (record.highContrast ?? record.high_contrast) === "boolean"
        ? Boolean(record.highContrast ?? record.high_contrast)
        : DEFAULT_CHAT_APPEARANCE_SETTINGS.highContrast,
    underlineLinks:
      typeof (record.underlineLinks ?? record.underline_links) === "boolean"
        ? Boolean(record.underlineLinks ?? record.underline_links)
        : DEFAULT_CHAT_APPEARANCE_SETTINGS.underlineLinks,
  };
}

export function readChatAppearanceFromConfig(
  config: Record<string, unknown> | undefined
): ChatAppearanceSettings | undefined {
  const value = config?.chat_appearance ?? config?.chatAppearance;
  return value === undefined ? undefined : normalizeChatAppearanceSettings(value);
}

export function getChatFontSizePixels(value: ChatFontSize): number {
  return (
    chatFontSizeOptions.find((option) => option.value === value)?.pixels ??
    chatFontSizeOptions[1].pixels
  );
}

export function getChatCodeFontSizePixels(value: ChatCodeFontSize): number {
  return (
    chatCodeFontSizeOptions.find((option) => option.value === value)?.pixels ??
    chatCodeFontSizeOptions[1].pixels
  );
}

export function getChatLineHeight(value: ChatLineSpacing): number {
  return (
    chatLineSpacingOptions.find((option) => option.value === value)?.lineHeight ??
    chatLineSpacingOptions[1].lineHeight
  );
}
