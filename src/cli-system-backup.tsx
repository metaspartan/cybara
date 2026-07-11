import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import { getFlagValue, hasFlag } from "./cli-args";
import { useTerminalLayout } from "./cli-tui-terminal";

interface BackupSummary {
  id: string;
  label: string;
  createdAt: string;
  entries: string[];
  bytes: number;
}

interface RestoreStatus {
  state: "idle" | "pending" | "completed" | "failed";
  backupId?: string;
  error?: string;
}

interface BackupsResponse {
  backups: BackupSummary[];
  backupDirectory: string;
  restore: RestoreStatus;
}

interface BackupMutationResponse {
  success?: boolean;
  backup?: BackupSummary;
  restartRequired?: boolean;
  error?: string;
  message?: string;
}

type BackupFetch = <T>(
  endpoint: string,
  options?: RequestInit,
) => Promise<T | null>;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function requireBackupId(args: string[], action: string): string {
  const id = args.find((value, index) => index > 0 && !value.startsWith("-"));
  if (!id) throw new Error(`Usage: cybara backup ${action} <backup-id> --yes`);
  return id;
}

async function requireResponse<T>(
  fetchAPI: BackupFetch,
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetchAPI<T>(endpoint, options);
  if (!response) throw new Error("Gateway did not return a backup response");
  return response;
}

function printBackups(response: BackupsResponse): void {
  console.log("System Backups");
  console.log("==============");
  console.log(`Directory: ${response.backupDirectory}`);
  if (response.restore.state !== "idle") {
    console.log(
      `Restore:   ${response.restore.state}${response.restore.error ? ` (${response.restore.error})` : ""}`,
    );
  }
  console.log("");
  if (response.backups.length === 0) {
    console.log("No backups found.");
    return;
  }
  for (const backup of response.backups) {
    console.log(
      `${backup.id}  ${formatBytes(backup.bytes)}  ${formatDate(backup.createdAt)}`,
    );
    console.log(`  ${backup.label}`);
  }
}

export async function runSystemBackupCommand(
  args: string[],
  fetchAPI: BackupFetch,
): Promise<void> {
  const action = args[0] || "list";
  if (action === "list") {
    printBackups(
      await requireResponse<BackupsResponse>(fetchAPI, "/api/system/backups"),
    );
    return;
  }
  if (action === "create") {
    const label =
      getFlagValue(args.slice(1), "--label") ||
      `Manual backup ${new Date().toLocaleString()}`;
    const response = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      "/api/system/backups",
      {
        method: "POST",
        body: JSON.stringify({ label }),
      },
    );
    if (!response.success || !response.backup)
      throw new Error(response.error || "Backup creation failed");
    console.log(
      `Created ${response.backup.id} (${formatBytes(response.backup.bytes)})`,
    );
    return;
  }
  if (action === "restore") {
    const id = requireBackupId(args, "restore");
    if (!hasFlag(args, "--yes", "-y")) {
      throw new Error(
        `Restore replaces durable gateway data. Re-run with: cybara backup restore ${id} --yes`,
      );
    }
    const response = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      `/api/system/backups/${encodeURIComponent(id)}/restore`,
      { method: "POST" },
    );
    if (!response.success)
      throw new Error(response.error || "Backup restore could not be staged");
    const restart = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      "/api/system/restart",
      {
        method: "POST",
      },
    );
    if (restart.success === false)
      throw new Error(restart.error || "Gateway restart failed");
    console.log(
      `Restore scheduled for ${id}. ${restart.message || "Gateway restarting."}`,
    );
    return;
  }
  if (action === "delete" || action === "remove") {
    const id = requireBackupId(args, "delete");
    if (!hasFlag(args, "--yes", "-y")) {
      throw new Error(`Re-run with: cybara backup delete ${id} --yes`);
    }
    const response = await requireResponse<BackupMutationResponse>(
      fetchAPI,
      `/api/system/backups/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!response.success)
      throw new Error(response.error || "Backup deletion failed");
    console.log(`Deleted ${id}`);
    return;
  }
  throw new Error("Usage: cybara backup <list|create|restore|delete>");
}

export function TUIBackupsCommand({
  fetchAPI,
}: {
  fetchAPI: BackupFetch;
}): React.ReactElement {
  const { exit } = useApp();
  const layout = useTerminalLayout();
  const [revision, setRevision] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  const [data, setData] = React.useState<BackupsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    const response = await fetchAPI<BackupsResponse>("/api/system/backups");
    if (!response) throw new Error("Unable to load backups");
    setData(response);
  }, [fetchAPI]);

  React.useEffect(() => {
    void load().catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : "Unable to load backups",
      );
    });
  }, [load, revision]);

  useInput((input, key) => {
    if ((key.ctrl && input === "c") || input === "q" || key.escape) exit();
    if (input === "r") setRevision((value) => value + 1);
    if (input === "c" && !creating) {
      setCreating(true);
      void fetchAPI<BackupMutationResponse>("/api/system/backups", {
        method: "POST",
        body: JSON.stringify({
          label: `Manual backup ${new Date().toLocaleString()}`,
        }),
      })
        .then((response) => {
          if (!response?.success)
            throw new Error(response?.error || "Backup creation failed");
          setRevision((value) => value + 1);
        })
        .catch((cause: unknown) => {
          setError(
            cause instanceof Error ? cause.message : "Backup creation failed",
          );
        })
        .finally(() => setCreating(false));
    }
  });

  const capacity = Math.max(1, layout.rows - 10);
  const backups = data?.backups.slice(0, capacity) || [];

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
          Backup & Restore
        </Text>
        <Text color="#9ca6b4">
          Private local snapshots of durable gateway state
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {error ? <Text color="red">✗ {error}</Text> : null}
        {!data ? (
          <Text color="yellow">
            <Spinner type="dots" /> Loading...
          </Text>
        ) : null}
        {data ? <Text color="#9ca6b4">{data.backupDirectory}</Text> : null}
        {data?.restore.state && data.restore.state !== "idle" ? (
          <Text color={data.restore.state === "failed" ? "red" : "yellow"}>
            Restore {data.restore.state}
          </Text>
        ) : null}
        <Box flexDirection="column" marginTop={1}>
          {data && backups.length === 0 ? (
            <Text color="#9ca6b4">No backups yet.</Text>
          ) : null}
          {backups.map((backup) => (
            <Box
              key={backup.id}
              flexDirection={layout.narrow ? "column" : "row"}
              marginBottom={layout.narrow ? 1 : 0}
            >
              <Box width={layout.narrow ? undefined : 34}>
                <Text bold>{backup.label}</Text>
              </Box>
              <Box width={layout.narrow ? undefined : 22}>
                <Text color="#9ca6b4">{formatDate(backup.createdAt)}</Text>
              </Box>
              <Text color="cyan">{formatBytes(backup.bytes)}</Text>
            </Box>
          ))}
        </Box>
      </Box>
      <Box paddingBottom={1}>
        <Text color="#9ca6b4">
          c create · r refresh · q/esc back · restore/delete via cybara backup
        </Text>
      </Box>
    </Box>
  );
}
