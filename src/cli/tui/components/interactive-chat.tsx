import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { resolveAgentIdentifier } from "../../commands/agent-resolution";
import {
  approvalDecisionForInput,
  approvalsFromResponse,
  ToolApprovalPrompt,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./approvals";
import {
  environmentSnapshotFromDetail,
  environmentSnapshotWithWorkspace,
  lspServersFromResponse,
  formatContextUsageLine,
  formatFileChangeLine,
  formatPlanLine,
  formatSubagentLine,
  formatTaskLine,
  formatTokenUsageLine,
  messagesFromDetail,
  subagentsFromResponse,
  tasksForSession,
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
  transcriptMessageLimit,
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
  CommandPalette,
  ActiveRunHint,
  ChatComposerBox,
  ChatFeedback,
  HelpPanel,
  LiveRunView,
  MessageView,
  PendingQueue,
  type ChatMessage,
  type PendingMessage,
} from "./interactive-chat-view";
import {
  agentLine,
  agentConfig,
  agentReasoningEffort,
  agentToolProfile,
  compact,
  deleteAt,
  deleteBefore,
  deletePreviousWord,
  fetchControlPlaneState,
  insertAt,
  isRecord,
  isTransientRuntimeCommand,
  messagesFromResponse,
  pendingFrom,
  nextWordCursor,
  previousWordCursor,
  type AgentSummary,
  type ControlPlaneState,
  type InteractiveChatProps,
  type RouterStatus,
} from "../interactive-chat-data";
import { useInteractiveChatLayout } from "./interactive-chat-layout";
import { executePendingChatCommand } from "./interactive-chat-pending-commands";
import { useInteractiveChatStatus } from "./interactive-chat-status";

export function InteractiveChatTUI({
  apiBase,
  apiKey,
  gatewayPassword,
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
  const [pendingMessages, setPendingMessages] = React.useState<PendingMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState<number | null>(null);
  const [sending, setSending] = React.useState(false);
  const [capabilities, setCapabilities] = React.useState<TUICapabilityOption[]>([]);
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
  const [approvalMode, setApprovalMode] = React.useState("ask");
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
  const {
    colorScheme: tuiColorScheme,
    dismissTransientEnvironmentPanel,
    environmentPanelVisible,
    environmentSidebarVisible,
    environmentStackedVisible,
    inspector: inspectorLayout,
    layout,
    palette: tuiPalette,
    toggleEnvironmentPanel,
    transcriptColumns,
  } = useInteractiveChatLayout();
  const sessionIdRef = React.useRef(localSessionId);
  const lastInterruptAtRef = React.useRef(0);
  const capabilitiesWorkspaceRef = React.useRef<string | null>(null);
  const commandPaletteDraftRef = React.useRef<{
    input: string;
    cursor: number;
  } | null>(null);
  const {
    liveActivities,
    setLiveActivities,
    setStreamDetail,
    setStreamStatus,
    setStreamingText,
    streamDetail,
    streamingText,
    streamStatus,
  } = useInteractiveChatStatus({ apiBase, apiKey, gatewayPassword, sessionIdRef });

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

  const selectedAgent = React.useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  const loadControlPlane =
    React.useCallback(async (): Promise<ControlPlaneState> => {
      const next = await fetchControlPlaneState(fetchAPI, approvalMode);
      setAgents(next.agents);
      setApprovalMode(next.approvalMode);
      setFollowUpBehaviorEnabled(next.followUpBehaviorEnabled);
      setRouterStatus(next.routerStatus);
      return next;
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

  const loadTasks = React.useCallback(async (targetSessionId = localSessionId) => {
    if (!targetSessionId) {
      setTasks([]);
      return [];
    }
    const response = await fetchAPI<unknown>("/api/tasks");
    const next = tasksForSession(response, targetSessionId);
    setTasks(next);
    return next;
  }, [fetchAPI, localSessionId]);

  const loadSubagents = React.useCallback(async (targetSessionId = localSessionId) => {
    if (!targetSessionId) {
      setSubagents([]);
      return [];
    }
    const response = await fetchAPI<unknown>(
      "/api/subagents?sessionId=" + encodeURIComponent(targetSessionId),
    );
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
      return await executePendingChatCommand({
        argument,
        command: normalizedCommand,
        fetchAPI,
        loadMessages,
        loadPending,
        localSessionId,
        modelOverride,
        pendingMessages,
        rest,
        selectedAgentId,
        setNotice,
        setPendingMessages,
        setSending,
        useModelRouter,
        workspaceDir,
      });
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
      if (!localSessionId) setLocalSessionId(turnSessionId);
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
          await Promise.all([
            loadTasks(nextSessionId),
            loadSubagents(nextSessionId),
          ]).catch(() => undefined);
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
        sending,
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
      if (action === "keep_run") {
        setNotice("Run is still active. Use Ctrl+C or /stop to stop it.");
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
    if ((key.ctrl && value === "j") || (key.return && key.shift)) {
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
      setCursor((previous) =>
        key.meta ? previousWordCursor(input, previous) : Math.max(0, previous - 1),
      );
      return;
    }
    if (key.rightArrow) {
      setCursor((previous) =>
        key.meta ? nextWordCursor(input, previous) : Math.min(input.length, previous + 1),
      );
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
    if (key.ctrl && value === "w") {
      const [next, nextCursor] = deletePreviousWord(input, cursor);
      setInput(next);
      setCursor(nextCursor);
      return;
    }
    if (key.ctrl && value === "d") {
      if (!input && !sending) {
        onExit();
        return;
      }
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
  const displayEnvironmentSnapshot = environmentSnapshotWithWorkspace(
    environmentSnapshot,
    workspaceDir,
  );

  return (
    <Box
      flexDirection="column"
      height={layout.rows}
      width={layout.columns}
      backgroundColor={tuiPalette.canvas}
    >
      <ChatHeader
        colorScheme={tuiColorScheme}
        state={{
          approvalCount: approvalRequests.length,
          approvalMode,
          branch: displayEnvironmentSnapshot?.gitBranch || null,
          columns: layout.columns,
          contextUsage: displayEnvironmentSnapshot?.contextUsage || null,
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
            snapshot={displayEnvironmentSnapshot}
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
        <ActiveRunHint followUpsEnabled={followUpBehaviorEnabled} palette={tuiPalette} />
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
          snapshot={displayEnvironmentSnapshot}
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
      <ChatFeedback error={error} notice={notice} palette={tuiPalette} />
      <ChatComposerBox
        followUpsEnabled={followUpBehaviorEnabled}
        input={input}
        lines={composerLines}
        palette={tuiPalette}
        sending={sending}
        textColor={composerTextColor}
        title={composerTitle}
      />
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
