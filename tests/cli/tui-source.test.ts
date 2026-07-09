import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const cliSource = readFileSync(join(root, "src", "cli.tsx"), "utf8");
const cliChatSource = readFileSync(join(root, "src", "cli-chat.ts"), "utf8");
const cliTuiMenuSource = readFileSync(join(root, "src", "cli-tui-menu.tsx"), "utf8");
const cliTuiChatSource = readFileSync(join(root, "src", "cli-tui-chat.tsx"), "utf8");
const cliTuiInteractiveChatSource = readFileSync(
  join(root, "src", "cli-tui-interactive-chat.tsx"),
  "utf8"
);
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
      expect(cliTuiMenuSource).toContain(`label: "${panel.label}"`);
      expect(cliTuiMenuSource).toContain(`action: "${panel.command}"`);
      expect(cliSource).toContain(`case "${panel.command}":`);
      expect(cliSource).toContain(panel.component);
    }
    expect(cliSource).toContain("render(<TUIApp command={args[1]} />)");
    expect(cliTuiMenuSource).toContain(
      "Direct panels: cybara tui status|metrics|providers|router|chat|sessions|logs"
    );
    expect(cliSource).toContain("<MainMenu");
    expect(cliSource).toContain("onOpenPanel");
  });

  test("main TUI menu supports modern terminal navigation", () => {
    expect(cliTuiMenuSource).toContain("MAIN_TUI_MENU_ITEMS");
    expect(cliTuiMenuSource).toContain("Search: {query");
    expect(cliTuiMenuSource).toContain("setSearchMode(true)");
    expect(cliTuiMenuSource).toContain("shortcut");
    expect(cliTuiMenuSource).toContain("j/k or arrows move");
    expect(cliTuiMenuSource).toContain("selectedIndexForShortcut");
    expect(cliTuiMenuSource).toContain("Workflows");
    expect(cliTuiMenuSource).toContain("Setup");
    expect(cliTuiMenuSource).toContain("System");
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
    expect(cliTuiChatSource).toContain('input === "n"');
    expect(cliTuiChatSource).toContain("setSearchMode(true)");
    expect(cliTuiChatSource).toContain("InteractiveChatTUI");
    expect(cliTuiChatSource).toContain("Recent sessions");
    expect(cliTuiChatSource).toContain("cybara chat queue");
    expect(cliTuiChatSource).toContain("queue|steer");
    expect(cliTuiChatSource).toContain("cybara chat stop");
    expect(cliTuiChatSource).toContain("pending");
    expect(cliTuiChatSource).toContain("running");
    expect(cliTuiChatSource).toContain('input === "q"');
  });

  test("interactive chat TUI has editable input, slash commands, and pending queue parity", () => {
    for (const command of ["/queue", "/steer", "/edit", "/delete", "/reorder", "/stop"]) {
      expect(cliTuiInteractiveChatSource).toContain(command);
    }
    for (const route of [
      "/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending",
      "/pending/reorder",
      "/stop",
    ]) {
      expect(cliTuiInteractiveChatSource).toContain(route);
    }
    expect(cliTuiInteractiveChatSource).toContain("PendingQueue");
    expect(cliTuiInteractiveChatSource).toContain("CommandPalette");
    expect(cliTuiInteractiveChatSource).toContain("Ctrl+J newline");
    expect(cliTuiInteractiveChatSource).toContain("key.leftArrow");
    expect(cliTuiInteractiveChatSource).toContain("key.rightArrow");
    expect(cliTuiInteractiveChatSource).toContain("key.upArrow");
    expect(cliTuiInteractiveChatSource).toContain("key.downArrow");
    expect(cliTuiInteractiveChatSource).toContain("(key as { tab?: boolean }).tab");
    expect(cliTuiInteractiveChatSource).toContain("process_activities");
    expect(cliTuiInteractiveChatSource).toContain("tool_calls");
  });

  test("terminal chat exposes app-parity slash controls", () => {
    for (const command of [
      "/status",
      "/agents",
      "/agent <id|name|default>",
      "/model <id|router|default>",
      "/router on|off",
      "/permissions ask|always_allow|show",
      "/queue <message>",
      "/steer <id|#n>",
      "/edit <id|#n> <message>",
      "/delete <id|#n>",
      "/reorder <id|#n>...",
      "/stop",
      "/subagent spawn <task>",
    ]) {
      expect(cliChatSource).toContain(command);
    }
    expect(cliChatSource).toContain("modelOverride");
    expect(cliChatSource).toContain("useModelRouter");
    expect(cliChatSource).toContain("formatAgentLine");
    expect(cliChatSource).toContain("/api/chat/sessions/${encodeURIComponent(sessionId)}/stop");
  });
});
