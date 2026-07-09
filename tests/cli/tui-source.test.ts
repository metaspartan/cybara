import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const cliSource = readFileSync(join(root, "src", "cli.tsx"), "utf8");
const cliChatSource = readFileSync(join(root, "src", "cli-chat.ts"), "utf8");
const cliTuiChatSource = readFileSync(join(root, "src", "cli-tui-chat.tsx"), "utf8");
const cliDocs = readFileSync(join(root, "docs", "cli.md"), "utf8");

const tuiPanels = [
  { command: "status", component: "TUIStatusCommand", label: "Status" },
  { command: "metrics", component: "TUIMetricsCommand", label: "Metrics" },
  { command: "agents", component: "TUIAgentsCommand", label: "Agents" },
  { command: "providers", component: "TUIProvidersCommand", label: "Providers" },
  { command: "router", component: "TUIRouterCommand", label: "Model Router" },
  { command: "chat", component: "TUIChatCommand", label: "Chat" },
  { command: "sessions", component: "TUISessionsCommand", label: "Sessions" },
  { command: "logs", component: "TUILogsCommand", label: "Logs" },
  { command: "mobile", component: "TUIMobileCommand", label: "Mobile Pairing" },
  { command: "tasks", component: "TUITasksCommand", label: "Tasks" },
  { command: "skills", component: "TUISkillsCommand", label: "Skills" },
];

describe("CLI TUI source wiring", () => {
  test("main menu and direct command routing cover operational panels", () => {
    for (const panel of tuiPanels) {
      expect(cliSource).toContain(`{ label: "${panel.label}", action: "${panel.command}" }`);
      expect(cliSource).toContain(`case "${panel.command}":`);
      expect(cliSource).toContain(panel.component);
    }
    expect(cliSource).toContain("render(<TUIApp command={args[1]} />)");
    expect(cliSource).toContain(
      "Direct panels: cybara tui status|metrics|providers|router|chat|sessions|logs"
    );
  });

  test("read-only parity panels use the shared gateway API routes", () => {
    for (const route of [
      "/api/providers",
      "/api/provider-plans/status",
      "/api/router/status",
      "/api/sessions",
      "/api/logs/system?limit=12",
      "/api/mobile/devices",
    ]) {
      expect(cliSource).toContain(route);
    }
  });

  test("CLI docs list direct TUI panels", () => {
    for (const command of ["providers", "router", "chat", "sessions", "logs", "mobile"]) {
      expect(cliDocs).toContain(`cybara tui ${command}`);
    }
  });

  test("chat TUI surfaces terminal chat queue and steering controls", () => {
    expect(cliTuiChatSource).toContain("/api/sessions");
    expect(cliTuiChatSource).toContain("cybara chat queue");
    expect(cliTuiChatSource).toContain("cybara chat steer");
    expect(cliTuiChatSource).toContain("pending");
    expect(cliTuiChatSource).toContain("running");
    expect(cliTuiChatSource).toContain('input === "q"');
  });

  test("terminal chat exposes app-parity slash controls", () => {
    for (const command of [
      "/status",
      "/agents",
      "/agent <id|name|default>",
      "/model <id|router|default>",
      "/router on|off",
      "/permissions ask|always_allow|show",
      "/subagent spawn <task>",
    ]) {
      expect(cliChatSource).toContain(command);
    }
    expect(cliChatSource).toContain("modelOverride");
    expect(cliChatSource).toContain("useModelRouter");
    expect(cliChatSource).toContain("formatAgentLine");
  });
});
