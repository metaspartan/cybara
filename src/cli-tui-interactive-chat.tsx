import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import type { TUIFetchAPI } from "./cli-tui-chat";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  process_activities?: ActivityItem[];
  tool_calls?: ToolCallItem[];
}

interface ActivityItem {
  phase?: string;
  text?: string;
  toolName?: string;
}

interface ToolCallItem {
  name?: string;
  status?: string;
}

interface PendingMessage {
  id: string;
  content: string;
  sequence?: number;
  mode?: string;
  createdAt?: number;
}

interface AgentSummary {
  id?: string;
  name?: string;
  model?: string;
  provider_id?: string;
  providerId?: string;
  status?: string;
}

interface RouterStatus {
  enabled?: boolean;
  strategy?: string;
}

interface ControlPlaneState {
  agents: AgentSummary[];
  approvalMode: string;
  routerStatus: RouterStatus | null;
}

interface InteractiveChatProps {
  fetchAPI: TUIFetchAPI;
  initialAgentId?: string;
  sessionId?: string;
  title?: string;
  modelLine?: string;
  onExit: () => void;
}

const COMMANDS = [
  { name: "/help", detail: "Show command reference" },
  { name: "/status", detail: "Show session, model, and queue state" },
  { name: "/agents", detail: "List available agents" },
  { name: "/agent", detail: "Switch the active chat agent" },
  { name: "/router", detail: "Use or disable model router for new turns" },
  { name: "/permissions", detail: "Show or change tool approval mode" },
  { name: "/pending", detail: "Refresh queued follow-ups" },
  { name: "/queue", detail: "Queue a follow-up while the run continues" },
  { name: "/steer", detail: "Inject a queued message into the active run" },
  { name: "/edit", detail: "Edit a queued follow-up" },
  { name: "/delete", detail: "Delete a queued follow-up" },
  { name: "/reorder", detail: "Reorder queued follow-ups" },
  { name: "/stop", detail: "Stop the active run" },
  { name: "/reload", detail: "Refetch session messages" },
  { name: "/clear", detail: "Clear the local view" },
  { name: "/new", detail: "Start a new session in this TUI" },
  { name: "/quit", detail: "Return to the session list" },
];

const ROLE_META: Record<ChatMessage["role"], { label: string; color: string; marker: string }> = {
  user: { label: "You", color: "cyan", marker: ">" },
  assistant: { label: "Cybara", color: "green", marker: "*" },
  system: { label: "System", color: "gray", marker: "-" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function activitiesFrom(value: unknown): ActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (isRecord(item) ? [item as ActivityItem] : []));
}

function toolCallsFrom(value: unknown): ToolCallItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (isRecord(item) ? [item as ToolCallItem] : []));
}

function pendingFrom(value: unknown): PendingMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.content !== "string") {
      return [];
    }
    return [item as unknown as PendingMessage];
  });
}

function agentsFrom(value: unknown): AgentSummary[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.agents)
      ? value.agents
      : [];
  return raw.flatMap((item) => (isRecord(item) ? [item as AgentSummary] : []));
}

function agentLine(agent: AgentSummary): string {
  const name = typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : agent.id;
  const model = typeof agent.model === "string" && agent.model.trim() ? agent.model.trim() : "";
  const status = typeof agent.status === "string" && agent.status.trim() ? agent.status.trim() : "";
  return [name, model, status].filter(Boolean).join(" · ") || "Unnamed agent";
}

function compact(value: string, max = 52): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function resolveAgentId(raw: string, agents: AgentSummary[]): string | null {
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  const exact = agents.find(
    (agent) =>
      agent.id?.toLowerCase() === needle ||
      agent.name?.toLowerCase() === needle ||
      agent.model?.toLowerCase() === needle
  );
  if (exact?.id) return exact.id;
  const partial = agents.find(
    (agent) =>
      agent.name?.toLowerCase().includes(needle) ||
      agent.model?.toLowerCase().includes(needle) ||
      agent.id?.toLowerCase().startsWith(needle)
  );
  return partial?.id || null;
}

function messagesFromResponse(value: unknown): ChatMessage[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : isRecord(value) && Array.isArray(value.messagesList)
        ? value.messagesList
        : [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const role = item.role;
    const content = contentText(item.content);
    if ((role === "user" || role === "assistant" || role === "system") && content) {
      out.push({
        role,
        content,
        process_activities: activitiesFrom(item.process_activities),
        tool_calls: toolCallsFrom(item.tool_calls),
      });
    }
  }
  return out;
}

function commandMatches(input: string) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return [];
  return COMMANDS.filter((command) => command.name.startsWith(trimmed.split(/\s+/)[0])).slice(0, 6);
}

function resolvePendingId(raw: string | undefined, pending: PendingMessage[]): string | null {
  if (!raw) return null;
  if (raw.startsWith("#")) {
    const sequence = Number(raw.slice(1));
    return pending.find((message) => message.sequence === sequence)?.id || null;
  }
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) {
    return pending.find((message) => message.sequence === numeric)?.id || null;
  }
  return raw;
}

function resolvePendingIds(raw: string[], pending: PendingMessage[]): string[] {
  return raw.flatMap((value) => {
    const id = resolvePendingId(value, pending);
    return id ? [id] : [];
  });
}

function insertAt(value: string, cursor: number, insert: string): [string, number] {
  return [value.slice(0, cursor) + insert + value.slice(cursor), cursor + insert.length];
}

function deleteBefore(value: string, cursor: number): [string, number] {
  if (cursor <= 0) return [value, cursor];
  return [value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1];
}

function deleteAt(value: string, cursor: number): string {
  if (cursor >= value.length) return value;
  return value.slice(0, cursor) + value.slice(cursor + 1);
}

function withCursor(value: string, cursor: number): string {
  const safeCursor = Math.max(0, Math.min(value.length, cursor));
  return `${value.slice(0, safeCursor)}▏${value.slice(safeCursor) || " "}`;
}

function relativeTime(value?: number): string {
  if (!value) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function splitInline(line: string): Array<{ text: string; bold?: boolean; code?: boolean }> {
  const parts: Array<{ text: string; bold?: boolean; code?: boolean }> = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let offset = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > offset) parts.push({ text: line.slice(offset, match.index) });
    const token = match[0];
    if (token.startsWith("**")) parts.push({ text: token.slice(2, -2), bold: true });
    else parts.push({ text: token.slice(1, -1), code: true });
    offset = match.index + token.length;
  }
  if (offset < line.length) parts.push({ text: line.slice(offset) });
  return parts.length ? parts : [{ text: line || " " }];
}

function InlineMarkdown({ line }: { line: string }): React.ReactElement {
  return (
    <Text>
      {splitInline(line).map((part, index) => (
        <Text key={index} bold={part.bold} color={part.code ? "magenta" : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function MessageBody({ content }: { content: string }): React.ReactElement {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const fence = line.match(/^\s*```(\w*)\s*$/);
        if (fence) {
          inCode = !inCode;
          return (
            <Text key={index} color="magenta">
              {inCode ? `code${fence[1] ? ` · ${fence[1]}` : ""}` : "end code"}
            </Text>
          );
        }
        if (inCode) {
          return (
            <Text key={index} color="green">
              {line || " "}
            </Text>
          );
        }
        const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <Text key={index}>
              {bullet[1]}
              <Text color="cyan">• </Text>
              <InlineMarkdown line={bullet[2]} />
            </Text>
          );
        }
        if (/^#{1,6}\s/.test(line)) {
          return (
            <Text key={index} bold>
              {line.replace(/^#{1,6}\s/, "")}
            </Text>
          );
        }
        if (/^\s*>\s?/.test(line)) {
          return (
            <Text key={index} color="gray">
              ▏ {line.replace(/^\s*>\s?/, "")}
            </Text>
          );
        }
        return <InlineMarkdown key={index} line={line} />;
      })}
    </Box>
  );
}

function ActivitySummary({ message }: { message: ChatMessage }): React.ReactElement | null {
  const activities = message.process_activities || [];
  const tools = message.tool_calls || [];
  if (activities.length === 0 && tools.length === 0) return null;
  const labels = [
    ...activities.slice(-4).map((activity) => activity.text || activity.toolName || activity.phase),
    ...tools.slice(-4).map((tool) => `${tool.name || "tool"}${tool.status ? ` ${tool.status}` : ""}`),
  ].filter((label): label is string => typeof label === "string" && label.trim().length > 0);
  const count = activities.length + tools.length;
  return (
    <Box paddingLeft={1} marginBottom={1}>
      <Text color="gray">
        Ran {count} {count === 1 ? "step" : "steps"}
        {labels.length ? ` · ${labels.join(" · ")}` : ""}
      </Text>
    </Box>
  );
}

function MessageView({ message }: { message: ChatMessage }): React.ReactElement {
  const meta = ROLE_META[message.role];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={meta.color}>
          {meta.marker} {meta.label}
        </Text>
      </Box>
      <ActivitySummary message={message} />
      <Box paddingLeft={2}>
        <MessageBody content={message.content} />
      </Box>
    </Box>
  );
}

function PendingQueue({ messages }: { messages: PendingMessage[] }): React.ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
      <Text color="gray">Queued follow-ups</Text>
      {messages.slice(0, 4).map((message, index) => (
        <Text key={message.id} color={message.mode === "steering" ? "yellow" : "white"}>
          #{message.sequence || index + 1} {message.content.slice(0, 72)}
          <Text color="gray"> · {relativeTime(message.createdAt)}</Text>
        </Text>
      ))}
      <Text color="gray">/steer #1 · /edit #1 ... · /delete #1 · /reorder #2 #1</Text>
    </Box>
  );
}

function CommandPalette({ input }: { input: string }): React.ReactElement | null {
  const matches = commandMatches(input);
  if (matches.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      {matches.map((command) => (
        <Text key={command.name}>
          <Text color="cyan">{command.name}</Text>
          <Text color="gray"> — {command.detail}</Text>
        </Text>
      ))}
    </Box>
  );
}

function HelpPanel(): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">
        Chat controls
      </Text>
      <Text>Enter send · Ctrl+J newline · ←/→ move · ↑/↓ history · Tab complete slash command</Text>
      <Text>/agents lists · /agent name switches · /router on|off · /permissions ask|always_allow</Text>
      <Text>/queue queues · /steer injects · /edit, /delete, /reorder manage queue</Text>
      <Text>/stop interrupts · /pending refreshes queue</Text>
      <Text>/reload refetches · /new starts fresh · Esc returns to sessions · Ctrl+C quits</Text>
    </Box>
  );
}

function StatusRail({
  agent,
  approvalMode,
  pendingCount,
  routerStatus,
  sessionId,
  useModelRouter,
}: {
  agent?: AgentSummary;
  approvalMode: string;
  pendingCount: number;
  routerStatus: RouterStatus | null;
  sessionId: string;
  useModelRouter: boolean;
}): React.ReactElement {
  const agentLabel = useModelRouter ? "Model Router" : agent ? agentLine(agent) : "Gateway default";
  const routerLabel = useModelRouter
    ? "selected"
    : routerStatus?.enabled
      ? routerStatus.strategy || "enabled"
      : "off";
  const shortSessionId = sessionId ? sessionId.slice(0, 8) : "new";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        <Text color="gray">Agent </Text>
        <Text color="white">{compact(agentLabel)}</Text>
      </Text>
      <Text>
        <Text color="gray">Tools </Text>
        <Text color={approvalMode === "ask" ? "yellow" : "green"}>{approvalMode}</Text>
        <Text color="gray"> · Router </Text>
        <Text color={useModelRouter || routerStatus?.enabled ? "cyan" : "gray"}>{routerLabel}</Text>
        <Text color="gray"> · Queue </Text>
        <Text color={pendingCount > 0 ? "yellow" : "gray"}>{pendingCount}</Text>
        <Text color="gray"> · Session {shortSessionId}</Text>
      </Text>
    </Box>
  );
}

export function InteractiveChatTUI({
  fetchAPI,
  initialAgentId,
  sessionId,
  title,
  modelLine,
  onExit,
}: InteractiveChatProps): React.ReactElement {
  const { exit } = useApp();
  const [localSessionId, setLocalSessionId] = React.useState(sessionId || "");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = React.useState<PendingMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null);
  const [sending, setSending] = React.useState(false);
  const [loading, setLoading] = React.useState(Boolean(sessionId));
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [agents, setAgents] = React.useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = React.useState(initialAgentId || "");
  const [useModelRouter, setUseModelRouter] = React.useState(false);
  const [approvalMode, setApprovalMode] = React.useState("always_allow");
  const [routerStatus, setRouterStatus] = React.useState<RouterStatus | null>(null);

  const selectedAgent = React.useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId),
    [agents, selectedAgentId]
  );

  const loadControlPlane = React.useCallback(async (): Promise<ControlPlaneState> => {
    const [agentResponse, configResponse, routerResponse] = await Promise.all([
      fetchAPI<unknown>("/api/agents"),
      fetchAPI<unknown>("/api/config"),
      fetchAPI<unknown>("/api/router/status"),
    ]);
    const nextAgents = agentsFrom(agentResponse);
    const nextApprovalMode =
      isRecord(configResponse) && typeof configResponse.tool_approval_mode === "string"
        ? configResponse.tool_approval_mode
        : approvalMode;
    const nextRouterStatus = isRecord(routerResponse) ? (routerResponse as RouterStatus) : null;
    setAgents(nextAgents);
    if (isRecord(configResponse) && typeof configResponse.tool_approval_mode === "string") {
      setApprovalMode(configResponse.tool_approval_mode);
    }
    setRouterStatus(nextRouterStatus);
    return { agents: nextAgents, approvalMode: nextApprovalMode, routerStatus: nextRouterStatus };
  }, [approvalMode, fetchAPI]);

  const loadPendingForSession = React.useCallback(
    async (targetSessionId: string) => {
      const response = await fetchAPI<unknown>(
        `/api/chat/sessions/${encodeURIComponent(targetSessionId)}/pending`
      );
      setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
    },
    [fetchAPI]
  );

  const loadMessagesForSession = React.useCallback(
    async (targetSessionId: string) => {
      const response = await fetchAPI<unknown>(
        `/api/chat/sessions/${encodeURIComponent(targetSessionId)}/messages`
      );
      setMessages(messagesFromResponse(response));
      await loadPendingForSession(targetSessionId);
    },
    [fetchAPI, loadPendingForSession]
  );

  const loadPending = React.useCallback(async () => {
    if (!localSessionId) {
      setPendingMessages([]);
      return;
    }
    await loadPendingForSession(localSessionId);
  }, [loadPendingForSession, localSessionId]);

  const loadMessages = React.useCallback(async () => {
    if (!localSessionId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await loadMessagesForSession(localSessionId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [loadMessagesForSession, localSessionId]);

  React.useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  React.useEffect(() => {
    void loadControlPlane().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [loadControlPlane]);

  const resetInput = React.useCallback(() => {
    setInput("");
    setCursor(0);
    setHistoryIndex(null);
  }, []);

  const runCommand = React.useCallback(
    async (text: string): Promise<boolean> => {
      const [command, ...rest] = text.slice(1).split(/\s+/);
      const argument = rest.join(" ").trim();
      if (command === "help") {
        setShowHelp((value) => !value);
        setNotice("Help toggled.");
        return true;
      }
      if (command === "status") {
        setNotice(
          [
            `Session ${localSessionId || "new"}`,
            useModelRouter ? "Model Router" : selectedAgent ? agentLine(selectedAgent) : modelLine || "gateway default",
            `tools ${approvalMode}`,
            `${pendingMessages.length} queued`,
          ].join(" · ")
        );
        return true;
      }
      if (command === "agents") {
        const control = await loadControlPlane();
        setNotice(
          control.agents.length
            ? control.agents
                .slice(0, 8)
                .map((agent) => `${agent.id === selectedAgentId ? "*" : "-"} ${agentLine(agent)}`)
                .join("\n")
            : "No agents returned by the gateway."
        );
        return true;
      }
      if (command === "agent") {
        if (!argument) {
          setNotice("Usage: /agent <id|name|default|router>");
          return true;
        }
        const availableAgents = agents.length ? agents : (await loadControlPlane()).agents;
        if (argument === "router") {
          setUseModelRouter(true);
          setNotice("Model router selected for future sends.");
          return true;
        }
        if (argument === "default") {
          setUseModelRouter(false);
          setSelectedAgentId("");
          setNotice("Gateway default selected for new sessions.");
          return true;
        }
        const agentId = resolveAgentId(argument, availableAgents);
        if (!agentId) {
          setNotice("Agent not found. Use /agents to list available agents.");
          return true;
        }
        setUseModelRouter(false);
        setSelectedAgentId(agentId);
        if (localSessionId) {
          const response = await fetchAPI<unknown>(
            `/api/sessions/${encodeURIComponent(localSessionId)}/agent`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId }),
            }
          );
          if (isRecord(response) && response.success === false) {
            setNotice(typeof response.error === "string" ? response.error : "Failed to update session agent.");
            return true;
          }
          await loadMessages();
        }
        const nextAgent = availableAgents.find((agent) => agent.id === agentId);
        setNotice(`Agent selected: ${nextAgent ? agentLine(nextAgent) : agentId}`);
        return true;
      }
      if (command === "router") {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          const control = await loadControlPlane();
          const nextRouterStatus = control.routerStatus;
          setNotice(
            `Router ${nextRouterStatus?.enabled ? nextRouterStatus.strategy || "enabled" : "off"} · ${
              useModelRouter ? "selected for this chat" : "not selected"
            }`
          );
          return true;
        }
        if (value === "on" || value === "use") {
          setUseModelRouter(true);
          setNotice("Model router selected for future sends.");
          return true;
        }
        if (value === "off" || value === "default") {
          setUseModelRouter(false);
          setNotice("Model router disabled for future sends.");
          return true;
        }
        setNotice("Usage: /router on|off|show");
        return true;
      }
      if (command === "permissions") {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          setNotice(`Tool approvals: ${approvalMode}`);
          return true;
        }
        const nextMode = value === "ask" ? "ask" : value === "always_allow" || value === "always" ? "always_allow" : "";
        if (!nextMode) {
          setNotice("Usage: /permissions ask|always_allow|show");
          return true;
        }
        const response = await fetchAPI<unknown>("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool_approval_mode: nextMode }),
        });
        if (isRecord(response) && response.success === false) {
          setNotice(typeof response.error === "string" ? response.error : "Gateway rejected the approval setting.");
          return true;
        }
        setApprovalMode(nextMode);
        setNotice(`Tool approvals set to ${nextMode}.`);
        return true;
      }
      if (command === "clear") {
        setMessages([]);
        setNotice("Cleared local view. Session history is unchanged.");
        return true;
      }
      if (command === "reload") {
        await loadMessages();
        setNotice("Conversation reloaded.");
        return true;
      }
      if (command === "new") {
        setLocalSessionId("");
        setMessages([]);
        setPendingMessages([]);
        setNotice("New session ready.");
        return true;
      }
      if (command === "pending") {
        await loadPending();
        setNotice("Pending queue refreshed.");
        return true;
      }
      if (command === "queue") {
        if (!localSessionId) {
          setNotice("Send the first turn before queueing follow-ups.");
          return true;
        }
        if (!argument) {
          setNotice("Usage: /queue <message>");
          return true;
        }
        const response = await fetchAPI<unknown>("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgentId || undefined,
            message: argument,
            queueMode: "queue",
            sessionId: localSessionId,
            useModelRouter,
          }),
        });
        setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
        setNotice("Queued follow-up.");
        return true;
      }
      if (command === "steer") {
        const pendingId = resolvePendingId(rest[0], pendingMessages);
        if (!localSessionId || !pendingId) {
          setNotice("Usage: /steer <id|#n>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/${encodeURIComponent(
            pendingId
          )}/steer`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        );
        setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
        await loadMessages();
        setNotice("Steered queued message.");
        return true;
      }
      if (command === "edit") {
        const pendingId = resolvePendingId(rest[0], pendingMessages);
        const content = rest.slice(1).join(" ").trim();
        if (!localSessionId || !pendingId || !content) {
          setNotice("Usage: /edit <id|#n> <message>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/${encodeURIComponent(
            pendingId
          )}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          }
        );
        setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
        setNotice("Edited queued follow-up.");
        return true;
      }
      if (command === "delete") {
        const pendingId = resolvePendingId(rest[0], pendingMessages);
        if (!localSessionId || !pendingId) {
          setNotice("Usage: /delete <id|#n>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/${encodeURIComponent(
            pendingId
          )}`,
          { method: "DELETE" }
        );
        setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
        setNotice("Deleted queued follow-up.");
        return true;
      }
      if (command === "reorder") {
        const pendingMessageIds = resolvePendingIds(rest, pendingMessages);
        if (!localSessionId || pendingMessageIds.length === 0) {
          setNotice("Usage: /reorder <id|#n>...");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/reorder`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingMessageIds }),
          }
        );
        setPendingMessages(pendingFrom(isRecord(response) ? response.pendingMessages : []));
        setNotice("Reordered queued follow-ups.");
        return true;
      }
      if (command === "stop") {
        if (!localSessionId) {
          setNotice("No active session to stop.");
          return true;
        }
        await fetchAPI(`/api/chat/sessions/${encodeURIComponent(localSessionId)}/stop`, {
          method: "POST",
        });
        setSending(false);
        setNotice("Stop requested.");
        return true;
      }
      if (command === "quit" || command === "exit") {
        onExit();
        return true;
      }
      return false;
    },
    [
      agents,
      approvalMode,
      fetchAPI,
      loadControlPlane,
      loadMessages,
      loadPending,
      localSessionId,
      modelLine,
      onExit,
      pendingMessages,
      selectedAgent,
      selectedAgentId,
      useModelRouter,
    ]
  );

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setHistory((previous) => [...previous.filter((item) => item !== trimmed), trimmed].slice(-50));
      if (trimmed.startsWith("/") && (await runCommand(trimmed))) return;

      setNotice(null);
      setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
      setSending(true);
      try {
        const response = await fetchAPI<unknown>("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            agentId: selectedAgentId || undefined,
            sessionId: localSessionId || undefined,
            stream: false,
            useModelRouter,
          }),
        });
        const nextSessionId =
          isRecord(response) && typeof response.sessionId === "string"
            ? response.sessionId
            : localSessionId;
        if (nextSessionId) {
          setLocalSessionId(nextSessionId);
          await loadMessagesForSession(nextSessionId);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSending(false);
      }
    },
    [fetchAPI, loadMessagesForSession, localSessionId, runCommand, selectedAgentId, sending, useModelRouter]
  );

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      exit();
      return;
    }
    if (key.escape) {
      onExit();
      return;
    }
    if (key.ctrl && value === "j") {
      const [next, nextCursor] = insertAt(input, cursor, "\n");
      setInput(next);
      setCursor(nextCursor);
      return;
    }
    if (key.return) {
      const pending = input;
      resetInput();
      void send(pending);
      return;
    }
    if (key.leftArrow) {
      setCursor((previous) => Math.max(0, previous - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((previous) => Math.min(input.length, previous + 1));
      return;
    }
    if (key.upArrow && history.length > 0) {
      const nextIndex =
        historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex] || "");
      setCursor((history[nextIndex] || "").length);
      return;
    }
    if (key.downArrow && history.length > 0) {
      if (historyIndex === null) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        resetInput();
        return;
      }
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex] || "");
      setCursor((history[nextIndex] || "").length);
      return;
    }
    if ((key as { tab?: boolean }).tab && input.startsWith("/")) {
      const match = commandMatches(input)[0];
      if (match) {
        setInput(`${match.name} `);
        setCursor(match.name.length + 1);
      }
      return;
    }
    if (key.backspace || key.delete) {
      const [next, nextCursor] = deleteBefore(input, cursor);
      setInput(next);
      setCursor(nextCursor);
      return;
    }
    if (key.ctrl && value === "d") {
      setInput(deleteAt(input, cursor));
      return;
    }
    if (key.ctrl && value === "a") {
      setCursor(0);
      return;
    }
    if (key.ctrl && value === "e") {
      setCursor(input.length);
      return;
    }
    if (key.ctrl && value === "u") {
      setInput(input.slice(cursor));
      setCursor(0);
      return;
    }
    if (key.ctrl && value === "k") {
      setInput(input.slice(0, cursor));
      return;
    }
    if (value && !key.ctrl && !key.meta) {
      const [next, nextCursor] = insertAt(input, cursor, value);
      setInput(next);
      setCursor(nextCursor);
    }
  });

  const visibleMessages = messages.filter((message) => message.role !== "system").slice(-18);
  const headerTitle = title || (localSessionId ? localSessionId.slice(0, 8) : "New chat");
  const activeModelLine = useModelRouter
    ? "Model Router"
    : selectedAgent
      ? agentLine(selectedAgent)
      : modelLine || "Gateway default";

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            Cybara Chat · {headerTitle}
          </Text>
          <Text color={sending ? "yellow" : "gray"}>{sending ? "working" : "ready"}</Text>
        </Box>
        <Text color="gray">
          {activeModelLine} · {localSessionId || "session will be created on send"}
        </Text>
      </Box>
      <Box marginTop={1}>
        <StatusRail
          agent={selectedAgent}
          approvalMode={approvalMode}
          pendingCount={pendingMessages.length}
          routerStatus={routerStatus}
          sessionId={localSessionId}
          useModelRouter={useModelRouter}
        />
      </Box>

      {loading ? (
        <Box paddingX={1} paddingY={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Loading conversation
          </Text>
        </Box>
      ) : visibleMessages.length === 0 ? (
        <Box paddingX={1} paddingY={1}>
          <Text color="gray">No messages yet. Type a prompt or /help.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          {visibleMessages.map((message, index) => (
            <MessageView key={`${index}-${message.role}-${message.content.slice(0, 12)}`} message={message} />
          ))}
        </Box>
      )}

      {sending ? (
        <Box paddingX={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Working. Type /queue &lt;message&gt; or /stop.
          </Text>
        </Box>
      ) : null}
      <PendingQueue messages={pendingMessages} />
      {showHelp ? <HelpPanel /> : null}
      <CommandPalette input={input} />
      {error ? (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      ) : null}
      {notice ? (
        <Box paddingX={1}>
          <Text color="gray">{notice}</Text>
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor={sending ? "yellow" : "green"} paddingX={1} flexDirection="column">
        <Text color="gray">Ask Cybara</Text>
        {withCursor(input, cursor)
          .split("\n")
          .map((line, index) => (
            <Text key={index} color={sending ? "gray" : "white"}>
              {index === 0 ? "› " : "  "}
              {line}
            </Text>
          ))}
      </Box>
      <Box paddingX={1}>
        <Text color="gray">
          Enter send · Ctrl+J newline · ↑↓ history · Tab complete · /help · Esc sessions
        </Text>
      </Box>
    </Box>
  );
}
