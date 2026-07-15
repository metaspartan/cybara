export interface TUIChatCommandOption {
  name: string;
  detail: string;
}

export const TUI_CHAT_COMMANDS: TUIChatCommandOption[] = [
  { name: "/help", detail: "Show command reference" },
  { name: "/status", detail: "Show session, model, and queue state" },
  { name: "/agents", detail: "List available agents" },
  { name: "/skills", detail: "Show installed and available skills" },
  { name: "/mcp", detail: "Show connected MCP services" },
  { name: "/lsp", detail: "Show language server status" },
  { name: "/memory", detail: "Show memory and indexing health" },
  { name: "/logs", detail: "Show recent gateway logs" },
  { name: "/agent", detail: "Switch the active chat agent" },
  { name: "/transfer", detail: "Transfer this chat to another agent" },
  { name: "/model", detail: "Show or override the model for future turns" },
  { name: "/router", detail: "Use or disable model router for new turns" },
  { name: "/permissions", detail: "Show or change tool approval mode" },
  { name: "/followups", detail: "Show or change queue and steer behavior" },
  { name: "/tools", detail: "Show or change the active agent tool profile" },
  { name: "/reasoning", detail: "Show or change reasoning effort" },
  { name: "/title", detail: "Rename the current session" },
  { name: "/workspace", detail: "Show or change the current workspace" },
  { name: "/context", detail: "Show context, compaction, and token usage" },
  { name: "/usage", detail: "Show token usage for this session" },
  { name: "/environment", detail: "Toggle the environment panel" },
  { name: "/plan", detail: "Show the latest plan state" },
  { name: "/goal", detail: "Manage a persistent session goal" },
  { name: "/loop", detail: "Alias for session goal workflows" },
  { name: "/diff", detail: "Show file changes detected in the session" },
  { name: "/diffs", detail: "Show file changes detected in the session" },
  { name: "/tasks", detail: "Show current tasks" },
  { name: "/subagents", detail: "List or spawn subagents" },
  { name: "/compact", detail: "Show compaction status" },
  { name: "/pending", detail: "Refresh queued follow-ups" },
  { name: "/queue", detail: "Queue a follow-up while the run continues" },
  { name: "/steer", detail: "Inject a queued message into the active run" },
  { name: "/edit", detail: "Edit a queued follow-up" },
  { name: "/delete", detail: "Delete a queued follow-up" },
  { name: "/reorder", detail: "Reorder queued follow-ups" },
  { name: "/stop", detail: "Stop the active run" },
  { name: "/reload", detail: "Refetch session messages" },
  { name: "/copy", detail: "Copy the latest assistant response" },
  { name: "/raw", detail: "Toggle complete copy-friendly messages" },
  { name: "/review", detail: "Load a workspace review prompt" },
  { name: "/details", detail: "Expand or collapse completed work details" },
  { name: "/expand", detail: "Toggle full or compact transcript messages" },
  { name: "/clear", detail: "Clear the local view" },
  { name: "/new", detail: "Start a new session in this TUI" },
  { name: "/resume", detail: "Return to the saved session picker" },
  { name: "/sessions", detail: "Return to the saved session picker" },
  { name: "/quit", detail: "Return to the session list" },
  { name: "/exit", detail: "Return to the session list" },
];

export function matchingTUIChatCommands(
  input: string,
  limit = TUI_CHAT_COMMANDS.length
): TUIChatCommandOption[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/") || /\s/.test(trimmed)) return [];
  return TUI_CHAT_COMMANDS.filter((command) => command.name.startsWith(trimmed)).slice(
    0,
    Math.max(0, limit)
  );
}

export function nextTUIChatCommandIndex(current: number, direction: -1 | 1, count: number): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}

export function completeTUIChatCommand(input: string, selectedIndex: number): string | null {
  const matches = matchingTUIChatCommands(input);
  if (matches.length === 0) return null;
  const option = matches[Math.min(Math.max(0, selectedIndex), matches.length - 1)];
  if (!option || input.trim() === option.name) return null;
  return `${option.name} `;
}
