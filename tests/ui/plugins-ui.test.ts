import { describe, expect, test } from "bun:test";
import { join } from "path";

const root = join(import.meta.dir, "../..");

describe("plugin UI", () => {
  test("exposes a lazy plugin route and preserves the connector compatibility redirect", async () => {
    const app = await Bun.file(join(root, "ui/src/App.tsx")).text();
    const sidebar = await Bun.file(join(root, "ui/src/components/layout/Sidebar.tsx")).text();
    expect(app).toContain('path="/connectors"');
    expect(app).toContain('path="/plugins"');
    expect(app).toContain('import("@/pages/Plugins")');
    expect(app).toContain('<Navigate to="/plugins" replace />');
    expect(sidebar).toContain('path: "/plugins"');
    expect(sidebar).not.toContain('label: "Connectors"');
  });

  test("combines installed bundles, account apps, and MCP services", async () => {
    const page = await Bun.file(join(root, "ui/src/pages/Plugins.tsx")).text();
    const installer = await Bun.file(
      join(root, "ui/src/pages/plugins/PluginInstallDialog.tsx")
    ).text();
    const styles = await Bun.file(join(root, "ui/src/index.css")).text();
    expect(page).toContain('label: "Installed"');
    expect(page).toContain('label: "Account apps"');
    expect(page).toContain('label: "MCP services"');
    expect(page).toContain("pluginsApi.list()");
    expect(page).toContain("mcpApi.list()");
    expect(page).toContain("<AccountAppsPanel />");
    expect(page).toContain("<PluginInstallDialog");
    expect(installer).toContain("Choose folder");
    expect(installer).toContain("Choose ZIP");
    expect(installer).toContain("pluginsApi.validate(nextPayload)");
    expect(installer).toContain('setAttribute("webkitdirectory", "")');
    expect(installer).not.toContain('placeholder="/path/to/plugin"');
    expect(styles).toContain('.grid-cols-3:not([role="tablist"])');
    expect(page).not.toContain("border-white");
    expect(page).not.toContain("border-dashed");
    expect(page).not.toContain("--border-color");
  });

  test("uses switches for optional write access and keeps OAuth secrets masked", async () => {
    const page = await Bun.file(join(root, "ui/src/pages/plugins/AccountAppsPanel.tsx")).text();
    expect(page).toContain("<Switch");
    expect(page).toContain('type="password"');
    expect(page).toContain("approval-gated");
    expect(page).toContain("creating events");
    expect(page).toContain("Loading account connectors");
    expect(page).not.toContain('type="checkbox"');
    expect(page).toContain("border-[var(--surface-border)]");
    expect(page).toContain("text-[var(--text-primary)]");
    expect(page).not.toContain("border-white");
    expect(page).not.toContain("text-white");
    expect(page).not.toContain("--border-color");
  });

  test("keeps account app identities and plugin summaries in parity across clients", async () => {
    const web = await Bun.file(join(root, "ui/src/pages/plugins/AccountAppsPanel.tsx")).text();
    const mobile = await Bun.file(
      join(root, "apps/mobile/src/screens/dashboardPluginsPanel.tsx")
    ).text();
    const macos = await Bun.file(
      join(root, "apps/macos/Cybara/Sources/Cybara/NativePlatformScreens.swift")
    ).text();

    expect(mobile).toContain("api.listPlugins()");
    expect(mobile).toContain("api.listMcpServers()");
    expect(macos).toContain('ScreenHeader(title: "Plugins"');
    expect(macos).toContain("client.nativePlugins()");
    expect(macos).toContain("client.nativeMCPServers()");
    expect(macos).toContain("Choose Plugin Folder or ZIP");
    expect(macos).toContain("client.validateNativePlugin(path: url.path)");
    expect(macos).toContain("client.installNativePlugin(path: url.path)");

    for (const id of ["google_workspace", "microsoft_365", "notion"]) {
      expect(web).toContain(id);
      expect(mobile).toContain(id);
      expect(macos).toContain(id);
    }
  });
});
