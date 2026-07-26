import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: task creation", () => {
  test("api exposes createTask posting to /api/tasks", () => {
    const api = read("lib/api.ts");
    expect(api).toContain("createTask(");
    expect(api).toMatch(/`\/api\/tasks`/);
    expect(api).toContain('method: "POST"');
  });

  test("NewTaskPanel collects name, agent, chat context, action, and a schedule", () => {
    const panel = read("components/NewTaskPanel.tsx");
    expect(panel).toContain("api.createTask(");
    expect(panel).toContain("SCHEDULE_PRESETS");
    expect(panel).toContain("Custom cron");
    expect(panel).toContain("Chat context");
    expect(panel).toContain(".sessions()");
    expect(panel).toContain("session_id: selectedSessionId");
    expect(panel).toContain("action:");
    expect(panel).toContain("enabled: true");
  });

  test("Tasks tab renders TasksPanel with a create entry point + newTask route", () => {
    const screen =
      read("screens/DashboardScreen.tsx") +
      read("screens/dashboardDetailPanels.tsx") +
      read("screens/dashboardSurfaceData.ts");
    expect(screen).toContain("function TasksPanel(");
    expect(screen).toContain("<TasksPanel");
    expect(screen).toContain('kind: "newTask"');
    expect(screen).toContain("<NewTaskPanel");
    expect(screen).toContain("Create your first task");
  });
});

describe("mobile: home shortcuts", () => {
  const screen = read("screens/DashboardScreen.tsx") + read("screens/dashboardSurfaceData.ts");

  test("Wallet is a Home shortcut, promoted ahead of providers", () => {
    const walletIdx = screen.indexOf('key: "wallet"');
    const providersIdx = screen.indexOf('key: "providers"');
    expect(walletIdx).toBeGreaterThan(-1);
    expect(providersIdx).toBeGreaterThan(-1);
    expect(walletIdx).toBeLessThan(providersIdx);
  });
});
