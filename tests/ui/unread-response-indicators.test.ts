import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_UNREAD_DOT_COLOR,
  normalizeUnreadDotColor,
  readUnreadDotColor,
} from "../../ui/src/lib/unreadPreferences";
import { latestAssistantMessageKey } from "../../ui/src/pages/chat/chatModel";

const root = resolve(import.meta.dir, "../..");
const source = (path: string): string => readFileSync(resolve(root, path), "utf8");

describe("unread response indicators", () => {
  test("normalizes the configurable dot color and has a safe default", () => {
    expect(normalizeUnreadDotColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeUnreadDotColor("red")).toBe(DEFAULT_UNREAD_DOT_COLOR);
    expect(normalizeUnreadDotColor("#fff")).toBe(DEFAULT_UNREAD_DOT_COLOR);
    expect(readUnreadDotColor()).toBe(DEFAULT_UNREAD_DOT_COLOR);
  });

  test("shows the configured dot to the right of unread bot and session names", () => {
    const botSidebar = source("ui/src/pages/chat/BotSidebar.tsx");
    const sessionSidebar = source("ui/src/pages/chat/SessionSidebar.tsx");

    for (const sidebar of [botSidebar, sessionSidebar]) {
      expect(sidebar).toContain('aria-label="Unread response"');
      expect(sidebar).toContain("backgroundColor: unreadDotColor");
    }
    expect(botSidebar.indexOf("{bot.name}")).toBeLessThan(
      botSidebar.indexOf("bot.session?.unread")
    );
    expect(sessionSidebar.indexOf("{displayTitle}")).toBeLessThan(
      sessionSidebar.indexOf("session.unread && !isSessionSelected")
    );
  });

  test("clears unread state immediately when a bot or session opens", () => {
    const botSidebar = source("ui/src/pages/chat/BotSidebar.tsx");
    const sessionSidebar = source("ui/src/pages/chat/SessionSidebar.tsx");
    const chat = source("ui/src/pages/Chat.tsx");
    const acknowledgement = source("ui/src/pages/chat/useSessionReadAcknowledgement.ts");

    expect(botSidebar).toContain("markBotReadImmediately(bot.session_id)");
    expect(botSidebar).toContain("unread: false");
    expect(sessionSidebar).toContain("markReadImmediately(sessionId)");
    expect(sessionSidebar).toContain("sessionQueryClient.setQueriesData");
    expect(chat).toContain("useSessionReadAcknowledgement(sessionId, assistantReadKey)");
    expect(chat).toContain("latestAssistantMessageKey(typedMessages)");
    expect(acknowledgement).toContain("chatApi.markSessionRead(sessionId)");
    expect(acknowledgement).toContain("[latestAssistantMessageKey, queryClient, sessionId]");
    expect(acknowledgement).toContain("acknowledgedRef.current === acknowledgementKey");
    expect(acknowledgement).not.toContain("messageCount");
  });

  test("acknowledges reads only when the latest assistant message advances", () => {
    expect(latestAssistantMessageKey([])).toBeNull();
    expect(latestAssistantMessageKey([{ role: "user", content: "hi" }])).toBeNull();
    const conversation = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "one", message_id: "m-1" },
      { role: "user" as const, content: "again" },
    ];
    expect(latestAssistantMessageKey(conversation)).toBe("m-1");
    expect(
      latestAssistantMessageKey([...conversation, { role: "user" as const, content: "and again" }])
    ).toBe("m-1");
    expect(
      latestAssistantMessageKey([
        ...conversation,
        { role: "assistant" as const, content: "two", message_id: "m-2" },
      ])
    ).toBe("m-2");
    expect(
      latestAssistantMessageKey([
        { role: "assistant" as const, content: "streaming", timestamp: "2099-01-01T00:00:00.000Z" },
      ])
    ).toBe("2099-01-01T00:00:00.000Z");
    expect(latestAssistantMessageKey([{ role: "assistant" as const, content: "bare" }])).toBe(
      "assistant-0"
    );
  });

  test("exposes the color picker in Appearance settings", () => {
    const settings = source("ui/src/pages/settings/ThemeSettings.tsx");
    expect(settings).toContain("Unread response color");
    expect(settings).toContain('type="color"');
    expect(settings).toContain("persistUnreadDotColor");
  });
});
