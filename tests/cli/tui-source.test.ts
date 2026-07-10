import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const cliSource = readFileSync(join(root, "src", "cli.tsx"), "utf8");
const cliChatSource = readFileSync(join(root, "src", "cli-chat.ts"), "utf8");
const cliTuiMenuSource = readFileSync(join(root, "src", "cli-tui-menu.tsx"), "utf8");
const cliTuiPanelsSource = readFileSync(join(root, "src", "cli-tui-panels.tsx"), "utf8");
const cliTuiChatSource = readFileSync(join(root, "src", "cli-tui-chat.tsx"), "utf8");
const cliTuiInteractiveChatSource = readFileSync(
  join(root, "src", "cli-tui-interactive-chat.tsx"),
  "utf8"
);
const cliTuiChatEnvironmentSource = readFileSync(
  join(root, "src", "cli-tui-chat-environment.ts"),
  "utf8"
);
const cliTuiChatEnvironmentViewSource = readFileSync(
  join(root, "src", "cli-tui-chat-environment-view.tsx"),
  "utf8"
);
const cliTuiApprovalsSource = readFileSync(join(root, "src", "cli-tui-approvals.tsx"), "utf8");
const cliDocs = readFileSync(join(root, "docs", "cli.md"), "utf8");

const tuiPanels = [
  { command: "status", component: "TUIStatusCommand", label: "Status" },
  { command: "metrics", component: "TUIMetricsCommand", label: "Metrics" },
  { command: "agents", component: "TUIAgentsCommand", label: "Agents" },
  { command: "providers", component: "TUIProvidersCommand", label: "Providers" },
  { command: "router", component: "TUIRouterCommand", label: "Model Router" },
  { command: "usage", component: "TUIUsageCommand", label: "Usage" },
  { command: "channels", component: "TUIChannelsCommand", label: "Channels" },
  { command: "memory", component: "TUIMemoryCommand", label: "Memory" },
  { command: "tools", component: "TUIToolsCommand", label: "Tools" },
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
      "Direct panels: cybara tui status|metrics|usage|providers|router|channels|memory|tools|chat|sessions|logs"
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
    expect(cliTuiMenuSource).toContain("visibleMenuItems");
    expect(cliTuiMenuSource).toContain("const availableRows");
    expect(cliTuiMenuSource).toContain('action: "router",\n    shortcut: "v"');
    expect(cliTuiMenuSource).toContain('action: "skills",\n    shortcut: "i"');
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
      "/api/channels",
      "/api/memory/status",
      "/api/memory",
      "/api/tools",
    ]) {
      expect(cliSource + cliTuiPanelsSource).toContain(route);
    }
  });

  test("CLI docs list direct TUI panels", () => {
    for (const command of [
      "providers",
      "router",
      "usage",
      "channels",
      "memory",
      "tools",
      "chat",
      "sessions",
      "logs",
      "mobile",
    ]) {
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
    for (const command of [
      "/status",
      "/agents",
      "/agent",
      "/model",
      "/router",
      "/permissions",
      "/reasoning",
      "/title",
      "/workspace",
      "/context",
      "/usage",
      "/environment",
      "/plan",
      "/goal",
      "/loop",
      "/diff",
      "/diffs",
      "/tasks",
      "/subagents",
      "/compact",
      "/queue",
      "/steer",
      "/edit",
      "/delete",
      "/reorder",
      "/stop",
      "/copy",
      "/raw",
      "/review",
      "/expand",
      "/resume",
      "/sessions",
    ]) {
      expect(cliTuiInteractiveChatSource).toContain(command);
    }
    for (const route of [
      "/api/agents",
      "/api/config",
      "/api/tools/approvals",
      "/api/tools/approvals/resolve",
      "/api/router/status",
      "/api/tasks",
      "/api/subagents",
      "/api/subagents/spawn",
      "/api/sessions/${encodeURIComponent(targetSessionId)}",
      "/api/sessions/${encodeURIComponent(localSessionId)}/agent",
      "/api/sessions/${encodeURIComponent(localSessionId)}/title",
      "/api/sessions/${encodeURIComponent(localSessionId)}/workspace",
      "/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending",
      "/pending/reorder",
      "/stop",
    ]) {
      expect(cliTuiInteractiveChatSource).toContain(route);
    }
    expect(cliTuiInteractiveChatSource).toContain("PendingQueue");
    expect(cliTuiInteractiveChatSource).toContain("CommandPalette");
    expect(cliTuiInteractiveChatSource).toContain("StatusRail");
    expect(cliTuiInteractiveChatSource).toContain("EnvironmentPanel");
    expect(cliTuiInteractiveChatSource).toContain("environmentSnapshotFromDetail");
    expect(cliTuiInteractiveChatSource).toContain("formatContextUsageLine");
    expect(cliTuiInteractiveChatSource).toContain("formatTokenUsageLine");
    expect(cliTuiInteractiveChatSource).toContain("formatFileChangeLine");
    expect(cliTuiInteractiveChatSource).toContain("formatTaskLine");
    expect(cliTuiInteractiveChatSource).toContain("formatSubagentLine");
    expect(cliTuiInteractiveChatSource).toContain("setUseModelRouter(true)");
    expect(cliTuiInteractiveChatSource).toContain("tool_approval_mode");
    expect(cliTuiInteractiveChatSource).toContain("agentId: selectedAgentId || undefined");
    expect(cliTuiInteractiveChatSource).toContain(
      "modelOverride: useModelRouter ? undefined : modelOverride || undefined"
    );
    expect(cliTuiInteractiveChatSource).not.toContain('command === "model" ? "agent"');
    expect(cliTuiInteractiveChatSource).toContain("Ctrl+J newline");
    expect(cliTuiInteractiveChatSource).toContain("pageUp");
    expect(cliTuiInteractiveChatSource).toContain("pageDown");
    expect(cliTuiInteractiveChatSource).toContain(
      "maxLines={expandedTranscript ? undefined : layout.messageLines}"
    );
    expect(cliTuiInteractiveChatSource).toContain("ToolApprovalPrompt");
    expect(cliTuiInteractiveChatSource).toContain("persistedMessages.some");
    expect(cliTuiInteractiveChatSource).toContain("messagesFromResponse([response.message])");
    expect(cliTuiInteractiveChatSource).toContain("isTransientRuntimeCommand(trimmed)");
    expect(cliTuiApprovalsSource).toContain("approve_once");
    expect(cliTuiApprovalsSource).toContain("approve_session");
    expect(cliTuiApprovalsSource).toContain("approve_always");
    expect(cliTuiInteractiveChatSource).toContain("key.leftArrow");
    expect(cliTuiInteractiveChatSource).toContain("key.rightArrow");
    expect(cliTuiInteractiveChatSource).toContain("key.upArrow");
    expect(cliTuiInteractiveChatSource).toContain("key.downArrow");
    expect(cliTuiInteractiveChatSource).toContain("(key as { tab?: boolean }).tab");
    expect(cliTuiInteractiveChatSource).toContain("process_activities");
    expect(cliTuiInteractiveChatSource).toContain("tool_calls");
  });

  test("chat session picker supports pinning and guarded deletion", () => {
    expect(cliTuiChatSource).toContain("toggleSelectedPin");
    expect(cliTuiChatSource).toContain("deleteSelectedSession");
    expect(cliTuiChatSource).toContain("confirmDeleteId");
    expect(cliTuiChatSource).toContain("/pin");
    expect(cliTuiChatSource).toContain('method: "DELETE"');
  });

  test("terminal chat environment panel is backed by shared parsing helpers", () => {
    for (const symbol of [
      "TuiEnvironmentSnapshot",
      "environmentSnapshotFromDetail",
      "contextUsageFromDetail",
      "tokenUsageFromDetail",
      "fileChangesFromMessages",
      "tasksFromResponse",
      "subagentsFromResponse",
      "formatContextUsageLine",
      "formatTokenUsageLine",
      "formatPlanLine",
      "formatFileChangeLine",
    ]) {
      expect(cliTuiChatEnvironmentSource).toContain(symbol);
    }
    expect(cliTuiChatEnvironmentViewSource).toContain("EnvironmentPanel");
    expect(cliTuiChatEnvironmentViewSource).toContain("Workspace");
    expect(cliTuiChatEnvironmentViewSource).toContain("Branch");
    expect(cliTuiChatEnvironmentViewSource).toContain("Subagents");
  });

  test("terminal chat exposes app-parity slash controls", () => {
    for (const command of [
      "/status",
      "/agents",
      "/agent <id|name|default>",
      "/model <id|router|default>",
      "/router on|off",
      "/permissions ask|always_allow|show",
      "/environment",
      "/context",
      "/usage",
      "/plan",
      "/diffs",
      "/tasks",
      "/subagents",
      "/compact",
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
    expect(cliChatSource).toContain("printEnvironment");
    expect(cliChatSource).toContain("fetchSessionEnvironment");
    expect(cliChatSource).toContain("environmentSnapshotFromDetail");
    expect(cliChatSource).toContain("/api/chat/sessions/${encodeURIComponent(sessionId)}/stop");
  });
});
