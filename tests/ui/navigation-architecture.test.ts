import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

async function source(path: string): Promise<string> {
  return Bun.file(join(root, path)).text();
}

describe("application navigation architecture", () => {
  test("keeps primary destinations and chat history in the main web sidebar", async () => {
    const sidebar = await source("ui/src/components/layout/Sidebar.tsx");
    expect(sidebar).toContain("const sidebarDestinations: Record<SidebarDestinationId");
    expect(sidebar).toContain('dashboard: { path: "/", icon: LayoutDashboard');
    expect(sidebar).toContain('ide: { path: "/ide", icon: FolderOpen');
    expect(sidebar).toContain('usage: { path: "/usage", icon: Gauge');
    expect(sidebar).toContain("navigate(buildFreshChatPath())");
    expect(sidebar).toContain('placement="main"');
    expect(sidebar).toContain("navigationLayout.more");
    expect(sidebar).toContain('.filter((item) => item !== "lab" || labEnabled)');
    expect(sidebar).toContain(".map((item) => renderNavItem(sidebarDestinations[item]))");
    expect(sidebar).toContain("navigationLayout.primary.map(renderOrderedNavigationItem)");
    for (const path of [
      "/agents",
      "/providers",
      "/router",
      "/channels",
      "/mobile",
      "/plugins",
      "/mcp",
      "/skills",
      "/tools",
      "/memory",
      "/logs",
    ]) {
      expect(sidebar).not.toContain(`path: "${path}"`);
    }
  });

  test("uses the main sidebar as the settings navigation rail", async () => {
    const sidebar = await source("ui/src/components/layout/Sidebar.tsx");
    const settings = await source("ui/src/pages/Settings.tsx");
    expect(sidebar).toContain("Back to Cybara");
    expect(sidebar).toContain("<SettingsNavigation");
    expect(settings).not.toContain("<SettingsNavigation");
    expect(settings).toContain("<SidebarNavigationSettings />");
  });

  test("redirects legacy management routes into their settings tabs", async () => {
    const app = await source("ui/src/App.tsx");
    for (const section of [
      "agents",
      "providers",
      "router",
      "channels",
      "mobile",
      "plugins",
      "mcp",
      "skills",
      "tools",
      "memory",
      "logs",
    ]) {
      expect(app).toContain(`<Navigate to="/settings?section=${section}" replace />`);
    }
  });

  test("removes the second chat sidebar from the chat page", async () => {
    const chat = await source("ui/src/pages/Chat.tsx");
    const header = await source("ui/src/pages/chat/ChatPageHeader.tsx");
    expect(chat).not.toContain("<SessionsPanel");
    expect(header).not.toContain("sessionsPanelOpen");
    expect(header).not.toContain("onToggleSessionsPanel");
  });

  test("keeps native management destinations in settings", async () => {
    const content = await source("apps/macos/Cybara/Sources/Cybara/ContentView.swift");
    const settings = await source("apps/macos/Cybara/Sources/Cybara/NativeSettingsScreen.swift");
    expect(content).toContain("NativePrimarySessionList(");
    expect(content).toContain("showsSessionList: false");
    for (const tab of [
      "agents",
      "providers",
      "router",
      "channels",
      "mobile",
      "plugins",
      "mcp",
      "skills",
      "tools",
      "logs",
    ]) {
      expect(settings).toContain(`case ${tab}`);
    }
  });

  test("exposes management surfaces through mobile settings", async () => {
    const dashboard = await source("apps/mobile/src/lib/dashboard.ts");
    const detail = await source("apps/mobile/src/screens/dashboardDetailPanels.tsx");
    for (const tab of ["agents", "providers", "router", "channels", "skills", "tools", "logs"]) {
      expect(dashboard).toContain(`| "${tab}"`);
    }
    expect(detail).toContain("selectedManagementSurface");
    expect(detail).toContain("showRouterSettings");
  });
});
