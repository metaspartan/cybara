import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { resolveAgentIdentifier } from "../../commands/agent-resolution";
import { formatTUIAgentLabel } from "../agent-label";
import type { TUIFetchAPI } from "./chat";
import {
  approvalDecisionForInput,
  approvalsFromResponse,
  ToolApprovalPrompt,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./approvals";
import {
  environmentSnapshotFromDetail,
  lspServersFromResponse,
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
  type TuiLspSummary,
  type TuiSubagentSummary,
  type TuiTaskSummary,
} from "../chat-environment";
import { EnvironmentPanel } from "./chat-environment-view";
import {
  chatEscapeAction,
  clipboardCandidates,
  composerWindow,
  copyTextToClipboard,
  resolveTerminalChatInspector,
  transcriptMessageLimit,
  useTerminalLayout,
} from "../terminal";
import {
  defaultTUIConversationExportPath,
  exportNotice,
  formatTUIConversationExport,
  nextTUITranscriptSearchIndex,
  nthLatestAssistantResponse,
  resolveTUIConversationExportPath,
  searchTUITranscript,
  TranscriptSearchPanel,
  transcriptOffsetForMessage,
  tuiTerminalDiagnosticLines,
} from "./chat-history";
import {
  ChatHeader,
  ChatShortcutRail,
} from "./chat-chrome";
import {
  compactInspectionLines,
  lspStatusLines,
  logLines,
  mcpStatusLines,
  memoryStatusLine,
  skillStatusLines,
} from "../chat-inspection";
import {
  TerminalInlineText,
  TerminalMessageBody,
} from "./markdown-render";
import {
  formatTUIWorkedDuration,
  limitTUIActivityDetails,
  presentTUIActivities,
  tuiActivityTone,
  type TUIActivityItem,
  type TUIToolCallItem,
} from "../activity";
import {
  consumeTUIStatusStream,
  type TUIStatusStreamEvent,
  type TUIStreamActivity,
  type TUIStreamStatus,
} from "../status-stream";
import {
  activeTUICapabilityMention,
  capabilitiesFromResponse,
  CapabilityPalette,
  insertTUICapability,
  matchingTUICapabilities,
  type TUICapabilityOption,
} from "./capabilities";
import {
  completeTUIChatCommand,
  matchingTUIChatCommands,
  nextTUIChatCommandIndex,
} from "../commands";
import {
  resolveTuiColorScheme,
  tuiChatPalette,
  type TuiColorScheme,
  type TuiSurfacePalette,
} from "../theme";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  process_activities?: ActivityItem[];
  tool_calls?: ToolCallItem[];
  agent_transfers?: AgentTransferItem[];
}

interface AgentTransferItem {
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  reason: string;
  requestedAt?: string;
}

type ActivityItem = TUIActivityItem;
type ToolCallItem = TUIToolCallItem;

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
  tool_profile?: string;
  config?: unknown;
}

interface RouterStatus {
  enabled?: boolean;
  strategy?: string;
}

interface ControlPlaneState {
  agents: AgentSummary[];
  approvalMode: string;
  followUpBehaviorEnabled: boolean;
  routerStatus: RouterStatus | null;
}

interface InteractiveChatProps {
  apiBase: string;
  apiKey?: string | null;
  fetchAPI: TUIFetchAPI;
  initialAgentId?: string;
  initialWorkspaceDir?: string;
  sessionId?: string;
  title?: string;
  modelLine?: string;
  onExit: () => void;
}

const ROLE_META: Record<
  ChatMessage["role"],
  { label: string; marker: string }
> = {
  user: { label: "You", marker: ">" },
  assistant: { label: "Cybara", marker: "◆" },
  system: { label: "System", marker: "-" },
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

function agentTransfersFrom(value: unknown): AgentTransferItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const fromAgentId =
      typeof item.fromAgentId === "string" ? item.fromAgentId : "";
    const fromAgentName =
      typeof item.fromAgentName === "string" ? item.fromAgentName : "";
    const toAgentId = typeof item.toAgentId === "string" ? item.toAgentId : "";
    const toAgentName =
      typeof item.toAgentName === "string" ? item.toAgentName : "";
    const reason = typeof item.reason === "string" ? item.reason : "";
    if (!fromAgentId || !fromAgentName || !toAgentId || !toAgentName || !reason)
      return [];
    return [
      {
        fromAgentId,
        fromAgentName,
        toAgentId,
        toAgentName,
        reason,
        requestedAt:
          typeof item.requestedAt === "string" ? item.requestedAt : undefined,
      },
    ];
  });
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
  return formatTUIAgentLabel(agent);
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
  if (typeof agent?.tool_profile === "string" && agent.tool_profile.trim()) {
    return agent.tool_profile.trim();
  }
  const value = agentConfig(agent).tool_profile;
  return typeof value === "string" && value.trim() ? value.trim() : "full";
}

function compact(value: string, max = 52): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
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
        agent_transfers: agentTransfersFrom(item.agent_transfers),
      });
    }
  }
  return out;
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

function ActivitySummary({
  colorScheme,
  expanded = false,
  live = false,
  message,
  maxDetails,
  maxColumns,
  palette,
}: {
  colorScheme: TuiColorScheme;
  expanded?: boolean;
  live?: boolean;
  message: ChatMessage;
  maxDetails?: number;
  maxColumns: number;
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  const steeringActivities = (message.process_activities || []).filter(
    (activity) => activity.toolName === "__steering",
  );
  const workActivities = (message.process_activities || []).filter(
    (activity) => activity.toolName !== "__steering",
  );
  const rows = presentTUIActivities(
    workActivities,
    message.tool_calls || [],
  );
  if (rows.length === 0 && steeringActivities.length === 0) return null;
  const workedDuration = formatTUIWorkedDuration(
    workActivities,
    message.tool_calls || [],
  );
  return (
    <Box
      paddingLeft={2}
      marginBottom={1}
      flexDirection="column"
      width={Math.max(12, maxColumns)}
    >
      {rows.length > 0 ? (
        <Text color={palette.muted}>
          {live ? "◌" : expanded ? "▾" : "▸"} {live ? "Working" : "Worked"} for{" "}
          {workedDuration}
        </Text>
      ) : null}
      {rows.length > 0 && (live || expanded)
        ? rows.map((row, rowIndex) => (
            <Box key={`${row.id}-${rowIndex}`} flexDirection="column">
              {row.thought ? (
                <TerminalInlineText
                  line={row.label}
                  baseColor={palette.detail}
                  colorScheme={colorScheme}
                />
              ) : (
                <Text
                  color={palette[tuiActivityTone(row)]}
                  wrap="wrap"
                >
                  {row.icon ? `${row.icon} ` : ""}
                  {row.label}
                </Text>
              )}
              {limitTUIActivityDetails(
                row.details,
                maxDetails ?? row.details.length,
              ).map((label, index, details) => (
                <Text
                  key={`${row.id}-${rowIndex}-${index}`}
                  color={palette.detail}
                  wrap="wrap"
                >
                  {index === details.length - 1 ? "└" : "├"} {label}
                </Text>
              ))}
            </Box>
          ))
        : null}
      {steeringActivities.map((activity, index) => (
        <Text key={activity.id || `steered-${index}`} color={palette.muted} wrap="wrap">
          ↔ {activity.text || "Conversation steered."}
        </Text>
      ))}
    </Box>
  );
}

function MessageView({
  expandedActivities,
  expandedMessage,
  message,
  maxLines,
  maxActivityDetails,
  maxColumns,
  colorScheme,
  palette,
}: {
  expandedActivities: boolean;
  expandedMessage: boolean;
  message: ChatMessage;
  maxLines?: number;
  maxActivityDetails?: number;
  maxColumns: number;
  colorScheme: TuiColorScheme;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  const meta = ROLE_META[message.role];
  const roleColor =
    message.role === "user"
      ? palette.user
      : message.role === "assistant"
        ? palette.heading
        : palette.muted;
  const bodyColor =
    message.role === "user"
      ? palette.detail
      : message.role === "assistant"
        ? palette.text
        : palette.muted;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={roleColor}>
          {meta.marker} {meta.label}
        </Text>
      </Box>
      <ActivitySummary
        colorScheme={colorScheme}
        expanded={expandedActivities}
        message={message}
        maxColumns={maxColumns}
        maxDetails={maxActivityDetails}
        palette={palette}
      />
      {message.agent_transfers?.map((transfer) => (
        <Text
          key={`${transfer.fromAgentId}-${transfer.toAgentId}-${transfer.requestedAt || "transfer"}`}
          color={palette.detail}
        >
          {"  ⇄ "}Transferred from {transfer.fromAgentName} to{" "}
          {transfer.toAgentName}
        </Text>
      ))}
      <Box paddingLeft={2} width="100%">
        <TerminalMessageBody
          baseColor={bodyColor}
          content={message.content}
          colorScheme={colorScheme}
          hiddenText={
            expandedMessage
              ? "… more content hidden · /copy copies the full response"
              : "… more content hidden · /expand shows more"
          }
          maxColumns={maxColumns}
          maxLines={maxLines}
        />
      </Box>
    </Box>
  );
}

function LiveRunView({
  activities,
  content,
  detail,
  maxColumns,
  colorScheme,
  palette,
}: {
  activities: TUIStreamActivity[];
  content: string;
  detail: string;
  maxColumns: number;
  colorScheme: TuiColorScheme;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={palette.heading}>
        ◆ Cybara{" "}
        <Text color={palette.muted}>
          <Spinner type="dots" />
        </Text>
      </Text>
      <ActivitySummary
        colorScheme={colorScheme}
        expanded
        live
        message={{
          role: "assistant",
          content: "",
          process_activities: activities,
        }}
        maxColumns={maxColumns}
        palette={palette}
      />
      {content ? (
        <Box paddingLeft={2} width="100%">
          <TerminalMessageBody
            content={content}
            baseColor={palette.text}
            colorScheme={colorScheme}
          />
        </Box>
      ) : detail ? (
        <Text color={palette.muted} wrap="wrap">
          {" "}
          {detail}
        </Text>
      ) : null}
    </Box>
  );
}

function PendingQueue({
  messages,
  palette,
}: {
  messages: PendingMessage[];
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color={palette.warning}>
        Queue · {messages.length}
      </Text>
      {messages.slice(0, 4).map((message, index) => (
        <Text
          key={message.id}
          color={message.mode === "steering" ? palette.warning : palette.text}
          wrap="wrap"
        >
          {"  "}#{message.sequence || index + 1} {message.content}
          <Text color={palette.subtle}> · {relativeTime(message.createdAt)}</Text>
        </Text>
      ))}
      {messages.length > 4 ? (
        <Text color={palette.subtle}>  +{messages.length - 4} more · /pending</Text>
      ) : null}
    </Box>
  );
}

function CommandPalette({
  input,
  compactMode,
  maxRows,
  selectedIndex,
  palette,
}: {
  input: string;
  compactMode: boolean;
  maxRows: number;
  selectedIndex: number;
  palette: TuiSurfacePalette;
}): React.ReactElement | null {
  const matches = matchingTUIChatCommands(input, maxRows);
  if (matches.length === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={palette.border}
      paddingX={1}
      marginTop={1}
    >
      {matches.map((command, index) => (
        <Text key={command.name} inverse={index === selectedIndex}>
          <Text color={index === selectedIndex ? palette.heading : palette.accent}>
            {index === selectedIndex ? "› " : "  "}
            {command.name}
          </Text>
          {compactMode ? null : <Text color={palette.muted}> — {command.detail}</Text>}
        </Text>
      ))}
    </Box>
  );
}

function HelpPanel({
  narrow,
  palette,
}: {
  narrow: boolean;
  palette: TuiSurfacePalette;
}): React.ReactElement {
  if (narrow) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.border}
        paddingX={1}
        marginTop={1}
      >
        <Text bold color={palette.heading}>
          Chat controls
        </Text>
        <Text>Enter send · ^J newline · Tab complete</Text>
        <Text>^P commands · ^F search · PgUp/PgDn scroll</Text>
        <Text>Esc sessions · ^C quit</Text>
        <Text>/model · /agent · /permissions · /followups · /reasoning</Text>
        <Text>/copy [n] · /export · /diff · /environment</Text>
        <Text>/goal or /loop for persistent work</Text>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.border}
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={palette.heading}>
        Chat controls
      </Text>
      <Text>
        Enter send · Ctrl+J newline · ←/→ move · ↑/↓ palette or history ·
        PgUp/PgDn transcript
      </Text>
      <Text>
        Ctrl+P commands · Ctrl+F transcript search · Esc closes the active panel
      </Text>
      <Text>
        Tab completes slash commands and @ capabilities · approvals use 1/2/3/4
        or y/s/a/n
      </Text>
      <Text>
        /agents lists · /agent name switches · /router on|off · /permissions
        ask|always_allow
      </Text>
      <Text>/followups on|off controls queue and steer behavior</Text>
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
        /copy [n] copies an answer · /export writes Markdown · /diff shows
        changes
      </Text>
      <Text>
        /terminal-info checks viewport, color, clipboard, and screen mode
      </Text>
      <Text>
        /reload refetches · /new starts fresh · /resume returns to sessions
      </Text>
      <Text>/raw or /expand toggles compact and detailed message bodies</Text>
    </Box>
  );
}

export function InteractiveChatTUI({
  apiBase,
  apiKey,
  fetchAPI,
  initialAgentId,
  initialWorkspaceDir,
  sessionId,
  title,
  modelLine,
  onExit,
}: InteractiveChatProps): React.ReactElement {
  const { exit } = useApp();
  const [localSessionId, setLocalSessionId] = React.useState(sessionId || "");
  const [sessionTitle, setSessionTitle] = React.useState(title || "");
  const [workspaceDir, setWorkspaceDir] = React.useState(
    initialWorkspaceDir || "",
  );
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
  const [streamStatus, setStreamStatus] =
    React.useState<TUIStreamStatus>("idle");
  const [streamDetail, setStreamDetail] = React.useState("");
  const [streamingText, setStreamingText] = React.useState("");
  const [liveActivities, setLiveActivities] = React.useState<
    TUIStreamActivity[]
  >([]);
  const [capabilities, setCapabilities] = React.useState<TUICapabilityOption[]>(
    [],
  );
  const [capabilityIndex, setCapabilityIndex] = React.useState(0);
  const [commandIndex, setCommandIndex] = React.useState(0);
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
  const [followUpBehaviorEnabled, setFollowUpBehaviorEnabled] =
    React.useState(true);
  const [routerStatus, setRouterStatus] = React.useState<RouterStatus | null>(
    null,
  );
  const [environmentSnapshot, setEnvironmentSnapshot] =
    React.useState<TuiEnvironmentSnapshot | null>(null);
  const [tasks, setTasks] = React.useState<TuiTaskSummary[]>([]);
  const [subagents, setSubagents] = React.useState<TuiSubagentSummary[]>([]);
  const [lspServers, setLspServers] = React.useState<TuiLspSummary[]>([]);
  const [environmentPanelMode, setEnvironmentPanelMode] = React.useState<
    "auto" | "shown" | "hidden"
  >("auto");
  const [expandedTranscript, setExpandedTranscript] = React.useState(false);
  const [expandedActivities, setExpandedActivities] = React.useState(false);
  const [transcriptOffset, setTranscriptOffset] = React.useState(0);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchIndex, setSearchIndex] = React.useState(0);
  const [approvalRequests, setApprovalRequests] = React.useState<
    ToolApprovalRequest[]
  >([]);
  const [resolvingApproval, setResolvingApproval] = React.useState(false);
  const layout = useTerminalLayout();
  const tuiColorScheme = resolveTuiColorScheme(process.env);
  const tuiPalette = tuiChatPalette(tuiColorScheme);
  const inspectorLayout = resolveTerminalChatInspector(layout.columns);
  const environmentPanelVisible =
    environmentPanelMode === "shown" ||
    (environmentPanelMode === "auto" && inspectorLayout.sidebar);
  const environmentSidebarVisible = environmentPanelVisible && inspectorLayout.sidebar;
  const environmentStackedVisible = environmentPanelVisible && !inspectorLayout.sidebar;
  const transcriptColumns = environmentSidebarVisible
    ? inspectorLayout.contentColumns
    : layout.columns;
  const sessionIdRef = React.useRef(localSessionId);
  const lastInterruptAtRef = React.useRef(0);
  const capabilitiesWorkspaceRef = React.useRef<string | null>(null);
  const commandPaletteDraftRef = React.useRef<{
    input: string;
    cursor: number;
  } | null>(null);

  const toggleEnvironmentPanel = React.useCallback(() => {
    setEnvironmentPanelMode((current) => {
      const visible = current === "shown" || (current === "auto" && inspectorLayout.sidebar);
      return visible ? "hidden" : "shown";
    });
  }, [inspectorLayout.sidebar]);

  const dismissTransientEnvironmentPanel = React.useCallback(() => {
    setEnvironmentPanelMode((current) => (current === "shown" ? "hidden" : current));
  }, []);

  const activeCapabilityMention = React.useMemo(
    () => activeTUICapabilityMention(input, cursor),
    [cursor, input],
  );
  const capabilityOptions = React.useMemo(
    () =>
      matchingTUICapabilities(
        capabilities,
        activeCapabilityMention,
        Math.max(2, Math.min(6, layout.commandRows)),
      ),
    [activeCapabilityMention, capabilities, layout.commandRows],
  );
  const commandOptions = React.useMemo(
    () => matchingTUIChatCommands(input, layout.commandRows),
    [input, layout.commandRows],
  );

  React.useEffect(() => {
    sessionIdRef.current = localSessionId;
  }, [localSessionId]);

  React.useEffect(() => {
    setCapabilityIndex(0);
  }, [activeCapabilityMention?.query]);

  React.useEffect(() => {
    setCommandIndex(0);
  }, [input]);

  React.useEffect(() => {
    if (!activeCapabilityMention) return;
    const cacheKey = workspaceDir || "";
    if (capabilitiesWorkspaceRef.current === cacheKey) return;
    capabilitiesWorkspaceRef.current = cacheKey;
    const suffix = workspaceDir
      ? `?workspaceDir=${encodeURIComponent(workspaceDir)}`
      : "";
    void fetchAPI<unknown>(`/api/chat/capabilities${suffix}`).then(
      (response) => {
        if (response) setCapabilities(capabilitiesFromResponse(response));
        else capabilitiesWorkspaceRef.current = null;
      },
    );
  }, [activeCapabilityMention, fetchAPI, workspaceDir]);

  React.useEffect(() => {
    const controller = new AbortController();
    const appendStatusActivity = (event: TUIStatusStreamEvent): void => {
      const activeSessionId = sessionIdRef.current;
      if (event.type === "snapshot") {
        const active = event.activeSessions.find(
          (session) => session.sessionId === activeSessionId,
        );
        if (!active) {
          setStreamStatus("idle");
          setStreamDetail("");
          setLiveActivities([]);
          return;
        }
        setStreamStatus(active.status);
        setStreamDetail(active.detail || "");
        setLiveActivities(active.activities || []);
        return;
      }
      if (event.sessionId !== activeSessionId) return;
      if (event.type === "assistant_token") {
        setStreamingText((current) => current + event.delta);
        return;
      }
      setStreamStatus(event.status);
      setStreamDetail(event.detail || "");
      if (!event.toolPhase && !event.toolName) return;
      const phase =
        event.toolPhase || (event.status === "error" ? "error" : "result");
      const id =
        event.toolCallId ||
        `${event.toolName || "activity"}-${event.timestamp}`;
      const activity: TUIStreamActivity = {
        id,
        phase,
        text: event.detail || event.toolName || "Tool activity",
        timestamp: event.timestamp,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
      };
      setLiveActivities((current) => [
        ...current.filter(
          (item) =>
            item.id !== id &&
            (!event.toolCallId ||
              item.toolCallId !== event.toolCallId ||
              item.phase === phase),
        ),
        activity,
      ]);
    };
    void consumeTUIStatusStream({
      apiBase,
      apiKey,
      signal: controller.signal,
      onEvent: appendStatusActivity,
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        setStreamDetail(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => controller.abort();
  }, [apiBase, apiKey]);

  const selectedAgent = React.useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const loadControlPlane =
    React.useCallback(async (): Promise<ControlPlaneState> => {
      const [agentResponse, configResponse, routerResponse] = await Promise.all(
        [
          fetchAPI<unknown>("/api/agents/summary"),
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
      const nextFollowUpBehaviorEnabled =
        !isRecord(configResponse) ||
        configResponse.follow_up_behavior_enabled !== false;
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
      setFollowUpBehaviorEnabled(nextFollowUpBehaviorEnabled);
      setRouterStatus(nextRouterStatus);
      return {
        agents: nextAgents,
        approvalMode: nextApprovalMode,
        followUpBehaviorEnabled: nextFollowUpBehaviorEnabled,
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
      if (
        isRecord(response) &&
        typeof response.title === "string" &&
        response.title.trim()
      ) {
        setSessionTitle(response.title.trim());
      }
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
    const query = localSessionId
      ? "?sessionId=" + encodeURIComponent(localSessionId)
      : "";
    const response = await fetchAPI<unknown>("/api/subagents" + query);
    const next = subagentsFromResponse(response);
    setSubagents(next);
    return next;
  }, [fetchAPI, localSessionId]);

  const loadLspServers = React.useCallback(async () => {
    const response = await fetchAPI<unknown>("/api/lsp/status");
    const next = lspServersFromResponse(response);
    setLspServers(next);
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

  React.useEffect(() => {
    if (!environmentPanelVisible) return;
    void Promise.all([loadTasks(), loadSubagents(), loadLspServers()]).catch(() => undefined);
    const timer = setInterval(() => void loadLspServers(), 5000);
    return () => clearInterval(timer);
  }, [environmentPanelVisible, loadLspServers, loadSubagents, loadTasks]);

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
    commandPaletteDraftRef.current = null;
    setInput("");
    setCursor(0);
    setHistoryIndex(null);
  }, []);

  const openTranscriptSearch = React.useCallback((query = "") => {
    setSearchQuery(query);
    setSearchIndex(0);
    setSearchOpen(true);
    dismissTransientEnvironmentPanel();
    setShowHelp(false);
    setNotice(null);
  }, [dismissTransientEnvironmentPanel]);

  const finishLiveRun = React.useCallback(() => {
    setSending(false);
    setStreamStatus("idle");
    setStreamDetail("");
    setStreamingText("");
    setLiveActivities([]);
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
            `follow-ups ${followUpBehaviorEnabled ? "queue/steer" : "off"}`,
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
      if (normalizedCommand === "lsp") {
        const response = await fetchAPI<unknown>("/api/lsp/install-status");
        const lines = lspStatusLines(response);
        setNotice(
          lines.length
            ? compactInspectionLines(lines)
            : "No language servers returned by the gateway.",
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
      if (normalizedCommand === "agent" || normalizedCommand === "transfer") {
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
        const agentId = resolveAgentIdentifier(argument, availableAgents);
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
      if (["followups", "followup"].includes(normalizedCommand)) {
        const value = argument.trim().toLowerCase();
        if (!value || value === "show") {
          setNotice(
            `Queue / Steer follow-ups: ${followUpBehaviorEnabled ? "on" : "off"}`,
          );
          return true;
        }
        const enabled = ["on", "enable", "enabled"].includes(value)
          ? true
          : ["off", "disable", "disabled"].includes(value)
            ? false
            : null;
        if (enabled === null) {
          setNotice("Usage: /followups on|off|show");
          return true;
        }
        const response = await fetchAPI<unknown>("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ follow_up_behavior_enabled: enabled }),
        });
        if (isRecord(response) && response.success === false) {
          setNotice(
            typeof response.error === "string"
              ? response.error
              : "Gateway rejected the follow-up setting.",
          );
          return true;
        }
        setFollowUpBehaviorEnabled(enabled);
        setNotice(
          `Queue / Steer follow-ups ${enabled ? "enabled" : "disabled"}.`,
        );
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
        const detail = await fetchAPI<AgentSummary>(
          `/api/agents/${encodeURIComponent(selectedAgentId)}`,
        );
        const response = await fetchAPI<unknown>(
          `/api/agents/${encodeURIComponent(selectedAgentId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config: {
                ...agentConfig(detail ?? selectedAgent),
                tool_profile: value,
              },
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
        toggleEnvironmentPanel();
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
      if (normalizedCommand === "search" || normalizedCommand === "find") {
        openTranscriptSearch(argument);
        return true;
      }
      if (normalizedCommand === "copy") {
        const position = argument ? Number.parseInt(argument, 10) : 1;
        if (
          !Number.isInteger(position) ||
          position < 1 ||
          String(position) !== (argument || "1")
        ) {
          setNotice("Usage: /copy [response number]");
          return true;
        }
        const response = nthLatestAssistantResponse(messages, position);
        if (!response) {
          setNotice(`Assistant response ${position} is not available.`);
          return true;
        }
        setNotice(
          (await copyTextToClipboard(response))
            ? position === 1
              ? "Latest response copied."
              : `Assistant response ${position} copied.`
            : "No system clipboard helper is available.",
        );
        return true;
      }
      if (normalizedCommand === "export") {
        const outputPath = argument
          ? resolveTUIConversationExportPath(argument, process.cwd())
          : defaultTUIConversationExportPath(
              localSessionId,
              process.cwd(),
              Date.now(),
            );
        if (await Bun.file(outputPath).exists()) {
          setNotice(`Export already exists: ${outputPath}`);
          return true;
        }
        try {
          await Bun.write(
            outputPath,
            formatTUIConversationExport(messages, {
              title: sessionTitle,
              sessionId: localSessionId,
              workspaceDir,
              model: useModelRouter
                ? "Model Router"
                : modelOverride ||
                  selectedAgent?.model ||
                  modelLine ||
                  "Gateway default",
            }),
          );
          setNotice(`${exportNotice(outputPath)}\n${outputPath}`);
        } catch (cause) {
          setNotice(
            `Export failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
        return true;
      }
      if (normalizedCommand === "terminal-info") {
        const clipboardCommand = clipboardCandidates(
          process.platform,
          process.env,
        ).find((candidate) => Bun.which(candidate[0] || ""))?.[0];
        setNotice(
          tuiTerminalDiagnosticLines({
            columns: layout.columns,
            rows: layout.rows,
            isTTY: Boolean(process.stdout.isTTY),
            platform: process.platform,
            env: process.env,
            clipboardCommand: clipboardCommand || null,
          }).join("\n"),
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
      if (normalizedCommand === "details") {
        setExpandedActivities((value) => !value);
        setNotice(
          `Work details ${expandedActivities ? "collapsed" : "expanded"}.`,
        );
        return true;
      }
      if (normalizedCommand === "expand" || normalizedCommand === "raw") {
        setExpandedTranscript((value) => !value);
        setNotice(
          `Transcript detail ${expandedTranscript ? "compacted" : "expanded"}.`,
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
      followUpBehaviorEnabled,
      loadEnvironmentForSession,
      loadControlPlane,
      loadMessages,
      loadPending,
      loadSubagents,
      loadTasks,
      layout.columns,
      layout.rows,
      localSessionId,
      messages,
      modelLine,
      modelOverride,
      onExit,
      openTranscriptSearch,
      pendingMessages,
      selectedAgent,
      selectedAgentId,
      sessionTitle,
      toggleEnvironmentPanel,
      useModelRouter,
      workspaceDir,
    ],
  );

  const send = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setHistory((previous) =>
        [...previous.filter((item) => item !== trimmed), trimmed].slice(-50),
      );
      if (sending) {
        if (trimmed.startsWith("/") && (await runCommand(trimmed))) return;
        if (!followUpBehaviorEnabled) {
          setNotice(
            "Queue / Steer follow-ups are disabled. Use /followups on to enable them.",
          );
          return;
        }
        const activeSessionId = localSessionId || sessionIdRef.current;
        if (!activeSessionId) {
          setNotice(
            "Wait for the first session to start before queueing a follow-up.",
          );
          return;
        }
        const queued = await fetchAPI<unknown>("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgentId || undefined,
            message: trimmed,
            modelOverride: useModelRouter
              ? undefined
              : modelOverride || undefined,
            queueMode: "queue",
            sessionId: activeSessionId,
            useModelRouter,
            workspaceDir: workspaceDir || undefined,
          }),
        });
        setPendingMessages(
          pendingFrom(isRecord(queued) ? queued.pendingMessages : []),
        );
        setNotice("Queued follow-up.");
        return;
      }
      if (trimmed.startsWith("/") && (await runCommand(trimmed))) return;

      setNotice(null);
      setTranscriptOffset(0);
      setMessages((previous) => [
        ...previous,
        { role: "user", content: trimmed },
      ]);
      setSending(true);
      setStreamStatus("thinking");
      setStreamDetail("Thinking...");
      setStreamingText("");
      setLiveActivities([]);
      const turnSessionId = localSessionId || crypto.randomUUID();
      sessionIdRef.current = turnSessionId;
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
            sessionId: turnSessionId,
            stream: false,
            useModelRouter,
            workspaceDir: workspaceDir || undefined,
          }),
        });
        const nextSessionId =
          isRecord(response) && typeof response.sessionId === "string"
            ? response.sessionId
            : turnSessionId;
        const responseMessage = isRecord(response)
          ? messagesFromResponse([response.message])[0]
          : undefined;
        if (
          isRecord(response) &&
          isRecord(response.agent) &&
          typeof response.agent.id === "string"
        ) {
          const nextAgentId = response.agent.id.trim();
          if (nextAgentId) setSelectedAgentId(nextAgentId);
        }
        if (nextSessionId) {
          sessionIdRef.current = nextSessionId;
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
          finishLiveRun();
          await loadSubagents().catch(() => undefined);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        finishLiveRun();
      }
    },
    [
      fetchAPI,
      finishLiveRun,
      followUpBehaviorEnabled,
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

  const transcriptMessages = React.useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );
  const searchMatches = React.useMemo(
    () => searchTUITranscript(transcriptMessages, searchQuery),
    [searchQuery, transcriptMessages],
  );
  const visibleMessageLimit = transcriptMessageLimit(
    layout.transcriptMessages,
    expandedTranscript,
  );
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
  const expandedMessageLines = Math.max(
    layout.messageLines,
    layout.rows - (layout.narrow ? 9 : 10),
  );
  const commandPaletteVisible = commandOptions.length > 0;
  const capabilityPaletteVisible = capabilityOptions.length > 0;
  const narrowOverlayVisible =
    layout.narrow &&
    (commandPaletteVisible ||
      capabilityPaletteVisible ||
      environmentStackedVisible ||
      showHelp ||
      searchOpen);

  const selectCapability = React.useCallback((): boolean => {
    if (!activeCapabilityMention || capabilityOptions.length === 0)
      return false;
    const option =
      capabilityOptions[
        Math.min(capabilityIndex, capabilityOptions.length - 1)
      ];
    if (!option) return false;
    const inserted = insertTUICapability(
      input,
      activeCapabilityMention,
      option,
    );
    setInput(inserted.value);
    setCursor(inserted.cursor);
    return true;
  }, [activeCapabilityMention, capabilityIndex, capabilityOptions, input]);

  const selectCommand = React.useCallback((): boolean => {
    const completed = completeTUIChatCommand(input, commandIndex);
    if (!completed) return false;
    commandPaletteDraftRef.current = null;
    setInput(completed);
    setCursor(completed.length);
    return true;
  }, [commandIndex, input]);

  const selectSearchMatch = React.useCallback((): boolean => {
    const match =
      searchMatches[Math.min(searchIndex, searchMatches.length - 1)];
    if (!match) return false;
    setTranscriptOffset(
      transcriptOffsetForMessage(
        match.messageIndex,
        transcriptMessages.length,
        visibleMessageLimit,
      ),
    );
    setSearchOpen(false);
    setNotice(
      `Jumped to ${match.role === "user" ? "your message" : "an assistant response"}.`,
    );
    return true;
  }, [
    searchIndex,
    searchMatches,
    transcriptMessages.length,
    visibleMessageLimit,
  ]);

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      const now = Date.now();
      const activeSessionId = localSessionId || sessionIdRef.current;
      if (
        sending &&
        activeSessionId &&
        now - lastInterruptAtRef.current > 1500
      ) {
        lastInterruptAtRef.current = now;
        setNotice("Stopping active run. Press Ctrl+C again to exit.");
        void fetchAPI(
          `/api/chat/sessions/${encodeURIComponent(activeSessionId)}/stop`,
          { method: "POST" },
        );
        return;
      }
      exit();
      return;
    }
    if (key.ctrl && value === "l") {
      setMessages([]);
      setNotice("Cleared local view. Session history is unchanged.");
      return;
    }
    if (key.ctrl && value === "t") {
      setExpandedTranscript((current) => !current);
      setTranscriptOffset(0);
      setNotice(
        expandedTranscript
          ? "Showing more transcript turns."
          : "Showing the latest turn with more detail.",
      );
      return;
    }
    if (key.ctrl && value === "o") {
      setExpandedActivities((current) => !current);
      setNotice(
        expandedActivities ? "Work details collapsed." : "Work details expanded.",
      );
      return;
    }
    if (activeApproval) {
      const decision = key.escape ? "deny" : approvalDecisionForInput(value);
      if (decision) void resolveApprovalRequest(activeApproval, decision);
      return;
    }
    if (key.ctrl && value === "f") {
      if (searchOpen) {
        setSearchOpen(false);
      } else {
        openTranscriptSearch();
      }
      return;
    }
    if (key.ctrl && value === "p") {
      commandPaletteDraftRef.current = input ? { input, cursor } : null;
      setSearchOpen(false);
      dismissTransientEnvironmentPanel();
      setShowHelp(false);
      setInput("/");
      setCursor(1);
      setCommandIndex(0);
      setNotice(null);
      return;
    }
    if (searchOpen) {
      if (key.escape) {
        setSearchOpen(false);
        return;
      }
      if (key.return) {
        selectSearchMatch();
        return;
      }
      if (key.upArrow || key.downArrow) {
        setSearchIndex((current) =>
          nextTUITranscriptSearchIndex(
            current,
            key.upArrow ? -1 : 1,
            searchMatches.length,
          ),
        );
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery((current) => current.slice(0, -1));
        setSearchIndex(0);
        return;
      }
      if (key.ctrl && value === "u") {
        setSearchQuery("");
        setSearchIndex(0);
        return;
      }
      if (value && !key.ctrl && !key.meta) {
        setSearchQuery((current) => current + value);
        setSearchIndex(0);
      }
      return;
    }
    if (key.escape) {
      if (commandPaletteDraftRef.current && commandOptions.length > 0) {
        const draft = commandPaletteDraftRef.current;
        commandPaletteDraftRef.current = null;
        setInput(draft.input);
        setCursor(draft.cursor);
        return;
      }
      const action = chatEscapeAction(
        environmentStackedVisible || showHelp,
        input.length > 0,
      );
      if (action === "close_panel") {
        dismissTransientEnvironmentPanel();
        setShowHelp(false);
        setNotice("Panel closed.");
        return;
      }
      if (action === "clear_draft") {
        resetInput();
        setNotice("Draft cleared. Press Esc again to return to sessions.");
        return;
      }
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
      if (selectCapability()) return;
      if (selectCommand()) return;
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
    if (key.upArrow) {
      if (capabilityOptions.length > 0) {
        setCapabilityIndex(
          (current) =>
            (current - 1 + capabilityOptions.length) % capabilityOptions.length,
        );
        return;
      }
      if (commandOptions.length > 0) {
        setCommandIndex((current) =>
          nextTUIChatCommandIndex(current, -1, commandOptions.length),
        );
        return;
      }
      if (history.length === 0) return;
      const nextIndex =
        historyIndex === null
          ? history.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex] || "");
      setCursor((history[nextIndex] || "").length);
      return;
    }
    if (key.downArrow) {
      if (capabilityOptions.length > 0) {
        setCapabilityIndex(
          (current) => (current + 1) % capabilityOptions.length,
        );
        return;
      }
      if (commandOptions.length > 0) {
        setCommandIndex((current) =>
          nextTUIChatCommandIndex(current, 1, commandOptions.length),
        );
        return;
      }
      if (history.length === 0) return;
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
    if ((key as { tab?: boolean }).tab) {
      if (selectCapability()) return;
      if (selectCommand()) return;
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
      if (value === "?" && input.length === 0) {
        setShowHelp((current) => !current);
        setNotice(null);
        return;
      }
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
  const composerLines = input
    ? composerWindow(input, cursor, layout.composerLines)
    : ["Ask Cybara ▏"];
  const composerTitle = sending
    ? followUpBehaviorEnabled
      ? "Queue follow-up"
      : "Run in progress"
    : "Ask Cybara";
  const composerTextColor =
    sending && !followUpBehaviorEnabled ? tuiPalette.muted : tuiPalette.text;

  return (
    <Box flexDirection="column" height={layout.rows} width="100%">
      <ChatHeader
        colorScheme={tuiColorScheme}
        state={{
          approvalCount: approvalRequests.length,
          approvalMode,
          branch: environmentSnapshot?.gitBranch || null,
          columns: layout.columns,
          contextUsage: environmentSnapshot?.contextUsage || null,
          model: activeModelLine,
          pendingCount: pendingMessages.length,
          profile: agentToolProfile(selectedAgent),
          reasoning: agentReasoningEffort(selectedAgent),
          sending,
          sessionId: localSessionId,
          status: streamStatus,
          title: headerTitle,
          workspaceDir,
        }}
      />

      <Box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {narrowOverlayVisible ? null : loading ? (
            <Box paddingX={1} paddingY={1} flexGrow={1} flexShrink={1} overflow="hidden">
              <Text color={tuiPalette.warning}>
                <Spinner type="dots" /> Loading conversation
              </Text>
            </Box>
          ) : visibleMessages.length === 0 ? (
            <Box paddingX={1} paddingY={1} flexGrow={1} flexShrink={1} overflow="hidden">
              <Text color={tuiPalette.muted}>No messages yet. Type a prompt or /help.</Text>
            </Box>
          ) : (
            <Box
              flexDirection="column"
              paddingX={1}
              paddingTop={1}
              flexGrow={1}
              flexShrink={1}
              overflow="hidden"
            >
              {visibleMessageEnd < transcriptMessages.length ? (
                <Text color={tuiPalette.muted}>
                  ↓ {transcriptMessages.length - visibleMessageEnd} newer messages
                </Text>
              ) : null}
              {visibleMessages.map((message, index) => (
                <MessageView
                  expandedActivities={expandedActivities}
                  expandedMessage={expandedTranscript}
                  key={`${index}-${message.role}-${message.content.slice(0, 12)}`}
                  message={message}
                  maxLines={expandedTranscript ? expandedMessageLines : layout.messageLines}
                  maxActivityDetails={expandedActivities ? undefined : 0}
                  maxColumns={Math.max(24, transcriptColumns - 8)}
                  colorScheme={tuiColorScheme}
                  palette={tuiPalette}
                />
              ))}
              {sending ? (
                <LiveRunView
                  activities={liveActivities}
                  content={streamingText}
                  detail={streamDetail}
                  maxColumns={Math.max(24, transcriptColumns - 8)}
                  colorScheme={tuiColorScheme}
                  palette={tuiPalette}
                />
              ) : null}
              {visibleMessageEnd - visibleMessages.length > 0 ? (
                <Text color={tuiPalette.muted}>
                  ↑ {visibleMessageEnd - visibleMessages.length} earlier messages · PageUp/PageDown
                </Text>
              ) : null}
            </Box>
          )}
        </Box>
        {environmentSidebarVisible ? (
          <EnvironmentPanel
            snapshot={environmentSnapshot}
            tasks={tasks}
            subagents={subagents}
            lspServers={lspServers}
            colorScheme={tuiColorScheme}
            variant="sidebar"
            width={inspectorLayout.width}
          />
        ) : null}
      </Box>

      {sending ? (
        <Box paddingX={1}>
          <Text color={tuiPalette.accent}>
            <Spinner type="dots" />{" "}
            {followUpBehaviorEnabled
              ? "Enter queues · /steer injects"
              : "Follow-ups off"}{" "}
            · Ctrl+C stops
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
      <PendingQueue messages={pendingMessages} palette={tuiPalette} />
      {environmentStackedVisible ? (
        <EnvironmentPanel
          snapshot={environmentSnapshot}
          tasks={tasks}
          subagents={subagents}
          lspServers={lspServers}
          colorScheme={tuiColorScheme}
          compact={layout.narrow}
        />
      ) : null}
      {showHelp ? <HelpPanel narrow={layout.narrow} palette={tuiPalette} /> : null}
      {searchOpen ? (
        <TranscriptSearchPanel
          query={searchQuery}
          matches={searchMatches}
          selectedIndex={searchIndex}
          compact={layout.compact}
        />
      ) : null}
      <CapabilityPalette
        options={capabilityOptions}
        selectedIndex={capabilityIndex}
        maxColumns={Math.max(24, layout.columns - 8)}
      />
      <CommandPalette
        input={input}
        compactMode={layout.compact}
        maxRows={layout.commandRows}
        selectedIndex={commandIndex}
        palette={tuiPalette}
      />
      {error ? (
        <Box paddingX={1}>
          <Text color={tuiPalette.danger}>Error: {error}</Text>
        </Box>
      ) : null}
      {notice ? (
        <Box paddingX={1}>
          <Text color={tuiPalette.muted}>{notice}</Text>
        </Box>
      ) : null}

      <Box
        borderStyle="round"
        borderColor={sending ? tuiPalette.accent : tuiPalette.chrome}
        backgroundColor={tuiPalette.background}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
      >
        {sending ? (
          <Text color={followUpBehaviorEnabled ? tuiPalette.accent : tuiPalette.muted}>
            {composerTitle}
          </Text>
        ) : null}
        {composerLines.map((line, index) => (
          <Text key={index} color={input ? composerTextColor : tuiPalette.subtle}>
            {index === 0 ? "› " : "  "}
            {line}
          </Text>
        ))}
      </Box>
      <ChatShortcutRail
        colorScheme={tuiColorScheme}
        state={{
          activeApproval: Boolean(activeApproval),
          columns: layout.columns,
          followUpsEnabled: followUpBehaviorEnabled,
          panelOpen: environmentStackedVisible || showHelp || searchOpen,
          paletteOpen:
            commandPaletteVisible || capabilityPaletteVisible || searchOpen,
          sending,
        }}
      />
    </Box>
  );
}
