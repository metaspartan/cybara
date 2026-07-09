import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";

const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode === "function",
};

export type TUIFetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

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
  if (value && typeof value === "object" && Array.isArray((value as { sessions?: unknown }).sessions)) {
    return (value as { sessions: ChatSessionSummary[] }).sessions;
  }
  return [];
}

function agentsFromResponse(value: unknown): ChatAgentSummary[] {
  if (Array.isArray(value)) return value as ChatAgentSummary[];
  if (value && typeof value === "object" && Array.isArray((value as { agents?: unknown }).agents)) {
    return (value as { agents: ChatAgentSummary[] }).agents;
  }
  return [];
}

function sessionTimestamp(session: ChatSessionSummary): number {
  const value = session.updated_at || session.updatedAt || session.created_at || session.createdAt || "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionStatus(session: ChatSessionSummary): string {
  return String(session.status || "idle").toLowerCase();
}

function sessionIsActive(session: ChatSessionSummary): boolean {
  return ["thinking", "generating", "compacting", "tool_executing"].includes(sessionStatus(session));
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

function compactText(value: string | undefined, fallback: string, max = 44): string {
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
  agentsById: Map<string, ChatAgentSummary>
): ChatAgentSummary | undefined {
  const id = session.agent_id || session.agentId;
  return id ? agentsById.get(id) : undefined;
}

function sessionModelLine(
  session: ChatSessionSummary,
  agentsById: Map<string, ChatAgentSummary>
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
  agentsById: Map<string, ChatAgentSummary>
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

export function TUIChatCommand({ fetchAPI }: { fetchAPI: TUIFetchAPI }) {
  const { exit } = useApp();
  const [sessions, setSessions] = React.useState<ChatSessionSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [agentsById, setAgentsById] = React.useState<Map<string, ChatAgentSummary>>(
    () => new Map()
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, agentResponse] = await Promise.all([
        fetchAPI<unknown>("/api/sessions"),
        fetchAPI<unknown>("/api/agents"),
      ]);
      const nextSessions = sessionsFromResponse(response)
        .slice()
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || sessionTimestamp(b) - sessionTimestamp(a));
      setSessions(nextSessions.slice(0, 12));
      setAgentsById(new Map(agentsFromResponse(agentResponse).flatMap((agent) => (agent.id ? [[agent.id, agent]] : []))));
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

  useInput(
    (input, key) => {
      if (input === "q" || key.escape || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (input === "r") void load();
    },
    TUI_INPUT_OPTIONS
  );

  const activeCount = sessions.filter(sessionIsActive).length;
  const pendingCount = sessions.reduce((total, session) => total + sessionPendingCount(session), 0);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Box justifyContent="space-between">
          <Text bold>Chat</Text>
          <Text color="gray">r refresh</Text>
        </Box>
        <Text color="gray">
          Recent sessions · {sessions.length} shown
          {activeCount > 0 ? ` · ${activeCount} running` : ""}
          {pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
        </Text>
        {loading && (
          <Text color="yellow">
            <Spinner type="dots" /> Loading sessions
          </Text>
        )}
        {error && <Text color="red">Error: {error}</Text>}
        {!loading && !error && sessions.length === 0 && <Text color="gray">No chat sessions yet.</Text>}
        {!loading &&
          !error &&
          sessions.map((session) => {
            const pending = sessionPendingCount(session);
            const active = sessionIsActive(session);
            const workspace = sessionWorkspace(session);
            return (
              <Box key={session.id || session.title} flexDirection="column" marginTop={1}>
                <Box justifyContent="space-between">
                  <Text color={active ? "yellow" : session.pinned ? "cyan" : "white"}>
                    {session.pinned ? "★ " : ""}
                    {compactText(session.title, session.id || "Untitled chat")}
                  </Text>
                  <Text color={active ? "yellow" : "gray"}>
                    {active ? "running" : formatRelativeTime(sessionTimestamp(session))}
                  </Text>
                </Box>
                <Text color="gray">
                  {sessionRowMeta(session, agentsById)}
                </Text>
                <Text color="gray">{compactPath(workspace)}</Text>
                {session.id ? (
                  <Text color="gray">
                    cybara chat --session {session.id}
                    {pending > 0 ? ` · cybara chat steer ${session.id} #1` : ""}
                  </Text>
                ) : null}
              </Box>
            );
          })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">Start: cybara chat --agent &lt;id&gt; --workspace &lt;path&gt;</Text>
        <Text color="gray">Queue: cybara chat queue &lt;session&gt; "follow-up"</Text>
        <Text color="gray">Steer/Edit/Delete/Reorder: cybara chat steer|edit|delete|reorder &lt;session&gt; ...</Text>
        <Text color="gray">Stop active run: cybara chat stop &lt;session&gt;</Text>
        {updatedAt ? <Text color="gray">Updated {formatRelativeTime(updatedAt)} ago</Text> : null}
      </Box>
    </Box>
  );
}
