import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CHAT_APPEARANCE_SETTINGS,
  getChatCodeFontSizePixels,
  getChatFontSizePixels,
  getChatLineHeight,
  normalizeChatAppearanceSettings,
  readChatAppearanceFromConfig,
} from "../../shared/chat-appearance";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("chat appearance settings", () => {
  test("uses readable defaults", () => {
    expect(DEFAULT_CHAT_APPEARANCE_SETTINGS).toEqual({
      fontSize: "standard",
      codeFontSize: "standard",
      lineSpacing: "comfortable",
      reduceMotion: false,
    });
    expect(getChatFontSizePixels("standard")).toBe(14);
    expect(getChatCodeFontSizePixels("standard")).toBe(12);
    expect(getChatLineHeight("comfortable")).toBe(1.6);
  });

  test("normalizes camel case and snake case values", () => {
    expect(
      normalizeChatAppearanceSettings({
        fontSize: "large",
        codeFontSize: "compact",
        lineSpacing: "spacious",
        reduceMotion: true,
      })
    ).toEqual({
      fontSize: "large",
      codeFontSize: "compact",
      lineSpacing: "spacious",
      reduceMotion: true,
    });
    expect(
      normalizeChatAppearanceSettings({
        font_size: "extra_large",
        code_font_size: "large",
        line_spacing: "compact",
        reduce_motion: true,
      })
    ).toEqual({
      fontSize: "extra_large",
      codeFontSize: "large",
      lineSpacing: "compact",
      reduceMotion: true,
    });
  });

  test("falls back safely for malformed settings", () => {
    const malformed: unknown[] = [
      null,
      [],
      "large",
      42,
      { fontSize: "huge" },
      { codeFontSize: false, lineSpacing: {}, reduceMotion: "yes" },
    ];
    for (const value of malformed) {
      expect(normalizeChatAppearanceSettings(value)).toEqual(DEFAULT_CHAT_APPEARANCE_SETTINGS);
    }
  });

  test("reads the gateway config aliases only when present", () => {
    expect(readChatAppearanceFromConfig(undefined)).toBeUndefined();
    expect(readChatAppearanceFromConfig({})).toBeUndefined();
    expect(readChatAppearanceFromConfig({ chat_appearance: { fontSize: "large" } })?.fontSize).toBe(
      "large"
    );
    expect(
      readChatAppearanceFromConfig({ chatAppearance: { lineSpacing: "spacious" } })?.lineSpacing
    ).toBe("spacious");
  });

  test("wires settings, rendering, persistence, and server validation", () => {
    const settings = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "settings", "ChatAccessibilitySettings.tsx"),
      "utf8"
    );
    const message = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "MessageContent.tsx"),
      "utf8"
    );
    const styles = readFileSync(join(ROOT_DIR, "ui", "src", "index.css"), "utf8");
    const routes = readFileSync(join(ROOT_DIR, "src", "api", "routes.ts"), "utf8");

    expect(settings).toContain("Chat text size");
    expect(settings).toContain("Code text size");
    expect(settings).toContain("Line spacing");
    expect(settings).toContain("Reduce motion");
    expect(settings).toContain("chat_appearance: next");
    expect(message).toContain('className="chat-markdown max-w-none text-gray-200"');
    expect(styles).toContain("font-size: var(--chat-font-size, 14px)");
    expect(styles).toContain("font-size: var(--chat-code-font-size, 12px)");
    expect(styles).toContain('html[data-reduce-motion="true"]');
    expect(routes).toContain('if (key === "chat_appearance")');
    expect(routes).toContain("config.setChatAppearanceSettings(value)");
  });
});
