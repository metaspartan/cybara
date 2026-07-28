import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const cliSource = readFileSync(join(root, "src", "cli", "index.tsx"), "utf8");
const cliTuiAppSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "app.tsx"),
  "utf8"
);
const cliChatSource = readFileSync(join(root, "src", "cli", "commands", "chat.ts"), "utf8");
const cliTuiMenuSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "menu.tsx"),
  "utf8"
);
const cliTuiPanelsSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "panels.tsx"),
  "utf8"
);
const cliEvalsSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "evals.tsx"),
  "utf8"
);
const cliTuiOperationsPanelsSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "operations-panels.tsx"),
  "utf8"
);
const cliTuiChatSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "chat.tsx"),
  "utf8"
);
const cliTuiChatChromeSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "chat-chrome.tsx"),
  "utf8"
);
const cliTuiInteractiveChatSource = [
  join(root, "src", "cli", "tui", "components", "interactive-chat.tsx"),
  join(root, "src", "cli", "tui", "components", "interactive-chat-status.ts"),
  join(root, "src", "cli", "tui", "components", "interactive-chat-pending-commands.ts"),
  join(root, "src", "cli", "tui", "interactive-chat-data.ts"),
  join(root, "src", "cli", "tui", "components", "interactive-chat-layout.tsx"),
  join(root, "src", "cli", "tui", "components", "interactive-chat-view.tsx"),
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const cliTuiMarkdownRenderSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "markdown-render.tsx"),
  "utf8"
);
const cliTuiCommandsSource = readFileSync(join(root, "src", "cli", "tui", "commands.ts"), "utf8");
const cliTuiChatHistorySource = readFileSync(
  join(root, "src", "cli", "tui", "components", "chat-history.tsx"),
  "utf8"
);
const cliTuiChatEnvironmentSource = readFileSync(
  join(root, "src", "cli", "tui", "chat-environment.ts"),
  "utf8"
);
const cliTuiChatEnvironmentViewSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "chat-environment-view.tsx"),
  "utf8"
);
const cliTuiSettingsSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "settings.tsx"),
  "utf8"
);
const cliTuiApprovalsSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "approvals.tsx"),
  "utf8"
);
const cliPluginsSource = readFileSync(
  join(root, "src", "cli", "tui", "components", "connectors.tsx"),
  "utf8"
);
const cliDocs = readFileSync(join(root, "docs", "cli.md"), "utf8");

const tuiPanels = [
  { command: "status", component: "TUIStatusCommand", label: "Status" },
  { command: "metrics", component: "TUIMetricsCommand", label: "Metrics" },
  { command: "agents", component: "TUIAgentsCommand", label: "Agents" },
  {
    command: "providers",
    component: "TUIProvidersCommand",
    label: "Providers",
  },
  { command: "router", component: "TUIRouterCommand", label: "Model Router" },
  { command: "usage", component: "TUIUsageCommand", label: "Usage" },
  { command: "evals", component: "TUIEvalsCommand", label: "Lab" },
  { command: "channels", component: "TUIChannelsCommand", label: "Channels" },
  { command: "memory", component: "TUIMemoryCommand", label: "Memory" },
  { command: "tools", component: "TUIToolsCommand", label: "Tools" },
  {
    command: "browser",
    component: "TUIBrowserCommand",
    label: "Browser Preview",
  },
  { command: "wallet", component: "TUIWalletCommand", label: "Wallet" },
  { command: "chat", component: "TUIChatCommand", label: "Chat" },
  { command: "sessions", component: "TUISessionsCommand", label: "Sessions" },
  { command: "logs", component: "TUILogsCommand", label: "Logs" },
  { command: "mobile", component: "TUIMobileCommand", label: "Mobile Pairing" },
  { command: "tasks", component: "TUITasksCommand", label: "Tasks" },
  { command: "skills", component: "TUISkillsCommand", label: "Skills" },
  { command: "mcp", component: "TUIMcpCommand", label: "MCP Services" },
  { command: "lsp", component: "TUILspCommand", label: "Language Servers" },
  {
    command: "subagents",
    component: "TUISubagentsCommand",
    label: "Subagents",
  },
  {
    command: "artifacts",
    component: "TUIArtifactsCommand",
    label: "Artifacts",
  },
  { command: "journey", component: "TUIJourneyCommand", label: "Journey" },
  { command: "settings", component: "TUISettingsCommand", label: "Settings" },
];

describe("CLI TUI source wiring", () => {
  test("main menu and direct command routing cover operational panels", () => {
    for (const panel of tuiPanels) {
      expect(cliTuiMenuSource).toContain(`label: "${panel.label}"`);
      expect(cliTuiMenuSource).toContain(`action: "${panel.command}"`);
      expect(cliTuiAppSource).toContain(`case "${panel.command}":`);
      expect(cliTuiAppSource).toContain(panel.component);
    }
    expect(cliSource).toContain("const settings = parseTuiLaunchSettings(launchArgs)");
    expect(cliSource).toContain("await renderTUI(settings.command, launchArgs)");
    expect(cliTuiMenuSource).toContain("Direct launch: cybara tui <panel> · Press ? for keys");
    expect(cliTuiAppSource).toContain("<MainMenu");
    expect(cliTuiAppSource).toContain("onOpenPanel");
    expect(cliTuiAppSource).toContain("<TUIBackProvider onBack={goBack}>");
    expect(cliTuiAppSource).toContain("onOpenPanel={onOpenPanel}");
    expect(cliSource).not.toContain("render(<TUIApp command={action}");
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
    expect(cliTuiMenuSource).toContain('height={layout.rows} width="100%"');
    expect(cliTuiMenuSource).toContain("layout.rows - (layout.narrow ? 21 : 24)");
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
      "/api/evals",
      "/api/router/status",
      "/api/sessions",
      "/api/logs/system?limit=12",
      "/api/mobile/devices",
      "/api/channels",
      "/api/memory/status",
      "/api/memory",
      "/api/tools",
      "/api/browser/status",
      "/api/browser/tabs",
      "/api/wallet/status",
      "/api/wallet/agent-policy",
      "/api/mcp",
      "/oauth/start",
      "/api/lsp/install-status",
      "/api/subagents",
      "/api/artifacts",
      "/api/journey",
    ]) {
      expect(
        cliTuiAppSource + cliTuiPanelsSource + cliTuiOperationsPanelsSource + cliEvalsSource
      ).toContain(route);
    }
  });

  test("settings panel edits shared accessibility, chat, and safety configuration", () => {
    expect(cliTuiSettingsSource).toContain('fetchAPI<SettingsConfig>("/api/config")');
    expect(cliTuiSettingsSource).toContain("chat_appearance");
    expect(cliTuiSettingsSource).toContain("follow_up_behavior_enabled");
    expect(cliTuiSettingsSource).toContain("Terminal wheel step");
    expect(cliTuiSettingsSource).toContain("tool_approval_mode");
    expect(cliTuiSettingsSource).toContain("terminal_enabled");
    expect(cliTuiSettingsSource).toContain("dangerous_tool_policy");
    expect(cliTuiSettingsSource).toContain("Changes apply to every connected app.");
  });

  test("plugins panel summarizes bundles, account apps, and MCP services", () => {
    expect(cliPluginsSource).toContain('fetchAPI<{ plugins: PluginStatus[] }>("/api/plugins")');
    expect(cliPluginsSource).toContain('fetchAPI<ConnectorStatus[]>("/api/connectors")');
    expect(cliPluginsSource).toContain('fetchAPI<MCPServiceStatus[]>("/api/mcp")');
    expect(cliPluginsSource).toContain("Installed bundles");
    expect(cliPluginsSource).toContain("Account apps");
    expect(cliPluginsSource).toContain("MCP services");
  });

  test("terminal panels occupy a stable responsive viewport", () => {
    expect(cliTuiPanelsSource).toContain("height={layout.rows}");
    expect(cliTuiPanelsSource).toContain('width="100%"');
    expect(cliTuiPanelsSource).toContain("panelListLimit");
    expect(cliTuiPanelsSource).toContain("PanelRemainder");
    expect(cliTuiChatSource).toContain('height={layout.rows} width="100%"');
    expect(cliTuiChatSource).toContain('flexDirection={layout.compact ? "column" : "row"}');
    expect(cliTuiChatSource).toMatch(
      /layout\.compact\s*\?\s*Math\.max\(18, layout\.columns - 26\)/
    );
    expect(cliTuiChatSource).toContain("layout.rows - (layout.compact ? 18 : 22)");
    expect(cliTuiInteractiveChatSource).toContain("height={layout.rows}");
    expect(cliTuiInteractiveChatSource).toContain("width={layout.columns}");
    expect(cliTuiInteractiveChatSource).toContain("backgroundColor={tuiPalette.canvas}");
    expect(cliTuiInteractiveChatSource).toContain("flexGrow={1}");
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
      "mcp",
      "lsp",
      "subagents",
      "artifacts",
      "journey",
      "settings",
    ]) {
      expect(cliDocs).toContain(`cybara tui ${command}`);
    }
  });

  test("chat TUI surfaces terminal chat queue and steering controls", () => {
    expect(cliTuiChatSource).toContain("/api/sessions");
    expect(cliTuiChatSource).toContain("/api/sessions?limit=48&includeTotal=1");
    expect(cliTuiChatSource).toContain("/api/agents/summary");
    expect(cliTuiChatSource).toContain("const response = await sessionsRequest");
    expect(cliTuiChatSource).toContain("const agentResponse = await agentsRequest");
    expect(cliTuiChatSource).not.toContain("const [response, agentResponse] = await Promise.all");
    expect(cliTuiChatSource).toContain("setSessions(nextSessions)");
    expect(cliTuiChatSource).toContain("offset=${sessions.length}");
    expect(cliTuiChatSource).toContain('input === "l"');
    expect(cliTuiChatSource).toContain("Load more sessions");
    expect(cliTuiChatSource).toContain('input === "n"');
    expect(cliTuiChatSource).toContain("setSearchMode(true)");
    expect(cliTuiChatSource).toContain("InteractiveChatTUI");
    expect(cliTuiChatSource).toContain("Recent sessions");
    expect(cliTuiChatSource).toMatch(/cybara chat\s+queue\|steer/);
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
      "/skills",
      "/mcp",
      "/lsp",
      "/ide",
      "/memory",
      "/logs",
      "/agent",
      "/model",
      "/router",
      "/permissions",
      "/tools",
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
      "/search",
      "/find",
      "/copy",
      "/export",
      "/terminal-info",
      "/raw",
      "/details",
      "/review",
      "/expand",
      "/resume",
      "/sessions",
    ]) {
      expect(`${cliTuiInteractiveChatSource}\n${cliTuiCommandsSource}`).toContain(command);
    }
    for (const route of [
      "/api/agents/summary",
      "/api/config",
      "/api/tools/approvals",
      "/api/tools/approvals/resolve",
      "/api/router/status",
      "/api/tasks",
      "/api/subagents",
      "/api/subagents/spawn",
      "/api/skills/status",
      "/api/mcp",
      "/api/lsp/install-status",
      "/api/memory/status",
      "/api/memory",
      "/api/logs/system?limit=${count}",
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
    expect(cliTuiInteractiveChatSource).toContain("maintainTUIStatusStream");
    expect(cliTuiInteractiveChatSource).toContain("/api/chat/capabilities");
    expect(cliTuiInteractiveChatSource).toContain("CapabilityPalette");
    expect(cliTuiInteractiveChatSource).toContain("Enter queues · /steer injects");
    expect(cliTuiInteractiveChatSource).toContain(
      "Draft cleared. Press Esc again to return to sessions."
    );
    expect(cliTuiInteractiveChatSource).toContain("Queue follow-up");
    expect(cliTuiInteractiveChatSource).toContain('value === "?"');
    expect(cliTuiInteractiveChatSource).toContain('value === "t"');
    expect(cliTuiInteractiveChatSource).toContain('value === "o"');
    expect(cliTuiInteractiveChatSource).toContain('value === "f"');
    expect(cliTuiInteractiveChatSource).toContain('value === "p"');
    expect(cliTuiInteractiveChatSource).toContain("Follow-ups off");
    expect(cliTuiInteractiveChatSource).toContain("follow_up_behavior_enabled");
    expect(cliTuiInteractiveChatSource).toContain("runTuiPreferenceCommand");
    expect(cliTuiCommandsSource).toContain('{ name: "/followups"');
    expect(cliTuiInteractiveChatSource).toContain("sessionIdRef.current = turnSessionId");
    expect(cliTuiInteractiveChatSource).toContain("CommandPalette");
    expect(cliTuiInteractiveChatSource).toContain("TranscriptSearchPanel");
    expect(cliTuiInteractiveChatSource).toContain("searchTUITranscript");
    expect(cliTuiInteractiveChatSource).toContain("formatTUIConversationExport");
    expect(cliTuiInteractiveChatSource).toContain("tuiTerminalDiagnosticLines");
    expect(cliTuiChatHistorySource).toContain("nextTUITranscriptSearchIndex");
    expect(cliTuiChatHistorySource).toContain("nthLatestAssistantResponse");
    expect(cliTuiInteractiveChatSource).toContain("nextTUIChatCommandIndex");
    expect(cliTuiInteractiveChatSource).toContain("selectCommand");
    expect(cliTuiInteractiveChatSource).toContain("selectedIndex={commandIndex}");
    expect(cliTuiInteractiveChatSource).toContain("ChatHeader");
    expect(cliTuiInteractiveChatSource).toContain("ChatShortcutRail");
    expect(cliTuiInteractiveChatSource).toContain(
      "borderColor={sending ? palette.accent : palette.chrome}"
    );
    expect(cliTuiInteractiveChatSource).toContain("backgroundColor={palette.background}");
    expect(cliTuiChatEnvironmentViewSource).toContain("borderColor={palette.chrome}");
    expect(cliTuiChatChromeSource).toContain("color={palette.shortcut}");
    expect(cliTuiInteractiveChatSource).not.toContain("<Box marginTop={1} flexShrink={0}>");
    expect(cliTuiInteractiveChatSource).toContain("EnvironmentPanel");
    expect(cliTuiInteractiveChatSource).toContain("resolveTerminalChatInspector");
    expect(cliTuiInteractiveChatSource).toContain('variant="sidebar"');
    expect(cliTuiInteractiveChatSource).toContain("environmentSidebarVisible");
    expect(cliTuiInteractiveChatSource).toContain("?sessionId=");
    expect(cliTuiInteractiveChatSource).toContain("environmentSnapshotFromDetail");
    expect(cliTuiInteractiveChatSource).toContain("formatContextUsageLine");
    expect(cliTuiInteractiveChatSource).toContain("formatTokenUsageLine");
    expect(cliTuiInteractiveChatSource).toContain("formatFileChangeLine");
    expect(cliTuiInteractiveChatSource).toContain("formatTaskLine");
    expect(cliTuiInteractiveChatSource).toContain("formatSubagentLine");
    expect(cliTuiInteractiveChatSource).toContain("setUseModelRouter(true)");
    expect(cliTuiInteractiveChatSource).toContain("tool_approval_mode");
    expect(cliTuiInteractiveChatSource).toContain("tool_profile: value");
    expect(cliTuiInteractiveChatSource).toContain("full|coding|research|safe|show");
    expect(cliTuiInteractiveChatSource).toContain("agentId: selectedAgentId || undefined");
    expect(cliTuiInteractiveChatSource).toContain("modelOverride: useModelRouter");
    expect(cliTuiInteractiveChatSource).not.toContain('command === "model" ? "agent"');
    expect(cliTuiInteractiveChatSource).toContain("Ctrl+J newline");
    expect(cliTuiInteractiveChatSource).toContain("pageUp");
    expect(cliTuiInteractiveChatSource).toContain("pageDown");
    expect(cliTuiInteractiveChatSource).toContain("parseTerminalMouseEvent");
    expect(cliTuiInteractiveChatSource).toContain("useTerminalMouseScrolling");
    expect(cliTuiInteractiveChatSource).toContain(
      "normalizedTranscriptOffset < maximumTranscriptOffset"
    );
    expect(cliTuiInteractiveChatSource).toContain("key.home && input.length === 0");
    expect(cliTuiInteractiveChatSource).toContain("key.end && input.length === 0");
    expect(cliTuiInteractiveChatSource).toContain("sending && normalizedTranscriptOffset === 0");
    expect(cliTuiInteractiveChatSource).toMatch(
      /React\.useEffect\(\(\) => \{\s*if \(sending\) return;\s*void loadMessages\(\);/
    );
    expect(cliTuiInteractiveChatSource).toMatch(/expandedTranscript\s*\? expandedMessageLines/);
    expect(cliTuiInteractiveChatSource).toContain(
      "const [expandedTranscript, setExpandedTranscript] = React.useState(false)"
    );
    expect(cliTuiInteractiveChatSource).toContain("<TerminalInlineText");
    expect(cliTuiInteractiveChatSource).toContain("baseColor={palette.detail}");
    expect(cliTuiInteractiveChatSource).not.toContain("compact(row.label");
    expect(cliTuiInteractiveChatSource).not.toContain(
      "<MessageBody content={content} maxLines={8} />"
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
    expect(cliTuiInteractiveChatSource).toContain("palette[tuiActivityTone(row)]");
    expect(cliTuiInteractiveChatSource).toContain("palette.detail");
    expect(cliTuiInteractiveChatSource).toContain("key={`${row.id}-${rowIndex}`}");
    expect(cliTuiInteractiveChatSource).toContain(
      "maxActivityDetails={expandedActivities ? undefined : 0}"
    );
    expect(cliTuiInteractiveChatSource).toContain('normalizedCommand === "details"');
    expect(cliTuiMarkdownRenderSource).toContain("strikethrough={part.strikethrough}");
    expect(cliTuiMarkdownRenderSource).toContain("splitTerminalInline(line)");
    expect(cliTuiMarkdownRenderSource).toContain('<Text wrap="wrap">');
    expect(cliTuiMarkdownRenderSource).toContain('flexDirection="column" width="100%"');
    expect(cliTuiInteractiveChatSource).toContain('overflow="hidden"');
    expect(cliTuiInteractiveChatSource).toContain("flexShrink={0}");
    expect(cliTuiMarkdownRenderSource).toContain("parseTerminalListItem(line.text)");
  });

  test("chat session picker supports pinning and guarded deletion", () => {
    expect(cliTuiChatSource).toContain("toggleSelectedPin");
    expect(cliTuiChatSource).toContain("deleteSelectedSession");
    expect(cliTuiChatSource).toContain("confirmDeleteId");
    expect(cliTuiChatSource).toContain("/pin");
    expect(cliTuiChatSource).toContain('method: "DELETE"');
  });

  test("new terminal chats inherit the current workspace", () => {
    expect(cliTuiChatSource).toContain(
      "initialWorkspaceDir={sessionWorkspace(openSession) || process.cwd()}"
    );
    expect(cliTuiInteractiveChatSource).toContain("initialWorkspaceDir?: string;");
    expect(cliTuiInteractiveChatSource).toContain('initialWorkspaceDir || ""');
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
    expect(cliTuiChatEnvironmentViewSource).toContain(
      'EnvironmentPanelVariant = "stacked" | "sidebar"'
    );
    expect(cliTuiChatEnvironmentViewSource).toContain("Usage");
    expect(cliTuiChatEnvironmentViewSource).toContain("Changes");
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
