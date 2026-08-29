import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

describe("bot sidebar wiring", () => {
  test("switches between sessions and bots above the primary creation action", () => {
    const source = readFileSync(resolve(root, "ui/src/components/layout/Sidebar.tsx"), "utf8");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('sidebarMode === "sessions"');
    expect(source).toContain('sidebarMode === "bots"');
    expect(source.indexOf('role="tablist"')).toBeLessThan(source.indexOf('"New Bot"'));
    expect(source).toContain("<BotSidebar");
  });

  test("opens bots through the shared chat route and composer runtime", () => {
    const source = readFileSync(resolve(root, "ui/src/pages/chat/BotSidebar.tsx"), "utf8");
    expect(source).toContain("botsApi.ensureSession");
    expect(source).toContain("buildSessionChatPath(sessionId)");
    expect(source).not.toContain("ChatInput");
  });
});
