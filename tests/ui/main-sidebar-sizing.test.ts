import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampMainSidebarChatHeight,
  clampMainSidebarWidth,
  MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT,
  MAIN_SIDEBAR_CHAT_HEIGHT_MAX,
  MAIN_SIDEBAR_CHAT_HEIGHT_MIN,
  MAIN_SIDEBAR_DEFAULT_WIDTH,
  MAIN_SIDEBAR_MAX_WIDTH,
  MAIN_SIDEBAR_MIN_WIDTH,
  parseMainSidebarWidth,
  resolveMainSidebarChatHeight,
  resolveMainSidebarChatMaxHeight,
  usesAvailableMainSidebarChatHeight,
} from "../../ui/src/components/layout/sidebarSizing";

describe("main sidebar sizing", () => {
  test("uses a chat-friendly default and clamps persisted values", () => {
    expect(MAIN_SIDEBAR_DEFAULT_WIDTH).toBe(272);
    expect(parseMainSidebarWidth(null)).toBe(272);
    expect(parseMainSidebarWidth("240")).toBe(240);
    expect(parseMainSidebarWidth("invalid")).toBe(272);
    expect(clampMainSidebarWidth(100)).toBe(MAIN_SIDEBAR_MIN_WIDTH);
    expect(clampMainSidebarWidth(500)).toBe(MAIN_SIDEBAR_MAX_WIDTH);
  });

  test("bounds the resizable chat-history region", () => {
    expect(MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT).toBe(400);
    expect(clampMainSidebarChatHeight(20)).toBe(MAIN_SIDEBAR_CHAT_HEIGHT_MIN);
    expect(clampMainSidebarChatHeight(1400)).toBe(1400);
    expect(clampMainSidebarChatHeight(2000)).toBe(2000);
    expect(clampMainSidebarChatHeight(3000)).toBe(MAIN_SIDEBAR_CHAT_HEIGHT_MAX);
    expect(resolveMainSidebarChatHeight(400, 0)).toBe(400);
    expect(resolveMainSidebarChatHeight(400, 4)).toBe(280);
    expect(resolveMainSidebarChatHeight(400, 20)).toBe(48);
    expect(resolveMainSidebarChatMaxHeight(0)).toBe("calc(100% - 140px)");
    expect(resolveMainSidebarChatMaxHeight(4)).toBe("calc(100% - 288px)");
    expect(usesAvailableMainSidebarChatHeight(MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT)).toBe(true);
    expect(usesAvailableMainSidebarChatHeight(720)).toBe(false);
  });

  test("persists resizing and shares the width with main content", () => {
    const sidebar = readFileSync(
      join(process.cwd(), "ui", "src", "components", "layout", "Sidebar.tsx"),
      "utf8"
    );
    const app = readFileSync(join(process.cwd(), "ui", "src", "App.tsx"), "utf8");

    expect(sidebar).toContain('aria-label="Resize main sidebar"');
    expect(sidebar).toContain("onPointerDown={beginResize}");
    expect(sidebar).toContain("onKeyDown={resizeWithKeyboard}");
    expect(sidebar).toContain("MAIN_SIDEBAR_WIDTH_STORAGE_KEY");
    expect(sidebar).toContain('aria-label="Resize chat history"');
    expect(sidebar).toContain("onPointerDown={beginResizeChatHistory}");
    expect(sidebar).toContain("onKeyDown={resizeChatHistoryWithKeyboard}");
    expect(sidebar).toContain(
      "maxHeight: chatHistoryUsesAvailableHeight\n                          ? undefined\n                          : chatHistoryMaxHeight"
    );
    expect(sidebar).toContain("resolveMainSidebarChatMaxHeight");
    expect(sidebar).toContain(
      "height: chatHistoryUsesAvailableHeight\n                          ? undefined\n                          : visibleChatHistoryHeight"
    );
    expect(sidebar).toContain('chatHistoryUsesAvailableHeight ? "min-h-0 flex-1" : "shrink-0"');
    expect(sidebar).toContain(
      'className="min-h-[108px] shrink-0 space-y-0.5 overflow-y-auto pb-2"'
    );
    expect(sidebar).toContain("moreOpen ? navigationLayout.more.length : 0");
    expect(sidebar).toContain("transition-[height,min-height,max-height]");
    expect(sidebar).toContain('aria-label="Search chats"');
    expect(sidebar).toContain("searchOpen={sessionSearchOpen}");
    expect(sidebar).toContain('collapsed ? "px-3 py-2.5 justify-center" : "px-3.5 py-1.5"');
    expect(sidebar).not.toContain('t("app.tagline")');
    expect(sidebar).toContain("md:w-[var(--main-sidebar-width)]");
    expect(app).toContain("md:ml-[var(--main-sidebar-width)]");
  });
});
