import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import type { TUIFetchAPI } from "./cli-tui-chat";
import {
  approvalDecisionForInput,
  approvalsFromResponse,
  ToolApprovalPrompt,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./cli-tui-approvals";
import {
  environmentSnapshotFromDetail,
  formatContextUsageLine,
  formatFileChangeLine,
  formatPlanLine,
  formatSubagentLine,
  formatTaskLine,
  formatTokenUsageLine,
  messagesFromDetail,
  subagentsFromResponse,
  tasksFromResponse,
  type TuiEnvironmentSnapshot,
  type TuiSubagentSummary,
  type TuiTaskSummary,
} from "./cli-tui-chat-environment";
import { EnvironmentPanel } from "./cli-tui-chat-environment-view";
import {
  composerWindow,
  copyTextToClipboard,
  transcriptWindow,
  useTerminalLayout,
} from "./cli-tui-terminal";
import {
  compactInspectionLines,
  logLines,
  mcpStatusLines,
  memoryStatusLine,
  skillStatusLines,
} from "./cli-tui-chat-inspection";

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
  reasoning_effort?: string | null;
  config?: unknown;
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
  { name: "/skills", detail: "Show installed and available skills" },
  { name: "/mcp", detail: "Show connected MCP services" },
  { name: "/memory", detail: "Show memory and indexing health" },
  { name: "/logs", detail: "Show recent gateway logs" },
  { name: "/agent", detail: "Switch the active chat agent" },
  { name: "/model", detail: "Show or override the model for future turns" },
  { name: "/router", detail: "Use or disable model router for new turns" },
  { name: "/permissions", detail: "Show or change tool approval mode" },
  { name: "/tools", detail: "Show or change the active agent tool profile" },
  {
    name: "/reasoning",
    detail: "Show or change reasoning effort for the active agent",
  },
  { name: "/title", detail: "Rename the current session" },
  { name: "/workspace", detail: "Show or change the current workspace" },
  { name: "/context", detail: "Show context, compaction, and token usage" },
  { name: "/usage", detail: "Show token usage for this session" },
  { name: "/environment", detail: "Toggle the environment panel" },
  { name: "/plan", detail: "Show the latest plan state" },
  {
    name: "/goal",
    detail: "Start, inspect, pause, resume, or complete a session goal",
  },
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
  { name: "/raw", detail: "Toggle complete copy-friendly transcript messages" },
  { name: "/review", detail: "Load a workspace review prompt" },
  { name: "/expand", detail: "Toggle full or compact transcript messages" },
  { name: "/clear", detail: "Clear the local view" },
  { name: "/new", detail: "Start a new session in this TUI" },
  { name: "/resume", detail: "Return to the saved session picker" },
  { name: "/sessions", detail: "Return to the saved session picker" },
  { name: "/quit", detail: "Return to the session list" },
  { name: "/exit", detail: "Return to the session list" },
];

const ROLE_META: Record<
  ChatMessage["role"],
  { label: string; color: string; marker: string }
> = {
  user: { label: "You", color: "cyan", marker: ">" },
  assistant: { label: "Cybara", color: "white", marker: "◆" },
  system: { label: "System", color: "#9ca6b4", marker: "-" },
};

const ACTIVITY_HEADING_COLOR = "#aab3bf";
const ACTIVITY_DETAIL_COLOR = "#c0c7d1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      return block.type === "text" && typeof block.text === "string"
        ? block.text
        : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function activitiesFrom(value: unknown): ActivityItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) ? [item as ActivityItem] : [],
  );
}

function toolCallsFrom(value: unknown): ToolCallItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) ? [item as ToolCallItem] : [],
  );
}

function pendingFrom(value: unknown): PendingMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.content !== "string"
    ) {
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
  const name =
    typeof agent.name === "string" && agent.name.trim()
      ? agent.name.trim()
      : agent.id;
  const model =
    typeof agent.model === "string" && agent.model.trim()
      ? agent.model.trim()
      : "";
  const status =
    typeof agent.status === "string" && agent.status.trim()
      ? agent.status.trim()
      : "";
  return [name, model, status].filter(Boolean).join(" · ") || "Unnamed agent";
}

function agentReasoningEffort(agent: AgentSummary | undefined): string {
  if (!agent) return "default";
  if (
    typeof agent.reasoning_effort === "string" &&
    agent.reasoning_effort.trim()
  ) {
    return agent.reasoning_effort.trim();
  }
  const config = agentConfig(agent);
  const params = isRecord(config.model_params)
    ? config.model_params
    : isRecord(config.modelParams)
      ? config.modelParams
      : null;
  const value = params?.reasoning_effort ?? params?.reasoningEffort;
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

function agentConfig(agent: AgentSummary | undefined): Record<string, unknown> {
  if (!agent) return {};
  if (isRecord(agent.config)) return agent.config;
  if (typeof agent.config !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(agent.config);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function agentToolProfile(agent: AgentSummary | undefined): string {
  const value = agentConfig(agent).tool_profile;
  return typeof value === "string" && value.trim() ? value.trim() : "full";
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
      agent.model?.toLowerCase() === needle,
  );
  if (exact?.id) return exact.id;
  const partial = agents.find(
    (agent) =>
      agent.name?.toLowerCase().includes(needle) ||
      agent.model?.toLowerCase().includes(needle) ||
      agent.id?.toLowerCase().startsWith(needle),
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
    if (
      (role === "user" || role === "assistant" || role === "system") &&
      content
    ) {
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
  return COMMANDS.filter((command) =>
    command.name.startsWith(trimmed.split(/\s+/)[0]),
  ).slice(0, 6);
}

function isTransientRuntimeCommand(input: string): boolean {
  return /^\/(?:goal|loop)(?:\s|$)/i.test(input.trim());
}

function resolvePendingId(
  raw: string | undefined,
  pending: PendingMessage[],
): string | null {
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

function insertAt(
  value: string,
  cursor: number,
  insert: string,
): [string, number] {
  return [
    value.slice(0, cursor) + insert + value.slice(cursor),
    cursor + insert.length,
  ];
}

function deleteBefore(value: string, cursor: number): [string, number] {
  if (cursor <= 0) return [value, cursor];
  return [value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1];
}

function deleteAt(value: string, cursor: number): string {
  if (cursor >= value.length) return value;
  return value.slice(0, cursor) + value.slice(cursor + 1);
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

function splitInline(
  line: string,
): Array<{ text: string; bold?: boolean; code?: boolean }> {
  const parts: Array<{ text: string; bold?: boolean; code?: boolean }> = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let offset = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > offset)
      parts.push({ text: line.slice(offset, match.index) });
    const token = match[0];
    if (token.startsWith("**"))
      parts.push({ text: token.slice(2, -2), bold: true });
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
        <Text
          key={index}
          bold={part.bold}
          color={part.code ? "magenta" : undefined}
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function MessageBody({
  content,
  maxLines,
  maxColumns,
}: {
  content: string;
  maxLines?: number;
  maxColumns: number;
}): React.ReactElement {
  const lines = transcriptWindow(
    content,
    maxLines ?? Number.MAX_SAFE_INTEGER,
    maxColumns,
  );
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        if (line.hidden) {
          return (
            <Text key={index} color="#9ca6b4">
              {line.text}
            </Text>
          );
        }
        if (line.fence) {
          return (
            <Text key={index} color="magenta">
              {line.fence === "open"
                ? `code${line.language ? ` · ${line.language}` : ""}`
                : "end code"}
            </Text>
          );
        }
        if (line.code) {
          return (
            <Text key={index} color="green">
              {line.text || " "}
            </Text>
          );
        }
        const bullet = line.text.match(/^(\s*)[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <Text key={index}>
              {bullet[1]}
              <Text color="cyan">• </Text>
              <InlineMarkdown line={bullet[2]} />
            </Text>
          );
        }
        if (/^#{1,6}\s/.test(line.text)) {
          return (
            <Text key={index} bold>
              {line.text.replace(/^#{1,6}\s/, "")}
            </Text>
          );
        }
        if (/^\s*>\s?/.test(line.text)) {
          return (
            <Text key={index} color="gray">
              ▏ {line.text.replace(/^\s*>\s?/, "")}
            </Text>
          );
        }
        return <InlineMarkdown key={index} line={line.text} />;
      })}
    </Box>
  );
}

function ActivitySummary({
  message,
}: {
  message: ChatMessage;
}): React.ReactElement | null {
  const activities = message.process_activities || [];
  const tools = message.tool_calls || [];
  if (activities.length === 0 && tools.length === 0) return null;
  const labels = Array.from(
    new Set(
      [
        ...activities
          .slice(-5)
          .map(
            (activity) => activity.text || activity.toolName || activity.phase,
          ),
        ...tools
          .slice(-5)
          .map(
            (tool) =>
              `${tool.name || "tool"}${tool.status ? ` ${tool.status}` : ""}`,
          ),
      ]
        .filter(
          (label): label is string =>
            typeof label === "string" && label.trim().length > 0,
        )
        .map((label) => compact(label.replace(/\s+/g, " ").trim(), 96)),
    ),
  ).slice(-5);
  const count = activities.length + tools.length;
  return (
    <Box paddingLeft={2} marginBottom={1} flexDirection="column">
      <Text color={ACTIVITY_HEADING_COLOR}>
        ◇ Ran {count} {count === 1 ? "step" : "steps"}
      </Text>
      {labels.map((label, index) => (
        <Text key={`${index}-${label}`} color={ACTIVITY_DETAIL_COLOR}>
          {index === labels.length - 1 ? "└" : "├"} {label}
        </Text>
      ))}
    </Box>
  );
}

function MessageView({
  message,
  maxLines,
  maxColumns,
}: {
  message: ChatMessage;
  maxLines?: number;
  maxColumns: number;
}): React.ReactElement {
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
        <MessageBody
          content={message.content}
          maxLines={maxLines}
          maxColumns={maxColumns}
        />
      </Box>
    </Box>
  );
}

function PendingQueue({
  messages,
}: {
  messages: PendingMessage[];
}): React.ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text color="gray">Queued follow-ups</Text>
      {messages.slice(0, 4).map((message, index) => (
        <Text
          key={message.id}
          color={message.mode === "steering" ? "yellow" : "white"}
        >
          #{message.sequence || index + 1} {message.content.slice(0, 72)}
          <Text color="gray"> · {relativeTime(message.createdAt)}</Text>
        </Text>
      ))}
      <Text color="gray">
        /steer #1 · /edit #1 ... · /delete #1 · /reorder #2 #1
      </Text>
    </Box>
  );
}

function CommandPalette({
  input,
  compactMode,
  maxRows,
}: {
  input: string;
  compactMode: boolean;
  maxRows: number;
}): React.ReactElement | null {
  const matches = commandMatches(input).slice(0, maxRows);
  if (matches.length === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      {matches.map((command) => (
        <Text key={command.name}>
          <Text color="cyan">{command.name}</Text>
          {compactMode ? null : <Text color="gray"> — {command.detail}</Text>}
        </Text>
      ))}
    </Box>
  );
}

function HelpPanel({ narrow }: { narrow: boolean }): React.ReactElement {
  if (narrow) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        marginTop={1}
      >
        <Text bold color="cyan">
          Chat controls
        </Text>
        <Text>Enter send · ^J newline · Tab complete</Text>
        <Text>PgUp/PgDn scroll · Esc sessions · ^C quit</Text>
        <Text>/model · /agent · /permissions · /reasoning</Text>
        <Text>/copy · /diff · /review · /environment</Text>
        <Text>/goal or /loop for persistent work</Text>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color="cyan">
        Chat controls
      </Text>
      <Text>
        Enter send · Ctrl+J newline · ←/→ move · ↑/↓ history · PgUp/PgDn
        transcript
      </Text>
      <Text>
        Tab completes slash commands · approval prompts use 1/2/3/4 or y/s/a/n
      </Text>
      <Text>
        /agents lists · /agent name switches · /router on|off · /permissions
        ask|always_allow
      </Text>
      <Text>
        /reasoning changes effort · /title renames · /workspace changes the
        working root
      </Text>
      <Text>
        /environment toggles context, plan, diffs, tasks, and subagents
      </Text>
      <Text>
        /goal start &lt;objective&gt; creates persistent work · /loop is an
        alias
      </Text>
      <Text>
        /context, /usage, /plan, /diffs, /tasks, /subagents inspect session
        state
      </Text>
      <Text>
        /queue queues · /steer injects · /edit, /delete, /reorder manage queue
      </Text>
      <Text>/stop interrupts · /pending refreshes queue</Text>
      <Text>
        /copy copies the latest answer · /diff shows changes · /review loads a
        review prompt
      </Text>
      <Text>
        /reload refetches · /new starts fresh · /resume returns to sessions
      </Text>
      <Text>/raw or /expand toggles compact and complete message bodies</Text>
    </Box>
  );
}

function StatusRail({
  agent,
  approvalCount,
  approvalMode,
  pendingCount,
  routerStatus,
  sessionId,
  modelOverride,
  narrow,
  useModelRouter,
}: {
  agent?: AgentSummary;
  approvalCount: number;
  approvalMode: string;
  pendingCount: number;
  routerStatus: RouterStatus | null;
  sessionId: string;
  modelOverride?: string;
  narrow: boolean;
  useModelRouter: boolean;
}): React.ReactElement {
  const agentLabel = useModelRouter
    ? "Model Router"
    : agent
      ? agentLine(agent)
      : "Gateway default";
  const routerLabel = useModelRouter
    ? "selected"
    : routerStatus?.enabled
      ? routerStatus.strategy || "enabled"
      : "off";
  const shortSessionId = sessionId ? sessionId.slice(0, 8) : "new";
  if (narrow) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text>
          <Text color="white">{compact(modelOverride || agentLabel, 28)}</Text>
          <Text color="gray"> · </Text>
          <Text color={approvalMode === "ask" ? "yellow" : "green"}>
            {approvalMode === "always_allow" ? "allow" : approvalMode}
          </Text>
          <Text color={pendingCount > 0 ? "yellow" : "gray"}>
            {" "}
            · q{pendingCount}
          </Text>
          <Text color="gray"> · {shortSessionId}</Text>
        </Text>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text>
        <Text color="gray">Agent </Text>
        <Text color="white">{compact(agentLabel)}</Text>
      </Text>
      <Text>
        <Text color="gray">Tools </Text>
        <Text color={approvalMode === "ask" ? "yellow" : "green"}>
          {approvalMode === "always_allow" ? "allow" : approvalMode}
        </Text>
        {approvalCount > 0 ? (
          <Text color="yellow"> · {approvalCount} waiting</Text>
        ) : null}
        <Text color="gray"> · Reasoning </Text>
        <Text color="white">{agentReasoningEffort(agent)}</Text>
        <Text color="gray"> · Profile </Text>
        <Text color="white">{agentToolProfile(agent)}</Text>
        {modelOverride ? (
          <Text color="cyan"> · Model {compact(modelOverride, 28)}</Text>
        ) : null}
        {useModelRouter || routerStatus?.enabled ? (
          <>
            <Text color="gray"> · Router </Text>
            <Text color="cyan">{routerLabel}</Text>
          </>
        ) : null}
        <Text color="gray"> · Queue </Text>
        <Text color={pendingCount > 0 ? "yellow" : "gray"}>{pendingCount}</Text>
        <Text color="gray"> · {shortSessionId}</Text>
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
  const [sessionTitle, setSessionTitle] = React.useState(title || "");
  const [workspaceDir, setWorkspaceDir] = React.useState("");
  const [modelOverride, setModelOverride] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = React.useState<
    PendingMessage[]
  >([]);
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
  const [selectedAgentId, setSelectedAgentId] = React.useState(
    initialAgentId || "",
  );
  const [useModelRouter, setUseModelRouter] = React.useState(false);
  const [approvalMode, setApprovalMode] = React.useState("always_allow");
  const [routerStatus, setRouterStatus] = React.useState<RouterStatus | null>(
    null,
  );
  const [environmentSnapshot, setEnvironmentSnapshot] =
    React.useState<TuiEnvironmentSnapshot | null>(null);
  const [tasks, setTasks] = React.useState<TuiTaskSummary[]>([]);
  const [subagents, setSubagents] = React.useState<TuiSubagentSummary[]>([]);
  const [showEnvironment, setShowEnvironment] = React.useState(false);
  const [expandedTranscript, setExpandedTranscript] = React.useState(false);
  const [transcriptOffset, setTranscriptOffset] = React.useState(0);
  const [approvalRequests, setApprovalRequests] = React.useState<
    ToolApprovalRequest[]
  >([]);
  const [resolvingApproval, setResolvingApproval] = React.useState(false);
  const layout = useTerminalLayout();

  const selectedAgent = React.useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const loadControlPlane =
    React.useCallback(async (): Promise<ControlPlaneState> => {
      const [agentResponse, configResponse, routerResponse] = await Promise.all(
        [
          fetchAPI<unknown>("/api/agents"),
          fetchAPI<unknown>("/api/config"),
          fetchAPI<unknown>("/api/router/status"),
        ],
      );
      const nextAgents = agentsFrom(agentResponse);
      const nextApprovalMode =
        isRecord(configResponse) &&
        typeof configResponse.tool_approval_mode === "string"
          ? configResponse.tool_approval_mode
          : approvalMode;
      const nextRouterStatus = isRecord(routerResponse)
        ? (routerResponse as RouterStatus)
        : null;
      setAgents(nextAgents);
      if (
        isRecord(configResponse) &&
        typeof configResponse.tool_approval_mode === "string"
      ) {
        setApprovalMode(configResponse.tool_approval_mode);
      }
      setRouterStatus(nextRouterStatus);
      return {
        agents: nextAgents,
        approvalMode: nextApprovalMode,
        routerStatus: nextRouterStatus,
      };
    }, [approvalMode, fetchAPI]);

  const loadPendingForSession = React.useCallback(
    async (targetSessionId: string) => {
      const response = await fetchAPI<unknown>(
        `/api/chat/sessions/${encodeURIComponent(targetSessionId)}/pending`,
      );
      setPendingMessages(
        pendingFrom(isRecord(response) ? response.pendingMessages : []),
      );
    },
    [fetchAPI],
  );

  const loadEnvironmentForSession = React.useCallback(
    async (targetSessionId: string): Promise<unknown | null> => {
      const response = await fetchAPI<unknown>(
        `/api/sessions/${encodeURIComponent(targetSessionId)}`,
      );
      const snapshot = environmentSnapshotFromDetail(response);
      setEnvironmentSnapshot(snapshot);
      if (snapshot.workspaceDir) setWorkspaceDir(snapshot.workspaceDir);
      return response;
    },
    [fetchAPI],
  );

  const loadTasks = React.useCallback(async () => {
    const response = await fetchAPI<unknown>("/api/tasks");
    const next = tasksFromResponse(response);
    setTasks(next);
    return next;
  }, [fetchAPI]);

  const loadSubagents = React.useCallback(async () => {
    const response = await fetchAPI<unknown>("/api/subagents");
    const next = subagentsFromResponse(response);
    setSubagents(next);
    return next;
  }, [fetchAPI]);

  const loadMessagesForSession = React.useCallback(
    async (targetSessionId: string): Promise<ChatMessage[]> => {
      const detail = await loadEnvironmentForSession(targetSessionId);
      const detailMessages = messagesFromDetail(detail);
      let nextMessages: ChatMessage[];
      if (detailMessages.length > 0) {
        nextMessages = messagesFromResponse(detailMessages);
      } else {
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(targetSessionId)}/messages`,
        );
        nextMessages = messagesFromResponse(response);
      }
      setMessages(nextMessages);
      await loadPendingForSession(targetSessionId);
      return nextMessages;
    },
    [fetchAPI, loadEnvironmentForSession, loadPendingForSession],
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

  const loadApprovals = React.useCallback(async () => {
    const response = await fetchAPI<unknown>("/api/tools/approvals");
    const pending = approvalsFromResponse(response);
    setApprovalRequests(
      localSessionId
        ? pending.filter((request) => request.sessionId === localSessionId)
        : sending
          ? pending
          : [],
    );
  }, [fetchAPI, localSessionId, sending]);

  React.useEffect(() => {
    if (approvalMode !== "ask" && !sending) {
      setApprovalRequests([]);
      return;
    }
    void loadApprovals();
    const timer = setInterval(() => void loadApprovals(), 600);
    return () => clearInterval(timer);
  }, [approvalMode, loadApprovals, sending]);

  const resolveApprovalRequest = React.useCallback(
    async (request: ToolApprovalRequest, decision: ToolApprovalDecision) => {
      if (resolvingApproval) return;
      setResolvingApproval(true);
      try {
        const response = await fetchAPI<unknown>(
          "/api/tools/approvals/resolve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: request.id, decision }),
          },
        );
        if (isRecord(response) && response.success === false) {
          setError(
            typeof response.error === "string"
              ? response.error
              : "Approval could not be resolved.",
          );
          return;
        }
        setApprovalRequests((current) =>
          current.filter((item) => item.id !== request.id),
        );
        setNotice(
          decision === "deny"
            ? `Denied ${request.toolName}.`
            : `Approved ${request.toolName} (${decision.replace("approve_", "")}).`,
        );
      } finally {
        setResolvingApproval(false);
      }
    },
    [fetchAPI, resolvingApproval],
  );

  const resetInput = React.useCallback(() => {
    setInput("");
    setCursor(0);
    setHistoryIndex(null);
  }, []);

  const runCommand = React.useCallback(
    async (text: string): Promise<boolean> => {
      const [command, ...rest] = text.slice(1).split(/\s+/);
      const normalizedCommand = command;
      const argument = rest.join(" ").trim();
      if (normalizedCommand === "help") {
        setShowHelp((value) => !value);
        setNotice("Help toggled.");
        return true;
      }
      if (normalizedCommand === "status") {
        setNotice(
          [
            `Session ${localSessionId || "new"}`,
            useModelRouter
              ? "Model Router"
              : modelOverride ||
                (selectedAgent
                  ? agentLine(selectedAgent)
                  : modelLine || "gateway default"),
            `tools ${approvalMode}`,
            `${pendingMessages.length} queued`,
          ].join(" · "),
        );
        return true;
      }
      if (normalizedCommand === "agents") {
        const control = await loadControlPlane();
        setNotice(
          control.agents.length
            ? control.agents
                .slice(0, 8)
                .map(
                  (agent) =>
                    `${agent.id === selectedAgentId ? "*" : "-"} ${agentLine(agent)}`,
                )
                .join("\n")
            : "No agents returned by the gateway.",
        );
        return true;
      }
      if (normalizedCommand === "skills") {
        const response = await fetchAPI<unknown>("/api/skills/status");
        const lines = skillStatusLines(response);
        setNotice(
          lines.length
            ? compactInspectionLines(lines)
            : "No skills returned by the gateway.",
        );
        return true;
      }
      if (normalizedCommand === "mcp") {
        const response = await fetchAPI<unknown>("/api/mcp");
        const lines = mcpStatusLines(response);
        setNotice(
          lines.length
            ? compactInspectionLines(lines)
            : "No MCP services configured.",
        );
        return true;
      }
      if (normalizedCommand === "memory") {
        const [status, memory] = await Promise.all([
          fetchAPI<unknown>("/api/memory/status"),
          fetchAPI<unknown>("/api/memory"),
        ]);
        setNotice(memoryStatusLine(status, memory));
        return true;
      }
      if (normalizedCommand === "logs") {
        const parsedCount = Number.parseInt(argument, 10);
        const count = Number.isFinite(parsedCount)
          ? Math.max(1, Math.min(20, parsedCount))
          : 8;
        const response = await fetchAPI<unknown>(
          `/api/logs/system?limit=${count}`,
        );
        const lines = logLines(response);
        setNotice(
          lines.length
            ? compactInspectionLines(lines, count)
            : "No recent gateway logs.",
        );
        return true;
      }
      if (normalizedCommand === "agent") {
        if (!argument) {
          setNotice("Usage: /agent <id|name|default|router>");
          return true;
        }
        const availableAgents = agents.length
          ? agents
          : (await loadControlPlane()).agents;
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
            },
          );
          if (isRecord(response) && response.success === false) {
            setNotice(
              typeof response.error === "string"
                ? response.error
                : "Failed to update session agent.",
            );
            return true;
          }
          await loadMessages();
        }
        const nextAgent = availableAgents.find((agent) => agent.id === agentId);
        setNotice(
          `Agent selected: ${nextAgent ? agentLine(nextAgent) : agentId}`,
        );
        return true;
      }
      if (normalizedCommand === "model") {
        const value = argument.trim();
        const normalized = value.toLowerCase();
        if (!value || normalized === "show") {
          setNotice(
            `Model: ${useModelRouter ? "router" : modelOverride || selectedAgent?.model || "agent default"}`,
          );
          return true;
        }
        if (normalized === "router" || normalized === "auto") {
          setModelOverride("");
          setUseModelRouter(true);
          setNotice("Model Router selected for future sends.");
          return true;
        }
        if (["default", "off", "reset"].includes(normalized)) {
          setModelOverride("");
          setUseModelRouter(false);
          setNotice("Model reset to the active agent default.");
          return true;
        }
        setModelOverride(value);
        setUseModelRouter(false);
        setNotice(`Model override set to ${value}.`);
        return true;
      }
      if (normalizedCommand === "router") {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          const control = await loadControlPlane();
          const nextRouterStatus = control.routerStatus;
          setNotice(
            `Router ${nextRouterStatus?.enabled ? nextRouterStatus.strategy || "enabled" : "off"} · ${
              useModelRouter ? "selected for this chat" : "not selected"
            }`,
          );
          return true;
        }
        if (value === "on" || value === "use") {
          setModelOverride("");
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
      if (
        ["permissions", "approval", "approvals"].includes(normalizedCommand)
      ) {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          setNotice(`Tool approvals: ${approvalMode}`);
          return true;
        }
        const nextMode =
          value === "ask"
            ? "ask"
            : value === "always_allow" || value === "always"
              ? "always_allow"
              : "";
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
          setNotice(
            typeof response.error === "string"
              ? response.error
              : "Gateway rejected the approval setting.",
          );
          return true;
        }
        setApprovalMode(nextMode);
        setNotice(`Tool approvals set to ${nextMode}.`);
        return true;
      }
      if (["tools", "toolset", "toolsets"].includes(normalizedCommand)) {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          setNotice(`Tool profile: ${agentToolProfile(selectedAgent)}`);
          return true;
        }
        if (!selectedAgentId) {
          setNotice(
            "Select an agent with /agent before changing its tool profile.",
          );
          return true;
        }
        const valid = ["full", "coding", "research", "safe"];
        if (!valid.includes(value)) {
          setNotice("Usage: /tools full|coding|research|safe|show");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/agents/${encodeURIComponent(selectedAgentId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config: { ...agentConfig(selectedAgent), tool_profile: value },
            }),
          },
        );
        if (!response || (isRecord(response) && response.success === false)) {
          setNotice(
            isRecord(response) && typeof response.error === "string"
              ? response.error
              : "Tool profile update failed.",
          );
          return true;
        }
        await loadControlPlane();
        setNotice(`Tool profile set to ${value}.`);
        return true;
      }
      if (normalizedCommand === "reasoning") {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          setNotice(`Reasoning effort: ${agentReasoningEffort(selectedAgent)}`);
          return true;
        }
        if (!selectedAgentId) {
          setNotice(
            "Select an agent with /agent before changing reasoning effort.",
          );
          return true;
        }
        const valid = [
          "default",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ];
        if (!valid.includes(value)) {
          setNotice(
            "Usage: /reasoning default|minimal|low|medium|high|xhigh|max",
          );
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/agents/${encodeURIComponent(selectedAgentId)}/reasoning`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reasoning_effort: value === "default" ? null : value,
            }),
          },
        );
        if (isRecord(response) && response.success === false) {
          setNotice(
            typeof response.error === "string"
              ? response.error
              : "Reasoning effort was rejected.",
          );
          return true;
        }
        await loadControlPlane();
        setNotice(`Reasoning effort set to ${value}.`);
        return true;
      }
      if (normalizedCommand === "title" || normalizedCommand === "rename") {
        if (!localSessionId || !argument) {
          setNotice("Usage: /title <session name>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/sessions/${encodeURIComponent(localSessionId)}/title`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: argument }),
          },
        );
        if (isRecord(response) && response.success === false) {
          setNotice(
            typeof response.error === "string"
              ? response.error
              : "Session title was rejected.",
          );
          return true;
        }
        setSessionTitle(argument);
        setNotice(`Session renamed to ${argument}.`);
        return true;
      }
      if (normalizedCommand === "workspace") {
        if (!argument || argument === "show") {
          setNotice(`Workspace: ${workspaceDir || "gateway default"}`);
          return true;
        }
        const nextWorkspace =
          argument === "none" || argument === "default" ? "" : argument;
        if (localSessionId) {
          const response = await fetchAPI<unknown>(
            `/api/sessions/${encodeURIComponent(localSessionId)}/workspace`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ workspaceDir: nextWorkspace || null }),
            },
          );
          if (isRecord(response) && response.success === false) {
            setNotice(
              typeof response.error === "string"
                ? response.error
                : "Workspace was rejected.",
            );
            return true;
          }
        }
        setWorkspaceDir(nextWorkspace);
        setNotice(`Workspace set to ${nextWorkspace || "gateway default"}.`);
        return true;
      }
      if (normalizedCommand === "context" || normalizedCommand === "usage") {
        if (!localSessionId) {
          setNotice("No session yet. Send a message first.");
          return true;
        }
        const detail = await loadEnvironmentForSession(localSessionId);
        const snapshot = environmentSnapshotFromDetail(detail);
        setEnvironmentSnapshot(snapshot);
        setNotice(
          [
            formatContextUsageLine(snapshot.contextUsage),
            formatTokenUsageLine(snapshot.tokenUsage),
            formatPlanLine(snapshot.plan),
          ].join("\n"),
        );
        return true;
      }
      if (normalizedCommand === "environment") {
        if (localSessionId) await loadEnvironmentForSession(localSessionId);
        await Promise.all([loadTasks(), loadSubagents()]);
        setShowEnvironment((value) => !value);
        setNotice("Environment panel toggled.");
        return true;
      }
      if (normalizedCommand === "plan") {
        if (!localSessionId) {
          setNotice("No session plan yet.");
          return true;
        }
        const detail = await loadEnvironmentForSession(localSessionId);
        const snapshot = environmentSnapshotFromDetail(detail);
        setNotice(formatPlanLine(snapshot.plan));
        return true;
      }
      if (normalizedCommand === "diff" || normalizedCommand === "diffs") {
        if (!localSessionId) {
          setNotice("No session diffs yet.");
          return true;
        }
        const detail = await loadEnvironmentForSession(localSessionId);
        const snapshot = environmentSnapshotFromDetail(detail);
        const fileLines =
          snapshot.fileChanges?.files
            .slice(0, 8)
            .map((file) => `${file.path} +${file.added} -${file.removed}`) ||
          [];
        setNotice(
          [formatFileChangeLine(snapshot.fileChanges), ...fileLines].join("\n"),
        );
        return true;
      }
      if (normalizedCommand === "tasks") {
        const nextTasks = await loadTasks();
        setNotice(
          nextTasks.length
            ? nextTasks.slice(0, 8).map(formatTaskLine).join("\n")
            : "No tasks.",
        );
        return true;
      }
      if (
        normalizedCommand === "subagents" ||
        normalizedCommand === "subagent"
      ) {
        const action = rest[0]?.toLowerCase();
        if (action === "spawn") {
          const task = rest.slice(1).join(" ").trim();
          if (!task) {
            setNotice("Usage: /subagents spawn <task>");
            return true;
          }
          const response = await fetchAPI<unknown>("/api/subagents/spawn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              task,
              agentId: selectedAgentId || undefined,
              model: useModelRouter ? undefined : modelOverride || undefined,
              sessionId: localSessionId || undefined,
            }),
          });
          const spawnedId =
            isRecord(response) &&
            (typeof response.subagentId === "string" ||
              typeof response.id === "string")
              ? String(response.subagentId || response.id)
              : "";
          await loadSubagents();
          setNotice(
            spawnedId
              ? `Spawned subagent ${spawnedId}.`
              : "Subagent spawn requested.",
          );
          return true;
        }
        const nextSubagents = await loadSubagents();
        setNotice(
          nextSubagents.length
            ? nextSubagents.slice(0, 8).map(formatSubagentLine).join("\n")
            : "No subagents.",
        );
        return true;
      }
      if (normalizedCommand === "compact") {
        if (!localSessionId) {
          setNotice("Compaction is automatic after a session exists.");
          return true;
        }
        const detail = await loadEnvironmentForSession(localSessionId);
        const snapshot = environmentSnapshotFromDetail(detail);
        setNotice(formatContextUsageLine(snapshot.contextUsage));
        return true;
      }
      if (normalizedCommand === "clear") {
        setMessages([]);
        setNotice("Cleared local view. Session history is unchanged.");
        return true;
      }
      if (normalizedCommand === "reload") {
        await loadMessages();
        setNotice("Conversation reloaded.");
        return true;
      }
      if (normalizedCommand === "copy") {
        const response = [...messages]
          .reverse()
          .find((message) => message.role === "assistant")?.content;
        if (!response) {
          setNotice("No assistant response is available to copy.");
          return true;
        }
        setNotice(
          (await copyTextToClipboard(response))
            ? "Latest response copied."
            : "No system clipboard helper is available.",
        );
        return true;
      }
      if (normalizedCommand === "review") {
        const prompt =
          "Review the current workspace changes for correctness, regressions, security risks, performance issues, and missing tests. Report findings first with file references.";
        setInput(prompt);
        setCursor(prompt.length);
        setNotice("Review prompt loaded. Edit it or press Enter to send.");
        return true;
      }
      if (normalizedCommand === "expand" || normalizedCommand === "raw") {
        setExpandedTranscript((value) => !value);
        setNotice(
          `Transcript messages ${expandedTranscript ? "compacted" : "expanded"}.`,
        );
        return true;
      }
      if (normalizedCommand === "new") {
        setLocalSessionId("");
        setSessionTitle("");
        setMessages([]);
        setPendingMessages([]);
        setEnvironmentSnapshot(null);
        setNotice("New session ready.");
        return true;
      }
      if (["resume", "sessions", "quit", "exit"].includes(normalizedCommand)) {
        onExit();
        return true;
      }
      if (normalizedCommand === "pending") {
        await loadPending();
        setNotice("Pending queue refreshed.");
        return true;
      }
      if (normalizedCommand === "queue") {
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
            modelOverride: useModelRouter
              ? undefined
              : modelOverride || undefined,
            queueMode: "queue",
            sessionId: localSessionId,
            useModelRouter,
            workspaceDir: workspaceDir || undefined,
          }),
        });
        setPendingMessages(
          pendingFrom(isRecord(response) ? response.pendingMessages : []),
        );
        setNotice("Queued follow-up.");
        return true;
      }
      if (normalizedCommand === "steer") {
        const pendingId = resolvePendingId(rest[0], pendingMessages);
        if (!localSessionId || !pendingId) {
          setNotice("Usage: /steer <id|#n>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/${encodeURIComponent(
            pendingId,
          )}/steer`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
        );
        setPendingMessages(
          pendingFrom(isRecord(response) ? response.pendingMessages : []),
        );
        await loadMessages();
        setNotice("Steered queued message.");
        return true;
      }
      if (normalizedCommand === "edit") {
        const pendingId = resolvePendingId(rest[0], pendingMessages);
        const content = rest.slice(1).join(" ").trim();
        if (!localSessionId || !pendingId || !content) {
          setNotice("Usage: /edit <id|#n> <message>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/${encodeURIComponent(
            pendingId,
          )}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          },
        );
        setPendingMessages(
          pendingFrom(isRecord(response) ? response.pendingMessages : []),
        );
        setNotice("Edited queued follow-up.");
        return true;
      }
      if (normalizedCommand === "delete") {
        const pendingId = resolvePendingId(rest[0], pendingMessages);
        if (!localSessionId || !pendingId) {
          setNotice("Usage: /delete <id|#n>");
          return true;
        }
        const response = await fetchAPI<unknown>(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/pending/${encodeURIComponent(
            pendingId,
          )}`,
          { method: "DELETE" },
        );
        setPendingMessages(
          pendingFrom(isRecord(response) ? response.pendingMessages : []),
        );
        setNotice("Deleted queued follow-up.");
        return true;
      }
      if (normalizedCommand === "reorder") {
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
          },
        );
        setPendingMessages(
          pendingFrom(isRecord(response) ? response.pendingMessages : []),
        );
        setNotice("Reordered queued follow-ups.");
        return true;
      }
      if (normalizedCommand === "stop") {
        if (!localSessionId) {
          setNotice("No active session to stop.");
          return true;
        }
        await fetchAPI(
          `/api/chat/sessions/${encodeURIComponent(localSessionId)}/stop`,
          {
            method: "POST",
          },
        );
        setSending(false);
        setNotice("Stop requested.");
        return true;
      }
      return false;
    },
    [
      agents,
      approvalMode,
      expandedTranscript,
      fetchAPI,
      loadEnvironmentForSession,
      loadControlPlane,
      loadMessages,
      loadPending,
      loadSubagents,
      loadTasks,
      localSessionId,
      messages,
      modelLine,
      modelOverride,
      onExit,
      pendingMessages,
      selectedAgent,
      selectedAgentId,
      useModelRouter,
      workspaceDir,
    ],
  );

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setHistory((previous) =>
        [...previous.filter((item) => item !== trimmed), trimmed].slice(-50),
      );
      if (trimmed.startsWith("/") && (await runCommand(trimmed))) return;

      setNotice(null);
      setTranscriptOffset(0);
      setMessages((previous) => [
        ...previous,
        { role: "user", content: trimmed },
      ]);
      setSending(true);
      try {
        const response = await fetchAPI<unknown>("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            agentId: selectedAgentId || undefined,
            modelOverride: useModelRouter
              ? undefined
              : modelOverride || undefined,
            sessionId: localSessionId || undefined,
            stream: false,
            useModelRouter,
            workspaceDir: workspaceDir || undefined,
          }),
        });
        const nextSessionId =
          isRecord(response) && typeof response.sessionId === "string"
            ? response.sessionId
            : localSessionId;
        const responseMessage = isRecord(response)
          ? messagesFromResponse([response.message])[0]
          : undefined;
        if (nextSessionId) {
          setLocalSessionId(nextSessionId);
          if (isTransientRuntimeCommand(trimmed) && responseMessage) {
            setMessages((previous) => [
              ...previous.slice(0, -1),
              responseMessage,
            ]);
            return;
          }
          const persistedMessages = await loadMessagesForSession(nextSessionId);
          if (
            responseMessage &&
            !persistedMessages.some(
              (message) =>
                message.role === responseMessage.role &&
                message.content === responseMessage.content,
            )
          ) {
            setMessages([...persistedMessages, responseMessage]);
          }
          await loadSubagents().catch(() => undefined);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSending(false);
      }
    },
    [
      fetchAPI,
      loadMessagesForSession,
      loadSubagents,
      localSessionId,
      modelOverride,
      runCommand,
      selectedAgentId,
      sending,
      useModelRouter,
      workspaceDir,
    ],
  );

  const transcriptMessages = messages.filter(
    (message) => message.role !== "system",
  );
  const visibleMessageLimit = layout.transcriptMessages;
  const maximumTranscriptOffset = Math.max(
    0,
    transcriptMessages.length - visibleMessageLimit,
  );
  const normalizedTranscriptOffset = Math.min(
    transcriptOffset,
    maximumTranscriptOffset,
  );
  const visibleMessageEnd =
    transcriptMessages.length - normalizedTranscriptOffset;
  const visibleMessages = transcriptMessages.slice(
    Math.max(0, visibleMessageEnd - visibleMessageLimit),
    visibleMessageEnd,
  );
  const activeApproval = approvalRequests[0];
  const commandPaletteVisible = commandMatches(input).length > 0;
  const narrowOverlayVisible =
    layout.narrow && (commandPaletteVisible || showEnvironment || showHelp);

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      exit();
      return;
    }
    if (key.ctrl && value === "l") {
      setMessages([]);
      setNotice("Cleared local view. Session history is unchanged.");
      return;
    }
    if (activeApproval) {
      const decision = key.escape ? "deny" : approvalDecisionForInput(value);
      if (decision) void resolveApprovalRequest(activeApproval, decision);
      return;
    }
    if (key.escape) {
      onExit();
      return;
    }
    const pagingKey = key as { pageUp?: boolean; pageDown?: boolean };
    if (pagingKey.pageUp) {
      setTranscriptOffset((current) =>
        Math.min(maximumTranscriptOffset, current + visibleMessageLimit),
      );
      return;
    }
    if (pagingKey.pageDown) {
      setTranscriptOffset((current) =>
        Math.max(0, current - visibleMessageLimit),
      );
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
        historyIndex === null
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
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

  const headerTitle =
    sessionTitle || (localSessionId ? localSessionId.slice(0, 8) : "New chat");
  const activeModelLine = useModelRouter
    ? "Model Router"
    : modelOverride
      ? modelOverride
      : selectedAgent
        ? agentLine(selectedAgent)
        : modelLine || "Gateway default";
  const composerLines = composerWindow(input, cursor, layout.composerLines);

  return (
    <Box flexDirection="column" height={layout.rows} width="100%">
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        flexDirection="column"
      >
        <Box
          flexDirection={layout.narrow ? "column" : "row"}
          justifyContent="space-between"
        >
          <Text bold color="cyan">
            Cybara Chat · {compact(headerTitle, layout.narrow ? 30 : 64)}
          </Text>
          <Text color={sending ? "yellow" : "gray"}>
            {sending ? "working" : "ready"}
          </Text>
        </Box>
        <Text color="gray">
          {compact(activeModelLine, layout.narrow ? 38 : 72)}
          {layout.narrow
            ? ""
            : ` · ${localSessionId || "session will be created on send"}`}
        </Text>
      </Box>
      <Box marginTop={1}>
        <StatusRail
          agent={selectedAgent}
          approvalCount={approvalRequests.length}
          approvalMode={approvalMode}
          pendingCount={pendingMessages.length}
          routerStatus={routerStatus}
          sessionId={localSessionId}
          modelOverride={modelOverride || undefined}
          narrow={layout.narrow}
          useModelRouter={useModelRouter}
        />
      </Box>

      {narrowOverlayVisible ? null : loading ? (
        <Box paddingX={1} paddingY={1} flexGrow={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Loading conversation
          </Text>
        </Box>
      ) : visibleMessages.length === 0 ? (
        <Box paddingX={1} paddingY={1} flexGrow={1}>
          <Text color="gray">No messages yet. Type a prompt or /help.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1} paddingTop={1} flexGrow={1}>
          {visibleMessageEnd < transcriptMessages.length ? (
            <Text color="gray">
              ↓ {transcriptMessages.length - visibleMessageEnd} newer messages
            </Text>
          ) : null}
          {visibleMessages.map((message, index) => (
            <MessageView
              key={`${index}-${message.role}-${message.content.slice(0, 12)}`}
              message={message}
              maxLines={expandedTranscript ? undefined : layout.messageLines}
              maxColumns={Math.max(24, layout.columns - 8)}
            />
          ))}
          {visibleMessageEnd - visibleMessages.length > 0 ? (
            <Text color="gray">
              ↑ {visibleMessageEnd - visibleMessages.length} earlier messages ·
              PageUp/PageDown
            </Text>
          ) : null}
        </Box>
      )}

      {sending ? (
        <Box paddingX={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Working. Type /queue &lt;message&gt; or
            /stop.
          </Text>
        </Box>
      ) : null}
      {activeApproval ? (
        <ToolApprovalPrompt
          request={activeApproval}
          resolving={resolvingApproval}
          queuedCount={approvalRequests.length}
        />
      ) : null}
      <PendingQueue messages={pendingMessages} />
      {showEnvironment ? (
        <EnvironmentPanel
          snapshot={environmentSnapshot}
          tasks={tasks}
          subagents={subagents}
          compact={layout.narrow}
        />
      ) : null}
      {showHelp ? <HelpPanel narrow={layout.narrow} /> : null}
      <CommandPalette
        input={input}
        compactMode={layout.compact}
        maxRows={layout.commandRows}
      />
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

      <Box
        borderStyle="round"
        borderColor={sending ? "yellow" : "green"}
        paddingX={1}
        flexDirection="column"
      >
        <Text color="gray">Ask Cybara</Text>
        {composerLines.map((line, index) => (
          <Text key={index} color={sending ? "gray" : "white"}>
            {index === 0 ? "› " : "  "}
            {line}
          </Text>
        ))}
      </Box>
      <Box paddingX={1}>
        <Text color="gray">
          {layout.narrow
            ? "Enter send · ^J newline · Tab · Esc"
            : "Enter send · ^J newline · ↑↓ history · PgUp/Dn scroll · Tab · Esc"}
        </Text>
      </Box>
    </Box>
  );
}
