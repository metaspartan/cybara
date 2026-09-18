import { describe, expect, test } from "bun:test";

describe("web research settings UI", () => {
  test("surfaces every supported credential without rendering stored secrets", async () => {
    const source = await Bun.file("ui/src/pages/settings/WebResearchSettings.tsx").text();
    const api = await Bun.file("ui/src/lib/api/web-research.ts").text();
    const apiIndex = await Bun.file("ui/src/lib/api.ts").text();
    const panel = await Bun.file("ui/src/pages/settings/WebSearchBackendsPanel.tsx").text();
    const settings = await Bun.file("ui/src/pages/Settings.tsx").text();

    expect(source).toContain("Web Research");
    expect(source).toContain('type="password"');
    expect(source).toContain("Managed by");
    expect(source).toContain("Clear");
    expect(api).toContain('fetchApi<WebResearchSettingsStatus>("/web-research/settings")');
    expect(apiIndex).toContain('export * from "@/lib/api/web-research";');
    expect(source).toContain("<WebSearchBackendsPanel");
    expect(panel).toContain("Search order");
    expect(panel).toContain("MCP search tool");
    expect(settings).toContain("<WebResearchSettings />");
  });
});
