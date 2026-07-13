import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { InteractiveChatTUI } from "./cli-tui-interactive-chat";
import { useTerminalLayout } from "./cli-tui-terminal";
import { useTUIBack } from "./cli-tui-navigation";

const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown })
      .setRawMode === "function",
};

export type TUIFetchAPI = <T>(
  endpoint: string,
  options?: RequestInit,
) => Promise<T | null>;

interface ChatSessionSummary {
  id?: string;
  title?: string;
  agent_id?: string;
  agentId?: string;
  workspace_dir?: string;
  workspaceDir?: string;
  message_count?: number;
  messageCount?: number;
  updated_at?: string;
  updatedAt?: string;
  created_at?: string;
  createdAt?: string;
  pinned?: boolean;
  status?: string;
  pendingCount?: number;
  pending_count?: number;
  modelMetadata?: {
    agent_name?: string;
    provider?: string;
    provider_name?: string;
    model?: string;
  } | null;
}

interface ChatAgentSummary {
  id?: string;
  name?: string;
  model?: string;
  provider_id?: string;
  providerId?: string;
}

function sessionsFromResponse(value: unknown): ChatSessionSummary[] {
  if (Array.isArray(value)) return value as ChatSessionSummary[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { sessions?: unknown }).sessions)
  ) {
    return (value as { sessions: ChatSessionSummary[] }).sessions;
  }
  return [];
}

function sessionTotalFromResponse(value: unknown, fallback: number): number {
  if (!value || typeof value !== "object") return fallback;
  const total = (value as { total?: unknown }).total;
  return typeof total === "number" && Number.isFinite(total) ? Math.max(fallback, total) : fallback;
}

function agentsFromResponse(value: unknown): ChatAgentSummary[] {
  if (Array.isArray(value)) return value as ChatAgentSummary[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { agents?: unknown }).agents)
  ) {
    return (value as { agents: ChatAgentSummary[] }).agents;
  }
  return [];
}

function sessionTimestamp(session: ChatSessionSummary): number {
  const value =
    session.updated_at ||
    session.updatedAt ||
    session.created_at ||
    session.createdAt ||
    "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionStatus(session: ChatSessionSummary): string {
  return String(session.status || "idle").toLowerCase();
}

function sessionIsActive(session: ChatSessionSummary): boolean {
  return ["thinking", "generating", "compacting", "tool_executing"].includes(
    sessionStatus(session),
  );
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function compactText(
  value: string | undefined,
  fallback: string,
  max = 44,
): string {
  const text = (value || "").trim() || fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactPath(value: string | undefined, max = 54): string {
  const text = (value || "").trim();
  if (!text) return "No workspace";
  const parts = text.split("/").filter(Boolean);
  if (parts.length <= 2) return compactText(text, text, max);
  return compactText(`…/${parts.slice(-2).join("/")}`, text, max);
}

function agentForSession(
  session: ChatSessionSummary,
  agentsById: Map<string, ChatAgentSummary>,
): ChatAgentSummary | undefined {
  const id = session.agent_id || session.agentId;
  return id ? agentsById.get(id) : undefined;
}

function sessionModelLine(
  session: ChatSessionSummary,
  agentsById: Map<string, ChatAgentSummary>,
): string {
  const metadata = session.modelMetadata;
  const provider = metadata?.provider_name || metadata?.provider;
  const model = metadata?.model;
  if (provider && model) return `${provider} · ${model}`;
  if (model) return model;
  const agent = agentForSession(session, agentsById);
  if (agent?.name && agent.model) return `${agent.name} · ${agent.model}`;
  if (agent?.name) return agent.name;
  if (agent?.model) return agent.model;
  return metadata?.agent_name || "Gateway default";
}

function sessionPendingCount(session: ChatSessionSummary): number {
  return Math.max(0, session.pending_count ?? session.pendingCount ?? 0);
}

function sessionWorkspace(session: ChatSessionSummary): string | undefined {
  return session.workspace_dir || session.workspaceDir;
}

function sessionRowMeta(
  session: ChatSessionSummary,
  agentsById: Map<string, ChatAgentSummary>,
): string {
  const pending = sessionPendingCount(session);
  const messageCount = session.message_count ?? session.messageCount ?? 0;
  const parts = [
    sessionModelLine(session, agentsById),
    `${messageCount} msg${messageCount === 1 ? "" : "s"}`,
    pending > 0 ? `${pending} queued` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function TUIChatCommand({
  apiBase,
  apiKey,
  fetchAPI,
}: {
  apiBase: string;
  apiKey?: string | null;
  fetchAPI: TUIFetchAPI;
}) {
  const exit = useTUIBack();
  const [sessions, setSessions] = React.useState<ChatSessionSummary[]>([]);
  const [totalSessions, setTotalSessions] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [agentsById, setAgentsById] = React.useState<
    Map<string, ChatAgentSummary>
  >(() => new Map());
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [openSession, setOpenSession] =
    React.useState<ChatSessionSummary | null>(null);
  const [searchMode, setSearchMode] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [showHelp, setShowHelp] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const layout = useTerminalLayout();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, agentResponse] = await Promise.all([
        fetchAPI<unknown>("/api/sessions?limit=48&includeTotal=1"),
        fetchAPI<unknown>("/api/agents/summary"),
      ]);
      const nextSessions = sessionsFromResponse(response)
        .slice()
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            sessionTimestamp(b) - sessionTimestamp(a),
        );
      setSessions(nextSessions.slice(0, 24));
      setTotalSessions(sessionTotalFromResponse(response, nextSessions.length));
      setAgentsById(
        new Map(
          agentsFromResponse(agentResponse).flatMap((agent) =>
            agent.id ? [[agent.id, agent]] : [],
          ),
        ),
      );
      setUpdatedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const visibleSessions = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => {
      const record = [
        session.title,
        session.id,
        sessionWorkspace(session),
        sessionModelLine(session, agentsById),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return record.includes(query);
    });
  }, [agentsById, searchQuery, sessions]);

  React.useEffect(() => {
    setSelectedIndex((previous) =>
      Math.min(previous, Math.max(0, visibleSessions.length - 1)),
    );
  }, [visibleSessions.length]);

  const toggleSelectedPin = React.useCallback(async () => {
    const target = visibleSessions[selectedIndex];
    if (!target?.id) return;
    const pinned = !target.pinned;
    const response = await fetchAPI<{ success?: boolean }>(
      `/api/sessions/${encodeURIComponent(target.id)}/pin`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      },
    );
    if (response?.success === false) return;
    setSessions((current) =>
      current
        .map((session) =>
          session.id === target.id ? { ...session, pinned } : session,
        )
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            sessionTimestamp(b) - sessionTimestamp(a),
        ),
    );
  }, [fetchAPI, selectedIndex, visibleSessions]);

  const deleteSelectedSession = React.useCallback(async () => {
    const target = visibleSessions[selectedIndex];
    if (!target?.id) return;
    if (confirmDeleteId !== target.id) {
      setConfirmDeleteId(target.id);
      return;
    }
    await fetchAPI(`/api/sessions/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
    });
    setConfirmDeleteId(null);
    setSessions((current) =>
      current.filter((session) => session.id !== target.id),
    );
  }, [confirmDeleteId, fetchAPI, selectedIndex, visibleSessions]);

  useInput((input, key) => {
    if (openSession) return;
    if (confirmDeleteId) {
      if (key.escape) {
        setConfirmDeleteId(null);
        return;
      }
      if (input === "x") void deleteSelectedSession();
      return;
    }
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
        setSearchQuery((previous) => previous.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearchQuery((previous) => previous + input);
      }
      return;
    }
    if ((key.ctrl && input === "c") || key.escape || input === "q") {
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
    if (input === "n") {
      setOpenSession({ title: "New Chat" });
      return;
    }
    if (input === "r") {
      void load();
      return;
    }
    if (input === "p") {
      void toggleSelectedPin();
      return;
    }
    if (input === "x") {
      void deleteSelectedSession();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((previous) => Math.max(0, previous - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((previous) =>
        Math.min(Math.max(0, visibleSessions.length - 1), previous + 1),
      );
      return;
    }
    if (key.return) {
      const target = visibleSessions[selectedIndex];
      if (target?.id) setOpenSession(target);
    }
  }, TUI_INPUT_OPTIONS);

  if (openSession) {
    return (
      <InteractiveChatTUI
        apiBase={apiBase}
        apiKey={apiKey}
        fetchAPI={fetchAPI}
        initialAgentId={openSession.agent_id || openSession.agentId}
        sessionId={openSession.id}
        title={compactText(openSession.title, openSession.id || "New Chat")}
        modelLine={sessionModelLine(openSession, agentsById)}
        onExit={() => {
          setOpenSession(null);
          void load();
        }}
      />
    );
  }

  const activeCount = sessions.filter(sessionIsActive).length;
  const pendingCount = sessions.reduce(
    (total, session) => total + sessionPendingCount(session),
    0,
  );
  const availableSessionRows = Math.max(
    4,
    layout.rows - (layout.compact ? 18 : 22),
  );
  const visibleSessionCount = Math.min(
    visibleSessions.length,
    availableSessionRows,
  );
  const visibleSessionStart = Math.max(
    0,
    Math.min(
      visibleSessions.length - visibleSessionCount,
      selectedIndex - Math.floor(visibleSessionCount / 2),
    ),
  );
  const renderedSessions = visibleSessions.slice(
    visibleSessionStart,
    visibleSessionStart + visibleSessionCount,
  );

  return (
    <Box flexDirection="column" height={layout.rows} width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={layout.narrow ? 1 : 2}
        paddingY={1}
        flexGrow={1}
      >
        <Box
          flexDirection={layout.compact ? "column" : "row"}
          justifyContent="space-between"
        >
          <Text bold color="cyan">
            Cybara Chat
          </Text>
          <Text color="gray">
            {layout.compact
              ? "↑↓ select · ↵ open · n new · / search"
              : "↑↓ select · ↵ open · n new · / search · ? help"}
          </Text>
        </Box>
        <Text color="gray">
          Recent sessions · {visibleSessions.length}/{totalSessions} shown
          {activeCount > 0 ? ` · ${activeCount} running` : ""}
          {pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
          {loading && sessions.length > 0 ? " · refreshing" : ""}
        </Text>
        <Box marginTop={1}>
          <Text color={searchMode ? "cyan" : searchQuery ? "yellow" : "gray"}>
            Search: {searchQuery || (searchMode ? "type to filter" : "press /")}
            {searchMode ? "▏" : ""}
          </Text>
        </Box>
        {loading && sessions.length === 0 && (
          <Text color="yellow">
            <Spinner type="dots" /> Loading sessions
          </Text>
        )}
        {error && <Text color="red">Error: {error}</Text>}
        {!loading && !error && sessions.length === 0 && (
          <Text color="gray">No chat sessions yet.</Text>
        )}
        {!error && visibleSessionStart > 0 ? (
          <Text color="gray">↑ {visibleSessionStart} earlier</Text>
        ) : null}
        {!error &&
          renderedSessions.map((session, localIndex) => {
            const index = visibleSessionStart + localIndex;
            const pending = sessionPendingCount(session);
            const active = sessionIsActive(session);
            const workspace = sessionWorkspace(session);
            const selected = index === selectedIndex;
            const title = compactText(
              session.title,
              session.id || "Untitled chat",
              layout.compact
                ? Math.max(18, layout.columns - 26)
                : selected
                  ? 56
                  : 60,
            );
            const age = active
              ? "running"
              : formatRelativeTime(sessionTimestamp(session));
            if (!selected) {
              return (
                <Box
                  key={session.id || session.title}
                  justifyContent="space-between"
                >
                  <Text
                    color={
                      active ? "yellow" : session.pinned ? "cyan" : "white"
                    }
                  >
                    {"  "}
                    {session.pinned ? "★ " : ""}
                    {title}
                    {pending > 0 ? (
                      <Text color="yellow"> · {pending} queued</Text>
                    ) : null}
                  </Text>
                  <Text color={active ? "yellow" : "gray"}>{age}</Text>
                </Box>
              );
            }
            return (
              <Box
                key={session.id || session.title}
                flexDirection="column"
                marginTop={1}
                borderStyle="single"
                borderColor="cyan"
                paddingX={1}
              >
                <Box justifyContent="space-between">
                  <Text bold color="cyan">
                    ❯ {session.pinned ? "★ " : ""}
                    {title}
                  </Text>
                  <Text color={active ? "yellow" : "gray"}>{age}</Text>
                </Box>
                {layout.compact ? null : (
                  <Text color="gray">
                    {sessionRowMeta(session, agentsById)}
                  </Text>
                )}
                {layout.compact ? null : (
                  <Text color="gray">
                    {compactPath(workspace)}
                    {pending > 0 ? ` · ${pending} queued` : ""}
                  </Text>
                )}
                {session.id && !layout.compact ? (
                  <Text color="gray">
                    ↵ open · cybara chat --session {session.id}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        {!error &&
        visibleSessionStart + renderedSessions.length <
          visibleSessions.length ? (
          <Text color="gray">
            ↓{" "}
            {visibleSessions.length -
              visibleSessionStart -
              renderedSessions.length}{" "}
            more
          </Text>
        ) : null}
      </Box>
      {confirmDeleteId ? (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold color="red">
            Delete selected session?
          </Text>
          <Text>Press x again to delete permanently · Esc cancels</Text>
        </Box>
      ) : null}
      {showHelp ? (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold color="cyan">
            Keys and chat actions
          </Text>
          <Text>
            {layout.narrow
              ? "n new · p pin · x delete · r refresh"
              : "n new · p pin/unpin · x delete · / search · r refresh · Esc/q quit"}
          </Text>
          <Text>
            {layout.narrow
              ? "Enter send · ^J newline · PgUp/PgDn"
              : "Inside chat: Enter send · Ctrl+J newline · Tab complete · PgUp/PgDn transcript"}
          </Text>
        </Box>
      ) : null}
      {layout.compact ? null : (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">
            Start: n, or cybara chat --agent &lt;id&gt; --workspace &lt;path&gt;
          </Text>
          <Text color="gray">
            Queue/steer: use /queue and /steer inside chat, or cybara chat
            queue|steer
          </Text>
          <Text color="gray">
            Stop active run: /stop inside chat, or cybara chat stop
            &lt;session&gt;
          </Text>
          {updatedAt ? (
            <Text color="gray">
              Updated {formatRelativeTime(updatedAt)} ago
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
