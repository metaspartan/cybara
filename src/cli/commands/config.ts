import { normalizeChatAppearanceSettings } from "../../../shared/chat-appearance";

const blockedSegments = new Set(["__proto__", "constructor", "prototype"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseCliConfigValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error("Config JSON value is invalid");
    }
  }
  return value;
}

export function buildCliConfigPatch(
  config: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  const segments = key.split(".").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.length > 8 ||
    segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment) || blockedSegments.has(segment))
  ) {
    throw new Error("Config key is invalid");
  }
  const topLevel = segments[0];
  if (!topLevel) throw new Error("Config key is invalid");
  if (segments.length === 1) return { [topLevel]: value };
  const root = { ...record(config[topLevel]) };
  let cursor = root;
  for (const segment of segments.slice(1, -1)) {
    const child = { ...record(cursor[segment]) };
    cursor[segment] = child;
    cursor = child;
  }
  const leaf = segments.at(-1);
  if (!leaf) throw new Error("Config key is invalid");
  cursor[leaf] = value;
  return { [topLevel]: root };
}

export function accessibilityConfigLines(config: Record<string, unknown>): string[] {
  const appearance = normalizeChatAppearanceSettings(config.chat_appearance);
  return [
    `chat text size: ${appearance.fontSize}`,
    `code text size: ${appearance.codeFontSize}`,
    `line spacing: ${appearance.lineSpacing}`,
    `underline links: ${appearance.underlineLinks ? "on" : "off"}`,
    `reduce motion: ${appearance.reduceMotion ? "on" : "off"}`,
    `reduce transparency: ${appearance.reduceTransparency ? "on" : "off"}`,
    `increase contrast: ${appearance.highContrast ? "on" : "off"}`,
  ];
}
