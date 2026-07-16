import React from "react";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  type BackupFetch,
  type BackupMutationResponse,
  type BackupsResponse,
  formatBytes,
  formatDate,
} from "../../commands/system-backup";
import { useTerminalLayout } from "../terminal";

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
