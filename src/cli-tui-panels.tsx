import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { useTerminalLayout } from "./cli-tui-terminal";

export type TUIDataFetch = <T>(
  endpoint: string,
  options?: RequestInit,
) => Promise<T | null>;

const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown })
      .setRawMode === "function",
};

interface PanelState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function usePanelData<T>(
  loader: () => Promise<T | null>,
  errorMessage: string,
  shortcutsActive = true,
) {
  const { exit } = useApp();
  const [revision, setRevision] = React.useState(0);
  const [state, setState] = React.useState<PanelState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useInput(
    (input, key) => {
      if ((key.ctrl && input === "c") || input === "q" || key.escape) exit();
      if (input === "r") setRevision((value) => value + 1);
    },
    { isActive: TUI_INPUT_OPTIONS.isActive && shortcutsActive },
  );

  React.useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    void loader()
      .then((data) => {
        if (!active) return;
        setState({
          data,
          loading: false,
          error: data === null ? errorMessage : null,
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState({
          data: null,
          loading: false,
          error: cause instanceof Error ? cause.message : errorMessage,
        });
      });
    return () => {
      active = false;
    };
  }, [errorMessage, loader, revision]);

  const refresh = React.useCallback(() => setRevision((value) => value + 1), []);
  return { ...state, refresh };
}

function PanelShell({
  title,
  detail,
  loading,
  error,
  children,
}: {
  title: string;
  detail: string;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  const layout = useTerminalLayout();
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={layout.narrow ? 1 : 2}
      height={layout.rows}
      width="100%"
    >
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="cyan">
          {title}
        </Text>
        <Text color="#9ca6b4">{detail}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {loading ? (
          <Text color="yellow">
            <Spinner type="dots" /> Loading...
          </Text>
        ) : error ? (
          <Text color="red">✗ {error}</Text>
        ) : (
          children
        )}
      </Box>
      <Box paddingBottom={1}>
        <Text color="#9ca6b4">r refresh · q/esc back</Text>
      </Box>
    </Box>
  );
}

function compact(value: unknown, max = 34): string {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text || "-";
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function panelListLimit(
  total: number,
  layout: ReturnType<typeof useTerminalLayout>,
  rowHeight: number,
): number {
  const capacity = Math.max(1, Math.floor((layout.rows - 7) / rowHeight));
  return total > capacity ? Math.max(1, capacity - 1) : capacity;
}

function PanelRemainder({
  total,
  shown,
}: {
  total: number;
  shown: number;
}): React.ReactElement | null {
  const remaining = total - shown;
  return remaining > 0 ? <Text color="#9ca6b4">↓ {remaining} more</Text> : null;
}

interface UsageWindow {
  kind?: string;
  usedPercent?: number;
  usageKnown?: boolean;
  unlimited?: boolean;
  resetsAt?: string;
}

interface UsageProvider {
  providerId: string;
  providerName: string;
  managedAutomatically?: boolean;
  monitored?: boolean;
  status?: string;
  windows?: UsageWindow[];
}

interface UsageResponse {
  providers?: UsageProvider[];
}

function usageWindow(provider: UsageProvider, kind: string): string {
  const window = provider.windows?.find((entry) => entry.kind === kind);
  if (!window || window.usageKnown === false) return "--";
  if (window.unlimited) return "∞";
  if (typeof window.usedPercent !== "number") return "--";
  return `${Math.round(Math.max(0, Math.min(100, window.usedPercent)))}%`;
}

function usageColor(value: string): string {
  if (value === "∞") return "green";
  const percent = Number.parseInt(value, 10);
  if (!Number.isFinite(percent)) return "gray";
  if (percent >= 95) return "red";
  if (percent >= 80) return "yellow";
  if (percent >= 60) return "blue";
  return "green";
}

function UsageMeter({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  const percent = Number.parseInt(value, 10);
  const filled = Number.isFinite(percent)
    ? Math.round(Math.max(0, Math.min(100, percent)) / 12.5)
    : 0;
  const meter =
    value === "∞" ? "────────" : "■".repeat(filled) + "·".repeat(8 - filled);
  return (
    <Text>
      <Text color="gray">{label} </Text>
      <Text color={usageColor(value)}>{meter}</Text>
      <Text color={usageColor(value)}> {value.padStart(3)}</Text>
    </Text>
  );
}

export function TUIUsageCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<UsageResponse>("/api/provider-plans/status"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load provider usage");
  const providers = (state.data?.providers || []).filter(
    (provider) =>
      provider.managedAutomatically &&
      (provider.monitored || provider.windows?.length),
  );
  const visibleProviders = providers.slice(
    0,
    panelListLimit(providers.length, layout, layout.narrow ? 4 : 1),
  );

  return (
    <PanelShell
      title="Provider Usage"
      detail="Automatic coding-plan windows from configured OAuth providers"
      loading={state.loading}
      error={state.error}
    >
      {providers.length === 0 ? (
        <Text color="gray">No automatic provider plan usage is available.</Text>
      ) : (
        visibleProviders.map((provider) => {
          const fiveHour = usageWindow(provider, "rolling_5h");
          const weekly = usageWindow(provider, "rolling_week");
          return (
            <Box
              key={provider.providerId}
              flexDirection={layout.narrow ? "column" : "row"}
              marginBottom={layout.narrow ? 1 : 0}
            >
              <Box width={layout.narrow ? undefined : 28}>
                <Text bold>
                  {compact(provider.providerName, layout.narrow ? 38 : 26)}
                </Text>
              </Box>
              <Box width={layout.narrow ? undefined : 19}>
                <UsageMeter label="5h" value={fiveHour} />
              </Box>
              <Box width={layout.narrow ? undefined : 23}>
                <UsageMeter label="Week" value={weekly} />
              </Box>
              {!layout.narrow ? (
                <Text color={provider.status === "ok" ? "green" : "gray"}>
                  {provider.status || "unknown"}
                </Text>
              ) : null}
            </Box>
          );
        })
      )}
      <PanelRemainder
        total={providers.length}
        shown={visibleProviders.length}
      />
    </PanelShell>
  );
}

interface ChannelRow {
  id: string;
  name: string;
  type: string;
  enabled?: boolean | number;
  config?: { dm_policy?: string; default_agent_id?: string };
}

export function TUIChannelsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<ChannelRow[]>("/api/channels"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load channels");
  const channels = Array.isArray(state.data) ? state.data : [];
  const visibleChannels = channels.slice(
    0,
    panelListLimit(channels.length, layout, 1),
  );

  return (
    <PanelShell
      title={`Channels (${channels.length})`}
      detail="Connection state, DM access policy, and default agent routing"
      loading={state.loading}
      error={state.error}
    >
      {channels.length === 0 ? (
        <Text color="gray">No channels configured.</Text>
      ) : (
        visibleChannels.map((channel) => (
          <Box key={channel.id}>
            <Box width={20}>
              <Text bold>{compact(channel.name, 18)}</Text>
            </Box>
            <Box width={13}>
              <Text color="gray">{compact(channel.type, 11)}</Text>
            </Box>
            <Box width={10}>
              <Text color={channel.enabled ? "green" : "yellow"}>
                {channel.enabled ? "enabled" : "disabled"}
              </Text>
            </Box>
            <Box width={12}>
              <Text>{channel.config?.dm_policy || "pairing"}</Text>
            </Box>
            <Text color="gray">
              {channel.config?.default_agent_id
                ? compact(channel.config.default_agent_id, 16)
                : "gateway default"}
            </Text>
          </Box>
        ))
      )}
      <PanelRemainder total={channels.length} shown={visibleChannels.length} />
    </PanelShell>
  );
}

interface MemoryStatus {
  chunks?: number;
  files?: number;
  provider?: string;
  model?: string;
}

interface MemoryEntry {
  content?: string;
  timestamp?: string;
  date?: string;
  type?: string;
}

interface MemoryFile {
  file?: string;
  entries?: MemoryEntry[];
}

interface MemoryResponse {
  memories?: MemoryFile[];
}

interface MemoryPanelData {
  status: MemoryStatus | null;
  memory: MemoryResponse | null;
}

export function TUIMemoryCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(async () => {
    const [status, memory] = await Promise.all([
      fetchAPI<MemoryStatus>("/api/memory/status"),
      fetchAPI<MemoryResponse>("/api/memory"),
    ]);
    return status || memory ? { status, memory } : null;
  }, [fetchAPI]);
  const state = usePanelData<MemoryPanelData>(loader, "Failed to load memory");
  const entries = (state.data?.memory?.memories || [])
    .flatMap((file) =>
      (file.entries || []).map((entry) => ({
        ...entry,
        file: file.file || "memory",
      })),
    )
    .reverse();
  const visibleEntries = entries.slice(
    0,
    panelListLimit(entries.length, layout, 3),
  );

  return (
    <PanelShell
      title="Memory"
      detail={`${state.data?.status?.files ?? 0} files · ${state.data?.status?.chunks ?? 0} indexed chunks · ${state.data?.status?.provider || "local"}`}
      loading={state.loading}
      error={state.error}
    >
      {entries.length === 0 ? (
        <Text color="gray">No recent memory entries.</Text>
      ) : (
        visibleEntries.map((entry, index) => (
          <Box
            key={`${entry.file}-${entry.timestamp || index}`}
            flexDirection="column"
            marginBottom={1}
          >
            <Box>
              <Text bold color="cyan">
                {compact(entry.file, 30)}
              </Text>
              <Text color="gray"> · {entry.type || "note"}</Text>
              {entry.timestamp && (
                <Text color="gray"> · {entry.timestamp}</Text>
              )}
            </Box>
            <Text wrap="wrap">{compact(entry.content, 120)}</Text>
          </Box>
        ))
      )}
      <PanelRemainder total={entries.length} shown={visibleEntries.length} />
    </PanelShell>
  );
}

interface ToolRow {
  name: string;
  description?: string;
  category?: string;
  permissions?: string[];
}

export function TUIToolsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<ToolRow[]>("/api/tools"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load tools");
  const tools = Array.isArray(state.data) ? state.data : [];
  const categories = new Map<string, number>();
  for (const tool of tools) {
    const category = tool.category || "other";
    categories.set(category, (categories.get(category) || 0) + 1);
  }
  const visibleTools = tools.slice(0, panelListLimit(tools.length, layout, 3));

  return (
    <PanelShell
      title={`Tools (${tools.length})`}
      detail={Array.from(categories.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => `${category} ${count}`)
        .join(" · ")}
      loading={state.loading}
      error={state.error}
    >
      {visibleTools.map((tool) => (
        <Box key={tool.name} flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold color="cyan">
              {compact(tool.name, 26)}
            </Text>
            <Text color="gray"> · {tool.category || "other"}</Text>
            {tool.permissions && tool.permissions.length > 0 && (
              <Text color="gray">
                {" "}
                · {compact(tool.permissions.join(", "), 26)}
              </Text>
            )}
          </Box>
          <Text wrap="wrap">{compact(tool.description, 110)}</Text>
        </Box>
      ))}
      <PanelRemainder total={tools.length} shown={visibleTools.length} />
    </PanelShell>
  );
}

interface McpRow {
  id: string;
  name?: string;
  status?: string;
  toolCount?: number;
  command?: string;
  url?: string;
  transport?: "stdio" | "http";
}

interface RemoteMcpEditor {
  field: "name" | "url";
  name: string;
  value: string;
}

function mcpNeedsOAuth(error: string | undefined): boolean {
  return /\b401\b|unauthori[sz]ed|authentication required/i.test(error || "");
}

export function TUIMcpCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const [editor, setEditor] = React.useState<RemoteMcpEditor | null>(null);
  const [action, setAction] = React.useState<string | null>(null);
  const loader = React.useCallback(
    () => fetchAPI<McpRow[]>("/api/mcp"),
    [fetchAPI],
  );
  const state = usePanelData(
    loader,
    "Failed to load MCP services",
    editor === null,
  );
  const services = Array.isArray(state.data) ? state.data : [];
  const running = services.filter(
    (service) => service.status === "running",
  ).length;
  const visibleServices = services.slice(
    0,
    panelListLimit(services.length, layout, layout.narrow ? 4 : 3),
  );

  const submitRemote = React.useCallback(
    async (name: string, url: string) => {
      setAction("Connecting remote MCP server...");
      try {
        const created = await fetchAPI<McpRow>("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, url, enabled: true }),
        });
        if (!created?.id) throw new Error("Failed to add remote MCP server");
        const started = await fetchAPI<{ success?: boolean; error?: string }>(
          `/api/mcp/${encodeURIComponent(created.id)}/start`,
          { method: "POST" },
        );
        if (started?.success) {
          setAction("Remote MCP server connected.");
        } else if (mcpNeedsOAuth(started?.error)) {
          const authorization = await fetchAPI<{
            success?: boolean;
            authUrl?: string;
            error?: string;
          }>(`/api/mcp/${encodeURIComponent(created.id)}/oauth/start`, {
            method: "POST",
          });
          setAction(
            authorization?.authUrl
              ? `Authorize in browser: ${authorization.authUrl}`
              : authorization?.error || "Authorization unavailable.",
          );
        } else {
          setAction(started?.error || "Remote MCP server saved.");
        }
        setEditor(null);
        state.refresh();
      } catch (error) {
        setAction(
          error instanceof Error
            ? error.message
            : "Failed to add remote MCP server",
        );
      }
    },
    [fetchAPI, state.refresh],
  );

  useInput(
    (input, key) => {
      if (!editor) {
        if (input === "a") {
          setAction(null);
          setEditor({ field: "name", name: "", value: "" });
        }
        return;
      }
      if (key.escape) {
        setEditor(null);
        return;
      }
      if (key.backspace || key.delete) {
        setEditor((current) =>
          current ? { ...current, value: current.value.slice(0, -1) } : null,
        );
        return;
      }
      if (key.return) {
        const value = editor.value.trim();
        if (!value) return;
        if (editor.field === "name") {
          setEditor({ field: "url", name: value, value: "https://" });
        } else {
          void submitRemote(editor.name, value);
        }
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditor((current) =>
          current ? { ...current, value: current.value + input } : null,
        );
      }
    },
    TUI_INPUT_OPTIONS,
  );

  return (
    <PanelShell
      title={`MCP Services (${services.length})`}
      detail={`${running} running · ${services.reduce((total, service) => total + (service.toolCount || 0), 0)} tools`}
      loading={state.loading}
      error={state.error}
    >
      {editor ? (
        <Box flexDirection="column">
          <Text bold color="cyan">
            Add remote HTTPS server
          </Text>
          <Text color="#9ca6b4">
            {editor.field === "name" ? "Name" : "URL"}
          </Text>
          <Text>› {editor.value}▏</Text>
          <Text color="#9ca6b4">Enter continue · Esc cancel</Text>
        </Box>
      ) : services.length === 0 ? (
        <Text color="gray">No MCP services configured.</Text>
      ) : (
        visibleServices.map((service) => (
          <Box key={service.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection={layout.narrow ? "column" : "row"}>
              <Box width={layout.narrow ? undefined : 28}>
                <Text bold>{compact(service.name || service.id, 26)}</Text>
              </Box>
              <Box width={layout.narrow ? undefined : 12}>
                <Text color={service.status === "running" ? "green" : "gray"}>
                  {service.status || "stopped"}
                </Text>
              </Box>
              <Text color="cyan">{service.toolCount || 0} tools</Text>
            </Box>
            {service.url || service.command ? (
              <Text color="gray">
                {compact(service.url || service.command, 76)}
              </Text>
            ) : null}
          </Box>
        ))
      )}
      {editor ? null : (
        <PanelRemainder
          total={services.length}
          shown={visibleServices.length}
        />
      )}
      {editor ? null : (
        <Text color="#9ca6b4">a add remote HTTPS server</Text>
      )}
      {action ? <Text color="#9ca6b4">{action}</Text> : null}
    </PanelShell>
  );
}

interface LspRow {
  language: string;
  displayName?: string;
  type?: string;
  installed?: boolean;
  available?: boolean;
  path?: string | null;
  requiresRuntime?: string;
}

interface LspResponse {
  status?: LspRow[];
}

export function TUILspCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<LspResponse>("/api/lsp/install-status"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load language servers");
  const languages = state.data?.status || [];
  const ready = languages.filter(
    (language) => language.installed || language.available,
  ).length;
  const visibleLanguages = languages.slice(
    0,
    panelListLimit(languages.length, layout, layout.narrow ? 4 : 3),
  );

  return (
    <PanelShell
      title={`Language Servers (${ready}/${languages.length} ready)`}
      detail="Bundled servers and optional language tooling available to the IDE"
      loading={state.loading}
      error={state.error}
    >
      {languages.length === 0 ? (
        <Text color="gray">No language server definitions returned.</Text>
      ) : (
        visibleLanguages.map((language) => {
          const available = language.installed || language.available;
          return (
            <Box
              key={language.language}
              flexDirection="column"
              marginBottom={1}
            >
              <Box flexDirection={layout.narrow ? "column" : "row"}>
                <Box width={layout.narrow ? undefined : 24}>
                  <Text bold>
                    {compact(language.displayName || language.language, 22)}
                  </Text>
                </Box>
                <Box width={layout.narrow ? undefined : 14}>
                  <Text color={available ? "green" : "yellow"}>
                    {available ? "ready" : "not installed"}
                  </Text>
                </Box>
                <Text color="gray">{language.type || "binary"}</Text>
              </Box>
              <Text color="gray">
                {language.path
                  ? compact(language.path, 76)
                  : language.requiresRuntime
                    ? `Requires ${language.requiresRuntime}`
                    : `Install with cybara lsp install ${language.language}`}
              </Text>
            </Box>
          );
        })
      )}
      <PanelRemainder
        total={languages.length}
        shown={visibleLanguages.length}
      />
    </PanelShell>
  );
}

interface SubagentRow {
  runId?: string;
  id?: string;
  label?: string;
  task?: string;
  model?: string;
  status?: string;
}

export function TUISubagentsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<SubagentRow[]>("/api/subagents"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load subagents");
  const runs = Array.isArray(state.data) ? state.data : [];
  const active = runs.filter((run) => run.status === "running").length;
  const visibleRuns = runs.slice(
    0,
    panelListLimit(runs.length, layout, layout.narrow ? 4 : 3),
  );

  return (
    <PanelShell
      title={`Subagents (${runs.length})`}
      detail={`${active} active · delegated work across agent sessions`}
      loading={state.loading}
      error={state.error}
    >
      {runs.length === 0 ? (
        <Text color="gray">No subagent runs recorded.</Text>
      ) : (
        visibleRuns.map((run, index) => (
          <Box
            key={run.runId || run.id || index}
            flexDirection="column"
            marginBottom={1}
          >
            <Box flexDirection={layout.narrow ? "column" : "row"}>
              <Box width={layout.narrow ? undefined : 28}>
                <Text bold>
                  {compact(run.label || run.task || run.runId || run.id, 26)}
                </Text>
              </Box>
              <Box width={layout.narrow ? undefined : 12}>
                <Text
                  color={
                    run.status === "running"
                      ? "yellow"
                      : run.status === "ok"
                        ? "green"
                        : "gray"
                  }
                >
                  {run.status || "unknown"}
                </Text>
              </Box>
              <Text color="gray">{compact(run.model, 24)}</Text>
            </Box>
            {run.task ? (
              <Text color="gray">{compact(run.task, 88)}</Text>
            ) : null}
          </Box>
        ))
      )}
      <PanelRemainder total={runs.length} shown={visibleRuns.length} />
    </PanelShell>
  );
}

interface ArtifactRow {
  sessionId: string;
  name: string;
  title?: string;
  kind?: string;
  size?: number;
}

interface ArtifactResponse {
  artifacts?: ArtifactRow[];
}

function formatBytes(value = 0): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function TUIArtifactsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<ArtifactResponse>("/api/artifacts"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load artifacts");
  const artifacts = state.data?.artifacts || [];
  const visibleArtifacts = artifacts.slice(
    0,
    panelListLimit(artifacts.length, layout, layout.narrow ? 3 : 1),
  );

  return (
    <PanelShell
      title={`Artifacts (${artifacts.length})`}
      detail="Persistent deliverables produced by agent sessions"
      loading={state.loading}
      error={state.error}
    >
      {artifacts.length === 0 ? (
        <Text color="gray">No artifacts created yet.</Text>
      ) : (
        visibleArtifacts.map((artifact) => (
          <Box
            key={`${artifact.sessionId}:${artifact.name}`}
            flexDirection={layout.narrow ? "column" : "row"}
            marginBottom={layout.narrow ? 1 : 0}
          >
            <Box width={layout.narrow ? undefined : 30}>
              <Text bold>{compact(artifact.title || artifact.name, 28)}</Text>
            </Box>
            <Box width={layout.narrow ? undefined : 16}>
              <Text color="cyan">{artifact.kind || "custom"}</Text>
            </Box>
            <Box width={layout.narrow ? undefined : 12}>
              <Text color="gray">{formatBytes(artifact.size)}</Text>
            </Box>
            <Text color="gray">{compact(artifact.sessionId, 18)}</Text>
          </Box>
        ))
      )}
      <PanelRemainder
        total={artifacts.length}
        shown={visibleArtifacts.length}
      />
    </PanelShell>
  );
}

interface JourneyEvent {
  id: string;
  kind: "skill" | "memory";
  title: string;
  detail?: string;
}

interface JourneyResponse {
  events?: JourneyEvent[];
  counts?: { skills?: number; memories?: number; total?: number };
}

export function TUIJourneyCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<JourneyResponse>("/api/journey"),
    [fetchAPI],
  );
  const state = usePanelData(loader, "Failed to load journey");
  const events = state.data?.events || [];
  const counts = state.data?.counts;
  const visibleEvents = events.slice(
    0,
    panelListLimit(events.length, layout, layout.narrow ? 4 : 3),
  );

  return (
    <PanelShell
      title="Journey"
      detail={`${counts?.skills || 0} skills · ${counts?.memories || 0} memories · ${counts?.total || events.length} total`}
      loading={state.loading}
      error={state.error}
    >
      {events.length === 0 ? (
        <Text color="gray">No learned skills or memories recorded yet.</Text>
      ) : (
        visibleEvents.map((event) => (
          <Box key={event.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection={layout.narrow ? "column" : "row"}>
              <Box width={layout.narrow ? undefined : 12}>
                <Text color={event.kind === "skill" ? "cyan" : "magenta"}>
                  {event.kind}
                </Text>
              </Box>
              <Text bold>{compact(event.title, 64)}</Text>
            </Box>
            {event.detail ? (
              <Text color="gray">{compact(event.detail, 92)}</Text>
            ) : null}
          </Box>
        ))
      )}
      <PanelRemainder total={events.length} shown={visibleEvents.length} />
    </PanelShell>
  );
}
