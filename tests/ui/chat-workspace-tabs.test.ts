import { describe, expect, test } from "bun:test";

describe("chat workspace tabs session switch", () => {
  test("closes subagent detail tabs and resets selection when the session changes", async () => {
    const source = await Bun.file("ui/src/pages/chat/useChatWorkspaceTabs.ts").text();

    expect(source).toContain("previousSessionIdRef.current === sessionId");
    expect(source).toContain('instance.kind === "subagents" && instance.pageKey');
    expect(source).toContain("selectTab(next[0]?.id ?? null)");
  });

  test("keeps singleton workspace tabs across session switches", async () => {
    const source = await Bun.file("ui/src/pages/chat/useChatWorkspaceTabs.ts").text();

    expect(source).toContain('!(instance.kind === "subagents" && instance.pageKey)');
    expect(source).toContain('instance.kind === "browser"');
    expect(source).toContain('instance.kind === "files"');
  });
});
