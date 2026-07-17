import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  checkForUpdateInBackground,
  isUpdateCheckDisabled,
} from "../../../core/update-check";
import {
  type AvailableProviderInfo,
} from "../../commands/provider-commands";
import { connectCliProviderOAuth } from "../../commands/provider-oauth";
import {
  CLI_API_BASE,
  fetchCliAPI,
  formatCliApiError,
  resolveCliApiKey,
  resolveCliGatewayPassword,
  TUI_INPUT_OPTIONS,
  withCliAuthHeaders,
} from "../../client";
import {
  type AgentItem,
  type LogEntry,
  type SessionInfo,
  type SkillItem,
  type TaskItem,
  sessionAgentLabel,
  sessionMessageCount,
  sessionUpdatedAt,
} from "../../contracts";
import { TUIPluginsCommand } from "./connectors";
import { TUIChatCommand } from "./chat";
import { MainMenu, type MainMenuAction } from "./menu";
import {
  TUIArtifactsCommand,
  TUIChannelsCommand,
  TUIJourneyCommand,
  TUILspCommand,
  TUIMcpCommand,
  TUIMemoryCommand,
  TUISubagentsCommand,
  TUIToolsCommand,
  TUIUsageCommand,
} from "./panels";
import { TUIEvalsCommand } from "./evals";
import { TUIBackupsCommand } from "./system-backup";
import { TUIBackProvider, useTUIBack } from "./navigation";
import {
  TUIBrowserCommand,
  TUIWalletCommand,
} from "./operations-panels";
import {
  TUIErrorState as ErrorState,
  TUILoadingState as LoadingState,
  TUILogo as Logo,
  TUIStatusBadge as StatusBadge,
  TUITable as Table,
} from "./primitives";
import {
  TUIMetricsCommand,
  TUIStatusCommand,
} from "./system-panels";
import { TUISettingsCommand } from "./settings";
import {
  terminalSelectionWindow,
  useTerminalLayout,
  useTerminalScreen,
} from "../terminal";
import { openUrlInBrowser } from "../../../core/runtime/open-url";
import { startGatewayBackground } from "../../gateway-process";
import {
  loadTUIProviderPanelDetails,
  loadTUIProviders,
  type TUIProviderPanelData,
  type TUIProviderPlanSnapshot,
} from "../provider-panel-data";

const API_BASE = CLI_API_BASE;
const fetchAPI = fetchCliAPI;

const TUISkillsCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<SkillItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    fetchAPI<{ skills: SkillItem[] }>("/api/skills/status")
      .then((d) => {
        if (d) setData(d.skills || []);
        else setError("Failed to fetch skills");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching skills..." />;
  if (error) return <ErrorState message={error} />;

  const eligible = data.filter((s) => s.eligible).length;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Skills ({eligible}/{data.length} eligible)
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No skills installed</Text>
      ) : (
        <Table
          headers={["Name", "Status", "Source"]}
          rows={data.map((s) => [
            s.name,
            <StatusBadge
              key={s.name}
              status={s.eligible ? "eligible" : "blocked"}
            />,
            s.source,
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUIAgentsCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<AgentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    fetchAPI<AgentItem[]>("/api/agents/summary")
      .then((d) => {
        if (d) setData(Array.isArray(d) ? d : []);
        else setError("Failed to fetch agents");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching agents..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Agents ({data.length})
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No agents configured</Text>
      ) : (
        <Table
          headers={["Name", "Type", "Status", "Model"]}
          rows={data.map((a) => [
            a.name,
            a.type,
            <StatusBadge key={a.id} status={a.status} />,
            a.model || "-",
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUITasksCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<TaskItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    fetchAPI<TaskItem[]>("/api/tasks")
      .then((d) => {
        if (d) setData(Array.isArray(d) ? d : []);
        else setError("Failed to fetch tasks");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching tasks..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Scheduled Tasks ({data.length})
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No tasks scheduled</Text>
      ) : (
        <Table
          headers={["Name", "Status", "Schedule", "Chat"]}
          rows={data.map((t) => [
            t.name,
            <StatusBadge key={t.id} status={t.status} />,
            t.schedule || "-",
            t.session_id ? t.session_id.slice(0, 8) : "New chat",
          ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

interface TUIRouterRoute {
  providerId: string;
  weight: number;
  enabled: boolean;
  available: boolean;
  reason?: string;
  requestsIn5hWindow?: number;
  requestsInWeekWindow?: number;
  spendToday?: number;
  spendThisWeek?: number;
  priceInputPerM?: number;
  priceOutputPerM?: number;
}

interface TUIRouterStatus {
  enabled: boolean;
  strategy: string;
  globalSpendToday?: number;
  globalSpendLimitDaily?: number;
  totalRequests?: number;
  routes: TUIRouterRoute[];
}

interface TUIMobileDevice {
  id: string;
  name: string;
  baseUrl: string;
  status: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

function truncateText(value: unknown, max = 28): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatRelativeTime(value?: string): string {
  if (!value) return "-";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "-";
  const diff = Math.max(0, Date.now() - time);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < month) return `${Math.floor(diff / day)}d`;
  return `${Math.floor(diff / month)}mo`;
}

function usageTone(percent: number | null, unlimited = false): string {
  if (unlimited) return "green";
  if (percent === null) return "gray";
  if (percent < 40) return "green";
  if (percent < 65) return "blue";
  if (percent < 80) return "yellow";
  if (percent < 95) return "magenta";
  return "red";
}

function formatPlanReset(resetsAt?: string): string {
  if (!resetsAt) return "";
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return "";
  const diff = resetMs - Date.now();
  if (diff <= 0) return " reset ready";
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return ` resets ${Math.max(1, Math.ceil(diff / minute))}m`;
  if (diff < day) return ` resets ${Math.ceil(diff / hour)}h`;
  return ` resets ${Math.ceil(diff / day)}d`;
}

const UsageBar = ({
  percent,
  unlimited = false,
  width = 14,
}: {
  percent: number | null;
  unlimited?: boolean;
  width?: number;
}) => {
  if (unlimited) return <Text color="green">∞ unlimited</Text>;
  if (percent === null) return <Text color="gray">--</Text>;
  const bounded = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.max(
    0,
    Math.min(width, Math.round((bounded / 100) * width)),
  );
  return (
    <Text color={usageTone(bounded)}>
      {"["}
      {"#".repeat(filled)}
      {"-".repeat(width - filled)}
      {"] "}
      {bounded}%
    </Text>
  );
};

function planWindow(
  plan: TUIProviderPlanSnapshot | undefined,
  kind: "rolling_5h" | "rolling_week",
): { percent: number | null; unlimited: boolean; reset: string } {
  const window = plan?.windows?.find(
    (entry) =>
      entry.kind === kind &&
      entry.usageKnown !== false &&
      (entry.unlimited || typeof entry.usedPercent === "number"),
  );
  if (!window) return { percent: null, unlimited: false, reset: "" };
  return {
    percent: typeof window.usedPercent === "number" ? window.usedPercent : null,
    unlimited: window.unlimited === true,
    reset: formatPlanReset(window.resetsAt),
  };
}

const TUIProvidersCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<TUIProviderPanelData>({
    providers: [],
    pools: [],
    plans: null,
    warnings: [],
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const requestGeneration = React.useRef(0);

  const load = React.useCallback(async (): Promise<void> => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setLoading(true);
    setError(null);
    try {
      const providers = await loadTUIProviders();
      if (requestGeneration.current !== generation) return;
      setData({ providers, pools: [], plans: null, warnings: [] });
      setLoading(false);
      const details = await loadTUIProviderPanelDetails();
      if (requestGeneration.current !== generation) return;
      setData({ providers, ...details });
    } catch (cause) {
      if (requestGeneration.current !== generation) return;
      setError(formatCliApiError(cause));
      setLoading(false);
    }
  }, []);

  useInput((input) => {
    if (input === "q") exit();
    if (input === "r") void load();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  if (loading) return <LoadingState message="Fetching providers..." />;
  if (error) {
    return (
      <Box flexDirection="column">
        <Logo compact />
        <ErrorState message={error} />
        <Text color="gray">Press r to retry · q to return</Text>
      </Box>
    );
  }

  const { plans, pools, providers, warnings } = data;

  const planByKey = new Map<string, TUIProviderPlanSnapshot>();
  for (const plan of plans?.providers || []) {
    for (const key of [
      plan.providerId,
      plan.configuredProviderId,
      plan.providerType,
    ]) {
      if (key && !planByKey.has(key)) planByKey.set(key, plan);
    }
  }

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1} flexDirection="column">
        <Text bold color="cyan">
          Providers ({providers.length})
        </Text>
        <Text color="gray">
          Default, auth type, and live coding-plan limits where available.
        </Text>
      </Box>
      {providers.length === 0 ? (
        <Text color="gray">No providers configured</Text>
      ) : (
        <Box flexDirection="column">
          {providers.slice(0, 12).map((provider) => {
            const plan =
              planByKey.get(provider.id) || planByKey.get(provider.provider);
            const fiveHour = planWindow(plan, "rolling_5h");
            const weekly = planWindow(plan, "rolling_week");
            return (
              <Box key={provider.id} flexDirection="column" marginBottom={1}>
                <Box>
                  <Box width={28}>
                    <Text bold>{truncateText(provider.name, 26)}</Text>
                  </Box>
                  <Box width={18}>
                    <Text color="gray">
                      {truncateText(provider.provider, 16)}
                    </Text>
                  </Box>
                  <Box width={10}>
                    <Text color={provider.is_default ? "green" : "gray"}>
                      {provider.is_default ? "default" : ""}
                    </Text>
                  </Box>
                  <StatusBadge status={plan?.status || "unknown"} />
                </Box>
                {plan?.managedAutomatically && (
                  <Box marginLeft={2}>
                    <Box width={26}>
                      <Text color="gray">5h </Text>
                      <UsageBar
                        percent={fiveHour.percent}
                        unlimited={fiveHour.unlimited}
                      />
                    </Box>
                    <Box width={30}>
                      <Text color="gray">Weekly </Text>
                      <UsageBar
                        percent={weekly.percent}
                        unlimited={weekly.unlimited}
                      />
                    </Box>
                    <Text color="gray">{fiveHour.reset || weekly.reset}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="cyan">
          Account pools ({pools.length})
        </Text>
        {pools.length === 0 ? (
          <Text color="gray">No named pools configured</Text>
        ) : (
          pools.map((pool) => (
            <Box key={pool.id} flexDirection="column" marginTop={1}>
              <Text bold>{pool.name} </Text>
              <Text color={pool.enabled ? "green" : "yellow"}>
                {pool.enabled ? "active" : "paused"}
              </Text>
              <Text color="gray">
                {` ${pool.provider}  ${pool.routing_mode === "usage" ? "usage-balanced" : "priority override"}`}
              </Text>
              {pool.accounts.map((account, index) => (
                <Text key={account.provider_id} color="gray">
                  {`  ${index + 1}. ${account.provider_name || account.provider_id}  ${account.priority === null ? "automatic" : `priority ${account.priority}`}`}
                </Text>
              ))}
            </Box>
          ))
        )}
      </Box>
      {warnings.map((warning) => (
        <Text key={warning} color="yellow">
          {warning}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color="gray">Press r to refresh · q to return</Text>
      </Box>
    </Box>
  );
};

const TUIRouterCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<TUIRouterStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    fetchAPI<TUIRouterStatus>("/api/router/status")
      .then((status) => {
        if (status) setData(status);
        else setError("Failed to fetch router status");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching router..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <ErrorState message="No data" />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor={data.enabled ? "cyan" : "yellow"}
        paddingX={2}
        paddingY={1}
      >
        <Text bold>Model Router</Text>
        <Box marginTop={1}>
          <Text color="gray">State: </Text>
          <StatusBadge status={data.enabled ? "active" : "stopped"} />
          <Text color="gray"> Strategy: </Text>
          <Text>{data.strategy || "weighted"}</Text>
        </Box>
        <Box>
          <Text color="gray">Spend today: </Text>
          <Text>${Number(data.globalSpendToday || 0).toFixed(4)}</Text>
          {typeof data.globalSpendLimitDaily === "number" && (
            <Text color="gray">
              {" "}
              / ${data.globalSpendLimitDaily.toFixed(2)}
            </Text>
          )}
        </Box>
      </Box>
      {data.routes.length === 0 ? (
        <Text color="gray">No router routes configured</Text>
      ) : (
        <Table
          headers={["Provider", "State", "Weight", "5h", "Week"]}
          rows={data.routes
            .slice(0, 12)
            .map((route) => [
              truncateText(route.providerId, 18),
              <StatusBadge
                key={`${route.providerId}-state`}
                status={
                  !route.enabled
                    ? "stopped"
                    : route.available
                      ? "active"
                      : "blocked"
                }
              />,
              String(route.weight),
              String(route.requestsIn5hWindow ?? 0),
              String(route.requestsInWeekWindow ?? 0),
            ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUISessionsCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<SessionInfo[]>([]);
  const [agentsById, setAgentsById] = React.useState<Map<string, AgentItem>>(
    () => new Map(),
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    Promise.all([
      fetchAPI<SessionInfo[]>("/api/sessions"),
      fetchAPI<AgentItem[]>("/api/agents/summary"),
    ])
      .then(([sessions, agents]) => {
        if (sessions) setData(Array.isArray(sessions) ? sessions : []);
        else setError("Failed to fetch sessions");
        setAgentsById(
          new Map(
            (Array.isArray(agents) ? agents : []).map((agent) => [
              agent.id,
              agent,
            ]),
          ),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching sessions..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Sessions ({data.length})
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No sessions found</Text>
      ) : (
        <Table
          headers={["Session", "Agent", "Messages", "Updated"]}
          rows={data
            .slice(0, 14)
            .map((session) => [
              truncateText(session.title || session.id, 18),
              truncateText(sessionAgentLabel(session, agentsById), 18),
              String(sessionMessageCount(session)),
              formatRelativeTime(sessionUpdatedAt(session)),
            ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUILogsCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<LogEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    fetchAPI<LogEntry[]>("/api/logs/system?limit=12")
      .then((logs) => {
        if (logs) setData(Array.isArray(logs) ? logs : []);
        else setError("Failed to fetch logs");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching logs..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1}>
        <Text bold color="cyan">
          Logs
        </Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No logs available</Text>
      ) : (
        <Box flexDirection="column">
          {data.map((log, index) => {
            const level = (log.level || "info").toUpperCase();
            const source = truncateText(
              log.module || log.source || log.logType || "gateway",
              12,
            );
            const timestamp = log.timestamp || log.created_at;
            return (
              <Box key={`log-${index}`}>
                <Box width={7}>
                  <Text
                    color={
                      level === "ERROR"
                        ? "red"
                        : level === "WARN"
                          ? "yellow"
                          : "gray"
                    }
                  >
                    {level}
                  </Text>
                </Box>
                <Box width={14}>
                  <Text color="gray">{source}</Text>
                </Box>
                <Box width={8}>
                  <Text color="gray">{formatRelativeTime(timestamp)}</Text>
                </Box>
                <Text>{truncateText(log.message || "", 60)}</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const TUIMobileCommand = () => {
  const exit = useTUIBack();
  const [data, setData] = React.useState<TUIMobileDevice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => {
    if (input === "q") exit();
  }, TUI_INPUT_OPTIONS);

  React.useEffect(() => {
    fetchAPI<{ devices: TUIMobileDevice[] }>("/api/mobile/devices")
      .then((result) => {
        if (result) setData(result.devices || []);
        else setError("Failed to fetch mobile devices");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Fetching mobile devices..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <Box flexDirection="column">
      <Logo compact />
      <Box marginY={1} flexDirection="column">
        <Text bold color="cyan">
          Mobile Devices ({data.length})
        </Text>
        <Text color="gray">Pair with: cybara mobile connect --code</Text>
      </Box>
      {data.length === 0 ? (
        <Text color="gray">No mobile devices paired</Text>
      ) : (
        <Table
          headers={["Device", "Status", "Last Seen", "Gateway"]}
          rows={data
            .slice(0, 12)
            .map((device) => [
              truncateText(device.name || device.id, 18),
              <StatusBadge key={device.id} status={device.status} />,
              formatRelativeTime(device.lastSeenAt || device.createdAt),
              truncateText(device.baseUrl, 28),
            ])}
        />
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
};

const UpdateBanner = () => {
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isUpdateCheckDisabled()) return;
    let active = true;
    checkForUpdateInBackground()
      .then((result) => {
        if (!active || !result?.updateAvailable || !result.latestVersion)
          return;
        setMessage(
          `v${result.latestVersion} is available — run \`cybara update\` to upgrade.`,
        );
      })
      .catch(() => {
        void 0;
      });
    return () => {
      active = false;
    };
  }, []);

  if (!message) return null;
  return (
    <Box marginY={1}>
      <Text color="yellow">↑ {message}</Text>
    </Box>
  );
};

interface ProviderOption {
  id: string;
  name: string;
  description: string;
  authType: string;
  oauthFlow?: "device_code" | "redirect" | null;
  hasOAuthConfig?: boolean;
  requiresApiKey: boolean;
}

const FALLBACK_PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models (3.5 Sonnet, Opus, Haiku)",
    authType: "api_key",
    requiresApiKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4, GPT-3.5",
    authType: "api_key",
    requiresApiKey: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Gemini Pro, Ultra models",
    authType: "api_key",
    requiresApiKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access many models via OpenRouter",
    authType: "api_key",
    requiresApiKey: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    description: "Run models locally with Ollama",
    authType: "none",
    requiresApiKey: false,
  },
  {
    id: "lmstudio",
    name: "LM Studio (Local)",
    description: "Local models via LM Studio",
    authType: "none",
    requiresApiKey: false,
  },
];

const SetupWizard = () => {
  const { exit } = useApp();
  const layout = useTerminalLayout();
  const [step, setStep] = React.useState<
    "welcome" | "provider" | "apikey" | "oauth" | "permissions" | "complete"
  >("welcome");
  const [providerOptions, setProviderOptions] = React.useState<
    ProviderOption[]
  >(FALLBACK_PROVIDER_OPTIONS);
  const [selectedProvider, setSelectedProvider] = React.useState(0);
  const [providerQuery, setProviderQuery] = React.useState("");
  const [providerSearchOpen, setProviderSearchOpen] = React.useState(false);
  const [chosenProvider, setChosenProvider] = React.useState<ProviderOption | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [oauthVerification, setOAuthVerification] = React.useState<{
    code?: string;
    url: string;
  } | null>(null);
  const [toolApprovalMode, setToolApprovalMode] = React.useState<
    "always_allow" | "ask"
  >("ask");
  const [status, setStatus] = React.useState<{
    message: string;
    type: "info" | "success" | "error" | "loading";
  } | null>(null);
  const providerMatches = React.useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return providerOptions;
    return providerOptions.filter(
      (provider) =>
        provider.name.toLowerCase().includes(query) ||
        provider.id.toLowerCase().includes(query) ||
        provider.description.toLowerCase().includes(query),
    );
  }, [providerOptions, providerQuery]);
  const providerRows = Math.max(4, layout.rows - 11);
  const providerWindow = terminalSelectionWindow(
    providerMatches.length,
    selectedProvider,
    providerRows,
  );
  const visibleProviders = providerMatches.slice(
    providerWindow.start,
    providerWindow.start + providerWindow.count,
  );

  React.useEffect(() => {
    fetchAPI<AvailableProviderInfo[]>("/api/providers/available")
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const mapped = data.map((provider) => {
          const authType =
            typeof provider.authType === "string"
              ? provider.authType
              : "api_key";
          return {
            id: provider.id,
            name: provider.name,
            description: provider.description || `Use ${provider.name} models`,
            authType,
            oauthFlow: provider.oauthFlow,
            hasOAuthConfig: provider.hasOAuthConfig,
            requiresApiKey:
              authType !== "none" &&
              authType !== "oauth" &&
              authType !== "aws-sdk",
          } satisfies ProviderOption;
        });
        if (mapped.length > 0) {
          setProviderOptions(mapped);
        }
      })
      .catch(() => {
        void 0;
      });
  }, []);

  React.useEffect(() => {
    if (providerMatches.length === 0) {
      setSelectedProvider(0);
      return;
    }
    if (selectedProvider >= providerMatches.length) {
      setSelectedProvider(providerMatches.length - 1);
    }
  }, [providerMatches.length, selectedProvider]);

  useInput((input, key) => {
    if (step === "welcome") {
      if (key.return || input === " ") {
        setStep("provider");
      } else if (input === "q") {
        exit();
      }
    } else if (step === "provider") {
      if (key.upArrow) {
        setSelectedProvider((s) =>
          s > 0 ? s - 1 : Math.max(0, providerMatches.length - 1),
        );
      } else if (key.downArrow) {
        setSelectedProvider((s) =>
          s < providerMatches.length - 1 ? s + 1 : 0,
        );
      } else if (key.return) {
        const provider = providerMatches[selectedProvider];
        if (!provider) return;
        setChosenProvider(provider);
        setProviderSearchOpen(false);
        if (provider.authType === "oauth") {
          setStep("oauth");
          void createOAuthProvider(provider);
        } else if (provider.requiresApiKey) {
          setStep("apikey");
        } else {
          createProvider(provider.id, "");
        }
      } else if (key.escape) {
        if (providerSearchOpen || providerQuery) {
          setProviderSearchOpen(false);
          setProviderQuery("");
          setSelectedProvider(0);
        } else {
          setStep("welcome");
        }
      } else if (providerSearchOpen && (key.backspace || key.delete)) {
        setProviderQuery((query) => query.slice(0, -1));
        setSelectedProvider(0);
      } else if (providerSearchOpen && input && !key.ctrl && !key.meta) {
        setProviderQuery((query) => query + input);
        setSelectedProvider(0);
      } else if (input.startsWith("/")) {
        setProviderSearchOpen(true);
        setProviderQuery(input.slice(1));
        setSelectedProvider(0);
      } else if (input === "q") {
        exit();
      }
    } else if (step === "apikey") {
      if (key.return) {
        if (apiKey.length > 0) {
          const provider = chosenProvider;
          if (provider) {
            createProvider(provider.id, apiKey);
          }
        }
      } else if (key.backspace || key.delete) {
        setApiKey((k) => k.slice(0, -1));
      } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setApiKey((k) => k + input);
      } else if (input === "") {
        exit();
      }
    } else if (step === "oauth") {
      if (input.toLowerCase() === "b") {
        setStep("provider");
        setChosenProvider(null);
        setOAuthVerification(null);
        setStatus(null);
      } else if (input === "q") {
        exit();
      }
    } else if (step === "permissions") {
      if (key.leftArrow || input === "1" || input.toLowerCase() === "a") {
        setToolApprovalMode("always_allow");
      } else if (
        key.rightArrow ||
        input === "2" ||
        input.toLowerCase() === "s"
      ) {
        setToolApprovalMode("ask");
      } else if (key.return) {
        saveToolApprovalMode();
      } else if (input === "b" || input === "B") {
        setStep("provider");
      }
    } else if (step === "complete") {
      if (key.return || input === " " || input === "q") {
        exit();
      }
    }
  }, TUI_INPUT_OPTIONS);

  const createOAuthProvider = async (provider: ProviderOption) => {
    if (!provider.hasOAuthConfig || !provider.oauthFlow) {
      setStatus({
        message: `OAuth is not configured for ${provider.name}`,
        type: "error",
      });
      return;
    }
    setStatus({ message: "Waiting for authorization...", type: "loading" });
    try {
      const credentials = await connectCliProviderOAuth({
        apiBase: API_BASE,
        providerType: provider.id,
        oauthFlow: provider.oauthFlow,
        headers: () =>
          withCliAuthHeaders({ "Content-Type": "application/json" }),
        onVerification: setOAuthVerification,
      });
      await createProvider(provider.id, "", credentials);
    } catch (reason) {
      setStatus({
        message:
          reason instanceof Error
            ? reason.message
            : "OAuth authorization failed",
        type: "error",
      });
    }
  };

  const createProvider = async (
    providerId: string,
    key: string,
    credentials?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    },
  ) => {
    setStatus({ message: "Creating provider...", type: "loading" });

    const result = await fetchAPI<{ id?: string; error?: string }>(
      "/api/providers",
      {
        method: "POST",
        body: JSON.stringify({
          provider: providerId,
          name:
            providerOptions.find((p) => p.id === providerId)?.name ||
            providerId,
          api_key: key || undefined,
          access_token: credentials?.accessToken,
          refresh_token: credentials?.refreshToken,
          expires_at: credentials?.expiresAt,
          is_default: true,
        }),
      },
    );

    if (result?.id) {
      setStatus({ message: "Provider created!", type: "success" });
      setTimeout(() => {
        setStatus(null);
        setStep("permissions");
      }, 1000);
    } else {
      setStatus({
        message: result?.error || "Failed to create provider",
        type: "error",
      });
    }
  };

  const saveToolApprovalMode = async () => {
    setStatus({ message: "Saving tool approval mode...", type: "loading" });
    const result = await fetchAPI<{ success?: boolean; error?: string }>(
      "/api/config",
      {
        method: "PUT",
        body: JSON.stringify({ tool_approval_mode: toolApprovalMode }),
      },
    );

    if (result && result.success !== false) {
      setStatus({ message: "Permissions saved!", type: "success" });
      setTimeout(() => {
        setStatus(null);
        void completeSetup();
      }, 800);
      return;
    }

    setStatus({
      message: result?.error || "Failed to save permissions",
      type: "error",
    });
  };

  const completeSetup = async () => {
    await fetchAPI("/api/setup/complete", { method: "POST" });
    setStep("complete");
  };

  return (
    <Box flexDirection="column" height={layout.rows} width="100%">
      <Logo />
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        {step === "welcome" && (
          <>
            <Text bold>Welcome to Cybara! 🚀</Text>
            <Box marginTop={1}>
              <Text>
                This wizard will help you set up Cybara for first use.
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">We'll configure:</Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              <Text color="gray">
                • An AI provider (OpenAI, Anthropic, etc.)
              </Text>
              <Text color="gray">
                • Tool permission mode (Always Allow or Ask)
              </Text>
            </Box>
            <Box marginTop={2}>
              <Text color="green" bold>
                Press ENTER to begin
              </Text>
            </Box>
          </>
        )}

        {step === "provider" && (
          <>
            <Text bold>Select AI Provider</Text>
            <Text color={providerSearchOpen ? "cyan" : "gray"}>
              {providerSearchOpen
                ? `Search: ${providerQuery || "type a provider name"}▏`
                : providerQuery
                  ? `Filtered by: ${providerQuery}`
                  : "Search: press /"}
            </Text>
            <Box marginTop={1} flexDirection="column" flexGrow={1}>
              {providerWindow.start > 0 && (
                <Text color="gray">↑ {providerWindow.start} more</Text>
              )}
              {visibleProviders.map((p, localIndex) => {
                const index = providerWindow.start + localIndex;
                return (
                <Box key={p.id}>
                  <Text color={index === selectedProvider ? "cyan" : "white"}>
                    {index === selectedProvider ? "❯ " : "  "}
                    {p.name}
                  </Text>
                  {!layout.narrow && <Text color="gray"> - {p.description}</Text>}
                </Box>
                );
              })}
              {providerMatches.length === 0 && (
                <Text color="gray">No providers match “{providerQuery}”</Text>
              )}
              {providerWindow.start + providerWindow.count < providerMatches.length && (
                <Text color="gray">
                  ↓ {providerMatches.length - providerWindow.start - providerWindow.count} more
                </Text>
              )}
            </Box>
            <Box>
              <Text color="gray">
                ↑↓ select · Enter confirm · / search · Esc back
              </Text>
            </Box>
          </>
        )}

        {step === "apikey" && (
          <>
            <Text bold>
              Enter API Key for{" "}
              {chosenProvider?.name || "Provider"}
            </Text>
            <Box marginTop={1}>
              <Text color="gray">API Key: </Text>
              <Text>
                {apiKey.length > 0
                  ? "•".repeat(apiKey.length)
                  : "(type your key)"}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">Press ENTER when done</Text>
            </Box>
          </>
        )}

        {step === "oauth" && (
          <>
            <Text bold>
              Connect{" "}
              {chosenProvider?.name || "OAuth Provider"}
            </Text>
            <Box marginTop={1} flexDirection="column">
              {oauthVerification?.code && (
                <Text color="cyan">
                  Authorization code: {oauthVerification.code}
                </Text>
              )}
              {oauthVerification?.url && (
                <Text color="gray">Open: {oauthVerification.url}</Text>
              )}
              <Text color="gray">Finish authorization in your browser.</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">Press B to choose another provider</Text>
            </Box>
          </>
        )}

        {step === "permissions" && (
          <>
            <Text bold>Tool Approval Mode</Text>
            <Box marginTop={1}>
              <Text color="gray">
                Choose how dangerous tools should be handled.
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text
                color={toolApprovalMode === "always_allow" ? "cyan" : "white"}
              >
                {toolApprovalMode === "always_allow" ? "❯ " : "  "}
                1) Always Allow
              </Text>
              <Text color="gray">
                {" "}
                Run tools immediately in chat and channels.
              </Text>
              <Text color={toolApprovalMode === "ask" ? "cyan" : "white"}>
                {toolApprovalMode === "ask" ? "❯ " : "  "}
                2) Ask Me First
              </Text>
              <Text color="gray">
                {" "}
                Require approval before dangerous tool calls.
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">1/A or 2/S to choose, ENTER to continue</Text>
            </Box>
          </>
        )}

        {step === "complete" && (
          <>
            <Text bold color="green">
              ✓ Setup Complete!
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text>Cybara is ready to use. Here's what you can do:</Text>
            </Box>
            <Box marginTop={1} marginLeft={2} flexDirection="column">
              <Text color="cyan">• Open the dashboard: </Text>
              <Text color="white"> http://localhost:4269</Text>
              <Text color="cyan">• Chat in terminal: </Text>
              <Text color="white"> cybara chat "Hello!"</Text>
              <Text color="cyan">• Configure more: </Text>
              <Text color="white"> Settings → Providers / Agents</Text>
            </Box>
            <Box marginTop={2}>
              <Text color="gray">Press ENTER to exit</Text>
            </Box>
          </>
        )}
      </Box>
      {status && (
        <Box marginTop={1}>
          {status.type === "loading" ? (
            <Text color="yellow">
              <Spinner type="dots" /> {status.message}
            </Text>
          ) : status.type === "success" ? (
            <Text color="green">✓ {status.message}</Text>
          ) : status.type === "error" ? (
            <Text color="red">✗ {status.message}</Text>
          ) : (
            <Text color="blue">ℹ {status.message}</Text>
          )}
        </Box>
      )}
    </Box>
  );
};

function TUIContent({
  command,
  onOpenPanel,
}: {
  command?: string;
  onOpenPanel: (action: MainMenuAction) => void;
}): React.ReactElement {
  switch (command) {
    case "wizard":
    case "setup":
    case "install":
    case "configure":
    case "onboard":
      return <SetupWizard />;
    case "status":
      return <TUIStatusCommand fetchAPI={fetchAPI} />;
    case "settings":
      return <TUISettingsCommand fetchAPI={fetchAPI} />;
    case "metrics":
      return <TUIMetricsCommand fetchAPI={fetchAPI} />;
    case "tasks":
      return <TUITasksCommand />;
    case "skills":
      return <TUISkillsCommand />;
    case "agents":
      return <TUIAgentsCommand />;
    case "providers":
    case "provider":
      return <TUIProvidersCommand />;
    case "router":
      return <TUIRouterCommand />;
    case "usage":
      return <TUIUsageCommand fetchAPI={fetchAPI} />;
    case "evals":
    case "eval":
      return <TUIEvalsCommand fetchAPI={fetchAPI} />;
    case "channels":
      return <TUIChannelsCommand fetchAPI={fetchAPI} />;
    case "plugins":
    case "plugin":
    case "connectors":
    case "connector":
      return <TUIPluginsCommand fetchAPI={fetchAPI} />;
    case "memory":
      return <TUIMemoryCommand fetchAPI={fetchAPI} />;
    case "tools":
      return <TUIToolsCommand fetchAPI={fetchAPI} />;
    case "browser":
      return <TUIBrowserCommand fetchAPI={fetchAPI} />;
    case "wallet":
      return <TUIWalletCommand fetchAPI={fetchAPI} />;
    case "chat":
      return (
        <TUIChatCommand
          apiBase={API_BASE}
          apiKey={resolveCliApiKey()}
          gatewayPassword={resolveCliGatewayPassword()}
          fetchAPI={fetchAPI}
        />
      );
    case "sessions":
      return <TUISessionsCommand />;
    case "logs":
      return <TUILogsCommand />;
    case "mobile":
      return <TUIMobileCommand />;
    case "mcp":
      return <TUIMcpCommand fetchAPI={fetchAPI} />;
    case "lsp":
      return <TUILspCommand fetchAPI={fetchAPI} />;
    case "subagents":
    case "subagent":
      return <TUISubagentsCommand fetchAPI={fetchAPI} />;
    case "artifacts":
      return <TUIArtifactsCommand fetchAPI={fetchAPI} />;
    case "journey":
      return <TUIJourneyCommand fetchAPI={fetchAPI} />;
    case "backups":
    case "backup":
      return <TUIBackupsCommand fetchAPI={fetchAPI} />;
    default:
      return (
        <MainMenu
          apiBase={API_BASE}
          header={<Logo />}
          onOpenPanel={onOpenPanel}
          onOpenWebUI={() => {
            void openUrlInBrowser(API_BASE);
          }}
          onStartServer={() => {
            startGatewayBackground();
          }}
          updateBanner={<UpdateBanner />}
        />
      );
  }
}

export const TUIApp = ({ command }: { command?: string }) => {
  const { exit } = useApp();
  const [activeCommand, setActiveCommand] = React.useState(command);
  useTerminalScreen();
  const goBack = React.useCallback(() => {
    if (activeCommand) {
      setActiveCommand(undefined);
      return;
    }
    exit();
  }, [activeCommand, exit]);
  return (
    <TUIBackProvider onBack={goBack}>
      <TUIContent command={activeCommand} onOpenPanel={setActiveCommand} />
    </TUIBackProvider>
  );
};
