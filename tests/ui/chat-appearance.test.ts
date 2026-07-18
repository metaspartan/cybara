import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_CHAT_APPEARANCE_SETTINGS,
  getChatCodeFontSizePixels,
  getChatFontSizePixels,
  getChatLineHeight,
  normalizeChatAppearanceSettings,
  readChatAppearanceFromConfig,
} from "../../shared/chat-appearance";
import { readUiStylesSource } from "../shared/source-bundles";
import { chatHorizontalPaddingClassName } from "../../ui/src/pages/chat/chatAppearanceLayout";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("chat appearance settings", () => {
  test("uses readable defaults", () => {
    expect(DEFAULT_CHAT_APPEARANCE_SETTINGS).toEqual({
      fontSize: "standard",
      codeFontSize: "standard",
      lineSpacing: "comfortable",
      horizontalPadding: "default",
      reduceMotion: false,
      reduceTransparency: false,
      highContrast: false,
      underlineLinks: false,
    });
    expect(getChatFontSizePixels("standard")).toBe(14);
    expect(getChatCodeFontSizePixels("standard")).toBe(12);
    expect(getChatLineHeight("comfortable")).toBe(1.6);
    expect(chatHorizontalPaddingClassName("default")).toBe("px-5 sm:px-8");
    expect(chatHorizontalPaddingClassName("maximum")).toBe(
      "px-6 sm:px-8 lg:px-[max(2rem,calc((100%_-_46rem)_/_2))]"
    );
  });

  test("normalizes camel case and snake case values", () => {
    expect(
      normalizeChatAppearanceSettings({
        fontSize: "large",
        codeFontSize: "compact",
        lineSpacing: "spacious",
        horizontalPadding: "wide",
        reduceMotion: true,
        reduceTransparency: true,
        highContrast: true,
        underlineLinks: true,
      })
    ).toEqual({
      fontSize: "large",
      codeFontSize: "compact",
      lineSpacing: "spacious",
      horizontalPadding: "wide",
      reduceMotion: true,
      reduceTransparency: true,
      highContrast: true,
      underlineLinks: true,
    });
    expect(
      normalizeChatAppearanceSettings({
        font_size: "extra_large",
        code_font_size: "large",
        line_spacing: "compact",
        horizontal_padding: "maximum",
        reduce_motion: true,
        reduce_transparency: true,
        high_contrast: true,
        underline_links: true,
      })
    ).toEqual({
      fontSize: "extra_large",
      codeFontSize: "large",
      lineSpacing: "compact",
      horizontalPadding: "maximum",
      reduceMotion: true,
      reduceTransparency: true,
      highContrast: true,
      underlineLinks: true,
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

  test("wires settings, rendering, persistence, and server validation", async () => {
    const settings = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "settings", "ChatAccessibilitySettings.tsx")
    ).text();
    const chat = await Bun.file(join(ROOT_DIR, "ui", "src", "pages", "Chat.tsx")).text();
    const composer = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "ChatComposer.tsx")
    ).text();
    const message = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "MessageContent.tsx")
    ).text();
    const activity = await Bun.file(
      join(ROOT_DIR, "ui", "src", "pages", "chat", "ActivityTimeline.tsx")
    ).text();
    const subagents = (
      await Promise.all(
        ["SubagentPanel.tsx", "SubagentDetailPanel.tsx", "SubagentTimeline.tsx"].map((file) =>
          Bun.file(join(ROOT_DIR, "ui", "src", "pages", "chat", file)).text()
        )
      )
    ).join("\n");
    const styles = readUiStylesSource();
    const routes = await Bun.file(join(ROOT_DIR, "src", "api", "routes.ts")).text();

    expect(settings).toContain("Chat text size");
    expect(settings).toContain("Code text size");
    expect(settings).toContain("Line spacing");
    expect(settings).toContain("Chat side padding");
    expect(settings).toContain("chatHorizontalPaddingClassName");
    expect(chat).toContain("horizontalPadding: chatAppearance.horizontalPadding");
    expect(composer).toContain("chatHorizontalPaddingClassName(horizontalPadding)");
    expect(settings).toContain("Reduce motion");
    expect(settings).toContain("Reduce transparency");
    expect(settings).toContain("Increase contrast");
    expect(settings).toContain("Underline chat links");
    expect(settings).toContain("chat_appearance: next");
    expect(settings).toContain("Conversation preview");
    expect(settings).toContain("Edited settings and verified contrast");
    expect(settings).toContain("chat-code-text");
    expect(settings).not.toContain("disabled={saving !== null}");
    expect(message).toContain('className="chat-markdown max-w-none text-gray-200"');
    expect(activity).toContain("chat-thought-text");
    expect(activity).toContain("chat-activity-text");
    expect(subagents).toContain("chat-thought-text");
    expect(subagents).toContain("chat-activity-text");
    expect(subagents).toContain("chat-code-text");
    expect(subagents).not.toContain("p-2 text-[11px] text-gray-400");
    expect(subagents).not.toContain("p-2 text-[11px] text-gray-300");
    expect(message).toContain('className="chat-code-text w-full border-collapse"');
    expect(activity).toContain('className="chat-activity-text flex w-full');
    expect(activity).toContain(
      'className="flex h-[1.5em] shrink-0 items-center" data-testid="activity-row-icon"'
    );
    expect(activity).not.toContain("opacity-70 mt-0.5 flex-shrink-0");
    expect(activity).not.toContain("text-[10px] leading-none text-sky-200");
    expect(styles).toContain("font-size: var(--chat-font-size, 14px)");
    expect(styles).toContain("font-size: var(--chat-code-font-size, 12px)");
    expect(styles).toContain("font-size: calc(var(--chat-font-size, 14px) * 0.8)");
    expect(styles).toContain('html[data-reduce-motion="true"]');
    expect(styles).toContain('html[data-reduce-transparency="true"]');
    expect(styles).toContain('html[data-high-contrast="true"]');
    expect(styles).toContain('html[data-underline-links="true"]');
    expect(routes).toContain('if (key === "chat_appearance")');
    expect(routes).toContain("config.setChatAppearanceSettings(value)");
  });
});
