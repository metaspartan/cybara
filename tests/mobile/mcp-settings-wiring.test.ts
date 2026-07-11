import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

test("mobile settings expose native MCP management", () => {
  const root = join(import.meta.dir, "../..");
  const dashboard = readFileSync(
    join(root, "apps/mobile/src/screens/dashboardDetailPanels.tsx"),
    "utf8"
  );
  const panel = readFileSync(join(root, "apps/mobile/src/screens/dashboardMcpPanel.tsx"), "utf8");
  const tabs = readFileSync(join(root, "apps/mobile/src/lib/dashboard.ts"), "utf8");

  expect(tabs).toContain('{ label: "MCP", value: "mcp" }');
  expect(dashboard).toContain("<MobileMcpSettingsPanel");
  expect(panel).toContain("api.listMcpServers()");
  expect(panel).toContain("api.createMcpServer");
  expect(panel).toContain("api.startMcpServer");
  expect(panel).toContain("api.stopMcpServer");
  expect(panel).toContain("api.deleteMcpServer");
});
