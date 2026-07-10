import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";

export type TUIDataFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

const TUI_INPUT_OPTIONS = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode ===
      "function",
};

interface PanelState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function usePanelData<T>(loader: () => Promise<T | null>, errorMessage: string) {
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
    TUI_INPUT_OPTIONS
  );

  React.useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    void loader()
      .then((data) => {
        if (!active) return;
        setState({ data, loading: false, error: data === null ? errorMessage : null });
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

  return state;
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
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
        <Text bold color="cyan">
          {title}
        </Text>
        <Text color="gray">{detail}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
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
      <Box marginTop={1}>
        <Text color="gray">r refresh · q/esc back</Text>
      </Box>
    </Box>
  );
}

function compact(value: unknown, max = 34): string {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text || "-";
  return `${text.slice(0, Math.max(1, max - 1))}…`;
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

export function TUIUsageCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const loader = React.useCallback(() => fetchAPI<UsageResponse>("/api/provider-plans/status"), [fetchAPI]);
  const state = usePanelData(loader, "Failed to load provider usage");
  const providers = (state.data?.providers || []).filter(
    (provider) => provider.managedAutomatically && (provider.monitored || provider.windows?.length)
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
        providers.slice(0, 16).map((provider) => {
          const fiveHour = usageWindow(provider, "rolling_5h");
          const weekly = usageWindow(provider, "rolling_week");
          return (
            <Box key={provider.providerId}>
              <Box width={28}>
                <Text bold>{compact(provider.providerName, 26)}</Text>
              </Box>
              <Box width={13}>
                <Text color="gray">5h </Text>
                <Text color={usageColor(fiveHour)}>{fiveHour}</Text>
              </Box>
              <Box width={16}>
                <Text color="gray">Weekly </Text>
                <Text color={usageColor(weekly)}>{weekly}</Text>
              </Box>
              <Text color={provider.status === "ok" ? "green" : "gray"}>
                {provider.status || "unknown"}
              </Text>
            </Box>
          );
        })
      )}
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
  const loader = React.useCallback(() => fetchAPI<ChannelRow[]>("/api/channels"), [fetchAPI]);
  const state = usePanelData(loader, "Failed to load channels");
  const channels = Array.isArray(state.data) ? state.data : [];

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
        channels.slice(0, 18).map((channel) => (
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
  const loader = React.useCallback(
    async () => {
      const [status, memory] = await Promise.all([
        fetchAPI<MemoryStatus>("/api/memory/status"),
        fetchAPI<MemoryResponse>("/api/memory"),
      ]);
      return status || memory ? { status, memory } : null;
    },
    [fetchAPI]
  );
  const state = usePanelData<MemoryPanelData>(loader, "Failed to load memory");
  const entries = (state.data?.memory?.memories || [])
    .flatMap((file) => (file.entries || []).map((entry) => ({ ...entry, file: file.file || "memory" })))
    .slice(-10)
    .reverse();

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
        entries.map((entry, index) => (
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
              {entry.timestamp && <Text color="gray"> · {entry.timestamp}</Text>}
            </Box>
            <Text wrap="wrap">{compact(entry.content, 120)}</Text>
          </Box>
        ))
      )}
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
  const loader = React.useCallback(() => fetchAPI<ToolRow[]>("/api/tools"), [fetchAPI]);
  const state = usePanelData(loader, "Failed to load tools");
  const tools = Array.isArray(state.data) ? state.data : [];
  const categories = new Map<string, number>();
  for (const tool of tools) {
    const category = tool.category || "other";
    categories.set(category, (categories.get(category) || 0) + 1);
  }

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
      {tools.slice(0, 14).map((tool) => (
        <Box key={tool.name} flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold color="cyan">
              {compact(tool.name, 26)}
            </Text>
            <Text color="gray"> · {tool.category || "other"}</Text>
            {tool.permissions && tool.permissions.length > 0 && (
              <Text color="gray"> · {compact(tool.permissions.join(", "), 26)}</Text>
            )}
          </Box>
          <Text wrap="wrap">{compact(tool.description, 110)}</Text>
        </Box>
      ))}
    </PanelShell>
  );
}
