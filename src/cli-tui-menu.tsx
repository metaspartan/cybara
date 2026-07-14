import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useTerminalLayout } from "./cli-tui-terminal";
import { useTUIBack } from "./cli-tui-navigation";

const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode === "function",
};

type MenuItemKind = "panel" | "action";

export type MainMenuAction =
  | "status"
  | "metrics"
  | "agents"
  | "providers"
  | "router"
  | "usage"
  | "evals"
  | "channels"
  | "plugins"
  | "memory"
  | "tools"
  | "browser"
  | "wallet"
  | "chat"
  | "sessions"
  | "logs"
  | "mobile"
  | "tasks"
  | "skills"
  | "mcp"
  | "lsp"
  | "subagents"
  | "artifacts"
  | "journey"
  | "backups"
  | "ui"
  | "start"
  | "exit";

type MenuItem = {
  action: MainMenuAction;
  detail: string;
  group: "Workflows" | "System" | "Setup";
  kind: MenuItemKind;
  label: string;
  shortcut: string;
};

export const DIRECT_TUI_PANEL_HINT =
  "Direct launch: cybara tui <panel> · Press ? for keys";

export const MAIN_TUI_MENU_ITEMS: MenuItem[] = [
  {
    label: "Chat",
    action: "chat",
    shortcut: "c",
    group: "Workflows",
    kind: "panel",
    detail: "Terminal chat with queueing, steering, slash commands, and session history",
  },
  {
    label: "Browser Preview",
    action: "browser",
    shortcut: "1",
    group: "Workflows",
    kind: "panel",
    detail: "Agent-visible browser runtime and open tabs",
  },
  {
    label: "Tasks",
    action: "tasks",
    shortcut: "t",
    group: "Workflows",
    kind: "panel",
    detail: "Scheduled and delegated agent work",
  },
  {
    label: "Sessions",
    action: "sessions",
    shortcut: "s",
    group: "Workflows",
    kind: "panel",
    detail: "Recent chat sessions and active runs",
  },
  {
    label: "Agents",
    action: "agents",
    shortcut: "a",
    group: "Workflows",
    kind: "panel",
    detail: "Configured agent identities, status, and models",
  },
  {
    label: "Subagents",
    action: "subagents",
    shortcut: "n",
    group: "Workflows",
    kind: "panel",
    detail: "Active and completed delegated agent runs",
  },
  {
    label: "Agent Evals",
    action: "evals",
    shortcut: "3",
    group: "Workflows",
    kind: "panel",
    detail: "Golden trajectories and structural regression status",
  },
  {
    label: "Artifacts",
    action: "artifacts",
    shortcut: "f",
    group: "Workflows",
    kind: "panel",
    detail: "Session deliverables, notes, walkthroughs, and implementation records",
  },
  {
    label: "Journey",
    action: "journey",
    shortcut: "y",
    group: "Workflows",
    kind: "panel",
    detail: "Recent learned skills and durable memory activity",
  },
  {
    label: "Providers",
    action: "providers",
    shortcut: "p",
    group: "Setup",
    kind: "panel",
    detail: "Provider health, authentication, and plan usage",
  },
  {
    label: "Model Router",
    action: "router",
    shortcut: "v",
    group: "Setup",
    kind: "panel",
    detail: "Routing strategy, fallback windows, and automatic provider limits",
  },
  {
    label: "Usage",
    action: "usage",
    shortcut: "u",
    group: "Setup",
    kind: "panel",
    detail: "Automatic 5-hour and weekly coding-plan usage",
  },
  {
    label: "Channels",
    action: "channels",
    shortcut: "h",
    group: "Setup",
    kind: "panel",
    detail: "Connection state, access policy, and default agent routing",
  },
  {
    label: "Plugins",
    action: "plugins",
    shortcut: "4",
    group: "Setup",
    kind: "panel",
    detail: "Installed bundles, account apps, and MCP services",
  },
  {
    label: "Mobile Pairing",
    action: "mobile",
    shortcut: "m",
    group: "Setup",
    kind: "panel",
    detail: "Pair phones and review mobile device access",
  },
  {
    label: "Skills",
    action: "skills",
    shortcut: "i",
    group: "Setup",
    kind: "panel",
    detail: "Installed skills and bundled capability packs",
  },
  {
    label: "Tools",
    action: "tools",
    shortcut: "w",
    group: "Setup",
    kind: "panel",
    detail: "Available tools, categories, and permissions",
  },
  {
    label: "MCP Services",
    action: "mcp",
    shortcut: "b",
    group: "Setup",
    kind: "panel",
    detail: "Connected MCP services, runtime state, and available tools",
  },
  {
    label: "Language Servers",
    action: "lsp",
    shortcut: "z",
    group: "Setup",
    kind: "panel",
    detail: "Bundled and installed language server availability",
  },
  {
    label: "Status",
    action: "status",
    shortcut: "g",
    group: "System",
    kind: "panel",
    detail: "Gateway health, uptime, and runtime summary",
  },
  {
    label: "Metrics",
    action: "metrics",
    shortcut: "x",
    group: "System",
    kind: "panel",
    detail: "Token, tool, API, and provider usage",
  },
  {
    label: "Memory",
    action: "memory",
    shortcut: "e",
    group: "System",
    kind: "panel",
    detail: "Memory provider status and recent durable entries",
  },
  {
    label: "Backups",
    action: "backups",
    shortcut: "k",
    group: "System",
    kind: "panel",
    detail: "Create and inspect private gateway restore points",
  },
  {
    label: "Wallet",
    action: "wallet",
    shortcut: "2",
    group: "System",
    kind: "panel",
    detail: "Wallet security, addresses, and agent transaction policy",
  },
  {
    label: "Logs",
    action: "logs",
    shortcut: "l",
    group: "System",
    kind: "panel",
    detail: "Recent gateway and app logs",
  },
  {
    label: "Open Web UI",
    action: "ui",
    shortcut: "o",
    group: "System",
    kind: "action",
    detail: "Open the browser client for the same gateway",
  },
  {
    label: "Start Server",
    action: "start",
    shortcut: "d",
    group: "System",
    kind: "action",
    detail: "Start the local gateway in development mode",
  },
  {
    label: "Exit",
    action: "exit",
    shortcut: "q",
    group: "System",
    kind: "action",
    detail: "Close the TUI",
  },
];

type MainMenuProps = {
  apiBase: string;
  header?: React.ReactNode;
  updateBanner?: React.ReactNode;
  onOpenPanel: (action: MainMenuAction) => void;
  onOpenWebUI: () => void;
  onStartServer: () => void;
};

function matchesItem(item: MenuItem, query: string): boolean {
  if (!query) return true;
  return [item.label, item.action, item.group, item.detail, item.shortcut]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function selectedIndexForShortcut(items: MenuItem[], input: string): number {
  return items.findIndex((item) => item.shortcut === input || item.action === input);
}

export function MainMenu({
  apiBase,
  header,
  updateBanner,
  onOpenPanel,
  onOpenWebUI,
  onStartServer,
}: MainMenuProps): React.ReactElement {
  const exit = useTUIBack();
  const layout = useTerminalLayout();
  const [selected, setSelected] = React.useState(0);
  const [searchMode, setSearchMode] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [showHelp, setShowHelp] = React.useState(false);
  const [status, setStatus] = React.useState<{
    message: string;
    type: "info" | "success" | "error" | "loading";
  } | null>(null);

  const menuItems = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return MAIN_TUI_MENU_ITEMS.filter((item) => matchesItem(item, normalized));
  }, [query]);

  React.useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, menuItems.length - 1)));
  }, [menuItems.length]);

  const runAction = React.useCallback(
    (action: MainMenuAction) => {
      setStatus(null);
      if (action === "exit") {
        exit();
        return;
      }
      if (action === "ui") {
        setStatus({ message: "Opening browser...", type: "info" });
        onOpenWebUI();
        return;
      }
      if (action === "start") {
        setStatus({ message: "Starting Cybara server...", type: "loading" });
        onStartServer();
        return;
      }
      onOpenPanel(action);
    },
    [exit, onOpenPanel, onOpenWebUI, onStartServer]
  );

  useInput(
    (input, key) => {
      if (searchMode) {
        if ((key.ctrl && input === "c") || key.escape) {
          setSearchMode(false);
          return;
        }
        if (key.return) {
          setSearchMode(false);
          return;
        }
        if (key.backspace || key.delete) {
          setQuery((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setQuery((value) => value + input);
        return;
      }

      if ((key.ctrl && input === "c") || input === "q") {
        exit();
        return;
      }
      if (input === "?") {
        setShowHelp((value) => !value);
        return;
      }
      if (input === "/") {
        setSearchMode(true);
        return;
      }
      if (input === "r") {
        setQuery("");
        setStatus({ message: "Menu refreshed.", type: "success" });
        return;
      }
      if (key.upArrow || input === "k") {
        setSelected((value) => (value > 0 ? value - 1 : Math.max(0, menuItems.length - 1)));
        return;
      }
      if (key.downArrow || input === "j") {
        setSelected((value) => (value < menuItems.length - 1 ? value + 1 : 0));
        return;
      }
      if (key.return) {
        const item = menuItems[selected];
        if (item) runAction(item.action);
        return;
      }
      const shortcutIndex = selectedIndexForShortcut(menuItems, input);
      if (shortcutIndex >= 0) {
        runAction(menuItems[shortcutIndex].action);
      }
    },
    TUI_INPUT_OPTIONS
  );

  const selectedItem = menuItems[selected];
  const groups = ["Workflows", "Setup", "System"] as const;
  const availableRows = Math.max(4, layout.rows - (layout.narrow ? 21 : 24));
  const visibleCount = Math.min(menuItems.length, availableRows);
  const visibleStart = Math.max(
    0,
    Math.min(menuItems.length - visibleCount, selected - Math.floor(visibleCount / 2))
  );
  const visibleMenuItems = menuItems.slice(visibleStart, visibleStart + visibleCount);

  return (
    <Box flexDirection="column" height={layout.rows} width="100%">
      {header}
      {updateBanner}
      <Box marginBottom={1} flexDirection="column" flexShrink={0}>
        <Text color="gray">Gateway: {apiBase}</Text>
        <Text color="gray">{DIRECT_TUI_PANEL_HINT}</Text>
      </Box>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={layout.narrow ? 1 : 2}
        paddingY={1}
        flexGrow={1}
      >
        <Box
          flexDirection={layout.narrow ? "column" : "row"}
          justifyContent="space-between"
          flexShrink={0}
        >
          <Text bold color="cyan">
            Cybara TUI
          </Text>
          <Text color="gray">
            {layout.narrow
              ? "j/k move · ↵ open · / search"
              : "↑↓/j/k · ↵ open · / search · ? help · q quit"}
          </Text>
        </Box>
        <Text color={searchMode ? "cyan" : query ? "yellow" : "gray"}>
          Search: {query || (searchMode ? "type to filter" : "press /")}
          {searchMode ? "▏" : ""}
        </Text>
        {visibleStart > 0 && <Text color="gray">↑ {visibleStart} more</Text>}
        {groups.map((group) => {
          const items = visibleMenuItems.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <Box key={group} flexDirection="column" marginTop={1}>
              <Text color="gray">{group}</Text>
              {items.map((item) => {
                const index = menuItems.indexOf(item);
                const active = index === selected;
                return (
                  <Box key={item.action} justifyContent="space-between">
                    <Text bold={active} color={active ? "cyan" : "white"}>
                      {active ? "❯ " : "  "}
                      [{item.shortcut}] {item.label}
                    </Text>
                    {layout.narrow ? null : (
                      <Text color={active ? "cyan" : "gray"}>
                        {item.kind === "panel" ? "panel" : "action"}
                      </Text>
                    )}
                  </Box>
                );
              })}
            </Box>
          );
        })}
        {visibleStart + visibleMenuItems.length < menuItems.length && (
          <Text color="gray">
            ↓ {menuItems.length - visibleStart - visibleMenuItems.length} more
          </Text>
        )}
      </Box>
      {selectedItem && !layout.narrow ? (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          flexShrink={0}
        >
          <Text bold>{selectedItem.label}</Text>
          <Text color="gray">{selectedItem.detail}</Text>
          <Text color="gray">Shortcut: {selectedItem.shortcut} · Command: cybara tui {selectedItem.action}</Text>
        </Box>
      ) : null}
      {showHelp ? (
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Text bold color="cyan">
            Keys
          </Text>
          <Text>j/k or arrows move · Enter opens · shortcuts jump directly · / filters panels</Text>
          <Text>r clears search · ? toggles this help · q quits</Text>
        </Box>
      ) : null}
      {status ? (
        <Box marginY={1}>
          {status.type === "loading" ? (
            <Text color="yellow">
              <Spinner type="dots" /> {status.message}
            </Text>
          ) : (
            <Text color={status.type === "success" ? "green" : status.type === "error" ? "red" : "cyan"}>
              {status.type === "success" ? "✓" : status.type === "error" ? "✗" : "→"} {status.message}
            </Text>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
