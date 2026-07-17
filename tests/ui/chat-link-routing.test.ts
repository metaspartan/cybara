import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { routeChatLink } from "../../ui/src/pages/chat/chatLinkRouting";

const messageSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/MessageContent.tsx", import.meta.url)),
  "utf8"
);
const timelineSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ChatMessageTimeline.tsx", import.meta.url)),
  "utf8"
);
const subagentSource = ["SubagentDetailPanel.tsx", "SubagentTimeline.tsx"]
  .map((file) =>
    readFileSync(fileURLToPath(new URL(`../../ui/src/pages/chat/${file}`, import.meta.url)), "utf8")
  )
  .join("\n");

describe("chat link routing", () => {
  test("routes web links into the shared browser preview", () => {
    expect(routeChatLink("https://example.com/docs", { external: false })).toEqual({
      kind: "preview",
      url: "https://example.com/docs",
    });
    expect(routeChatLink("localhost:4269/status", { external: false })).toEqual({
      kind: "preview",
      url: "http://localhost:4269/status",
    });
  });

  test("uses the system browser for modified clicks and native protocols", () => {
    expect(routeChatLink("https://example.com", { external: true })).toEqual({
      kind: "external",
      url: "https://example.com/",
    });
    expect(routeChatLink("mailto:hello@example.com", { external: false }).kind).toBe("external");
  });

  test("preserves app-local links and blocks unsafe protocols", () => {
    expect(routeChatLink("/settings?section=browser", { external: false })).toEqual({
      kind: "internal",
      url: "/settings?section=browser",
    });
    expect(routeChatLink("#details", { external: false }).kind).toBe("internal");
    expect(routeChatLink("javascript:alert(1)", { external: false }).kind).toBe("blocked");
    expect(routeChatLink("data:text/html,test", { external: false }).kind).toBe("blocked");
  });

  test("uses the shared link policy across main and subagent messages", () => {
    expect(messageSource).not.toContain('target="_blank"');
    expect(messageSource).toContain("onAuxClick");
    expect(messageSource).toContain("void openExternal(route.url)");
    expect(timelineSource).toContain("onOpenLink={onOpenLink}");
    expect(subagentSource).toContain("onOpenLink={onOpenLink}");
  });
});
