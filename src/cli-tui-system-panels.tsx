import React from "react";
import { Box, Text, useInput } from "ink";
import {
  formatStatusBytes,
  formatStatusPct,
  formatStatusStorageBytes,
  formatStatusUptime,
  type MetricsResponse,
  type StatusResponse,
} from "./cli-status-contract";
import {
  TUIErrorState,
  TUILoadingState,
  TUILogo,
  TUIStatusBadge,
} from "./cli-tui-primitives";
import { useTUIBack } from "./cli-tui-navigation";

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

const inputOptions = {
  isActive:
    Boolean(process.stdin.isTTY) &&
    typeof (process.stdin as typeof process.stdin & { setRawMode?: unknown }).setRawMode ===
      "function",
};

function HealthCheckStatus({ status }: { status?: string }): React.ReactElement {
  return <TUIStatusBadge status={status || "ok"} />;
}

export function TUIStatusCommand({ fetchAPI }: { fetchAPI: FetchAPI }): React.ReactElement {
  const exit = useTUIBack();
  const [data, setData] = React.useState<StatusResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => input === "q" && exit(), inputOptions);

  React.useEffect(() => {
    fetchAPI<StatusResponse>("/api/health")
      .then((result) => {
        if (result) setData(result);
        else setError("Failed to connect to Cybara server");
      })
      .finally(() => setLoading(false));
  }, [fetchAPI]);

  if (loading) return <TUILoadingState message="Fetching status..." />;
  if (error) return <TUIErrorState message={error} />;
  if (!data) return <TUIErrorState message="No data" />;
  const checks = Object.entries(data.checks || {});

  return (
    <Box flexDirection="column">
      <TUILogo compact />
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold>System Status</Text>
        <Box marginTop={1}>
          <Text color="gray">Status: </Text>
          <TUIStatusBadge status={data.status} />
        </Box>
        <Box>
          <Text color="gray">Uptime: </Text>
          <Text>{formatStatusUptime(data.uptime)}</Text>
        </Box>
        <Box>
          <Text color="gray">Time: </Text>
          <Text>{new Date(data.timestamp).toLocaleString()}</Text>
        </Box>
        {data.system && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="cyan">
              System Monitor
            </Text>
            <Box>
              <Text color="gray">CPU: </Text>
              <Text>
                {formatStatusPct(data.system.cpu?.usagePct)} ({data.system.cpu?.cores || 0} cores)
              </Text>
            </Box>
            <Box>
              <Text color="gray">Memory: </Text>
              <Text>
                {formatStatusPct(data.system.memory?.usedPct)} used (
                {formatStatusBytes(data.system.memory?.usedBytes)} /{" "}
                {formatStatusBytes(data.system.memory?.totalBytes)})
              </Text>
            </Box>
            {data.system.memory?.swap && (
              <Box>
                <Text color="gray">Swap: </Text>
                <Text>
                  {formatStatusPct(data.system.memory.swap.usedPct)} used (
                  {formatStatusBytes(data.system.memory.swap.usedBytes)} /{" "}
                  {formatStatusBytes(data.system.memory.swap.totalBytes)})
                </Text>
              </Box>
            )}
            {data.system.disk && (
              <Box>
                <Text color="gray">Disk: </Text>
                <Text>
                  {formatStatusPct(data.system.disk.usedPct)} used (
                  {formatStatusStorageBytes(data.system.disk.freeBytes)} free)
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
      {checks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            Health Checks
          </Text>
          {checks.map(([name, info]) => (
            <Box key={name}>
              <Box width={15}>
                <Text color="gray">{name}</Text>
              </Box>
              <HealthCheckStatus status={info.status} />
              {info.total !== undefined && <Text color="gray"> ({info.total} total)</Text>}
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
}

export function TUIMetricsCommand({ fetchAPI }: { fetchAPI: FetchAPI }): React.ReactElement {
  const exit = useTUIBack();
  const [data, setData] = React.useState<MetricsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  useInput((input) => input === "q" && exit(), inputOptions);

  React.useEffect(() => {
    fetchAPI<MetricsResponse>("/api/metrics/overview")
      .then((result) => {
        if (result) setData(result);
        else setError("Failed to fetch metrics");
      })
      .finally(() => setLoading(false));
  }, [fetchAPI]);

  if (loading) return <TUILoadingState message="Fetching metrics..." />;
  if (error) return <TUIErrorState message={error} />;
  if (!data) return <TUIErrorState message="No data" />;

  return (
    <Box flexDirection="column">
      <TUILogo compact />
      <Box
        flexDirection="column"
        marginY={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
      >
        <Text bold>Token Metrics</Text>
        <Box marginTop={1}>
          <Text color="gray">Total Tokens: </Text>
          <Text color="green">{(data.tokenUsage?.total || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Input Tokens: </Text>
          <Text>{(data.tokenUsage?.input || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Output Tokens: </Text>
          <Text>{(data.tokenUsage?.output || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">Tool Calls: </Text>
          <Text>{(data.toolCalls?.totalCalls || 0).toLocaleString()}</Text>
        </Box>
        <Box>
          <Text color="gray">API Calls: </Text>
          <Text>{(data.apiCalls?.totalCalls || 0).toLocaleString()}</Text>
        </Box>
      </Box>
      {data.fileOperations && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">
            File Operations
          </Text>
          <Box>
            <Box width={20}>
              <Text color="gray">Files Read</Text>
            </Box>
            <Text>{(data.fileOperations.filesRead || 0).toLocaleString()}</Text>
          </Box>
          <Box>
            <Box width={20}>
              <Text color="gray">Files Written</Text>
            </Box>
            <Text>{(data.fileOperations.filesWritten || 0).toLocaleString()}</Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray">Press q to exit</Text>
      </Box>
    </Box>
  );
}
