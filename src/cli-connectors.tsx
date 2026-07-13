import React from "react";
import { Box, Text } from "ink";
import { getFlagValue, hasFlag } from "./cli-args";
import {
  compactPanelValue,
  PanelRemainder,
  PanelShell,
  panelListLimit,
  type TUIDataFetch,
  usePanelData,
} from "./cli-tui-panels";
import { useTerminalLayout } from "./cli-tui-terminal";
import { openUrlInBrowser } from "./core/runtime/open-url";

type ConnectorId = "google_workspace" | "dropbox";

interface ConnectorStatus {
  id: ConnectorId;
  label: string;
  services: string[];
  docsUrl: string;
  redirectUri: string;
  configured: boolean;
  connected: boolean;
  access: "read" | "read_write";
  account?: string;
}

interface OAuthStart {
  state: string;
  authUrl: string;
}

interface OAuthStatus {
  status: "pending" | "connected" | "error" | "not_found";
  error?: string;
}

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

function connectorId(value: string | undefined): ConnectorId {
  if (value === "google_workspace" || value === "dropbox") return value;
  throw new Error("Connector must be google_workspace or dropbox");
}

function printConnectorHelp(): void {
  console.log("Account Connector Commands:");
  console.log("  cybara connectors list");
  console.log("  cybara connectors configure <google_workspace|dropbox> --client-id <id>");
  console.log("    [--read|--write] [CYBARA_CONNECTOR_CLIENT_SECRET=...]");
  console.log("  cybara connectors connect <google_workspace|dropbox>");
  console.log("  cybara connectors disconnect <google_workspace|dropbox>");
  console.log("  cybara connectors setup <google_workspace|dropbox>");
}

async function waitForOAuth(fetchAPI: FetchAPI, state: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await Bun.sleep(1_000);
    const status = await fetchAPI<OAuthStatus>(
      `/api/connectors/oauth/status?state=${encodeURIComponent(state)}`
    );
    if (status?.status === "connected") return;
    if (status?.status === "error") throw new Error(status.error || "Authorization failed");
    if (status?.status === "not_found") throw new Error("Authorization expired");
  }
  throw new Error("Authorization timed out");
}

export async function runConnectorCommand(args: string[], fetchAPI: FetchAPI): Promise<void> {
  const subcommand = args[0] || "list";
  if (subcommand === "list") {
    const connectors = await fetchAPI<ConnectorStatus[]>("/api/connectors");
    if (!connectors) return;
    for (const connector of connectors) {
      const state = connector.connected
        ? `connected${connector.account ? ` as ${connector.account}` : ""}`
        : connector.configured
          ? "configured"
          : "not configured";
      console.log(
        `${connector.label}: ${state} | ${connector.access === "read_write" ? "read/write" : "read-only"} | ${connector.services.join(", ")}`
      );
    }
    return;
  }

  const id = connectorId(args[1]);
  if (subcommand === "configure") {
    const clientId = getFlagValue(args, "--client-id");
    if (!clientId) throw new Error("--client-id is required");
    const result = await fetchAPI<ConnectorStatus>(`/api/connectors/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        clientId,
        ...(process.env.CYBARA_CONNECTOR_CLIENT_SECRET
          ? { clientSecret: process.env.CYBARA_CONNECTOR_CLIENT_SECRET }
          : {}),
        access: hasFlag(args, "--write") ? "read_write" : "read",
      }),
    });
    if (result) console.log(`${result.label} configured (${result.redirectUri})`);
    return;
  }
  if (subcommand === "connect") {
    const started = await fetchAPI<OAuthStart>(`/api/connectors/${id}/oauth/start`, {
      method: "POST",
    });
    if (!started) return;
    await openUrlInBrowser(started.authUrl);
    console.log("Complete authorization in the browser...");
    await waitForOAuth(fetchAPI, started.state);
    console.log("Account connected.");
    return;
  }
  if (subcommand === "disconnect") {
    const result = await fetchAPI<ConnectorStatus>(`/api/connectors/${id}`, {
      method: "DELETE",
    });
    if (result) console.log(`${result.label} disconnected.`);
    return;
  }
  if (subcommand === "setup") {
    const connectors = await fetchAPI<ConnectorStatus[]>("/api/connectors");
    const connector = connectors?.find((item) => item.id === id);
    if (connector) await openUrlInBrowser(connector.docsUrl);
    return;
  }
  printConnectorHelp();
}

export function TUIConnectorsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const loader = React.useCallback(
    () => fetchAPI<ConnectorStatus[]>("/api/connectors"),
    [fetchAPI]
  );
  const state = usePanelData(loader, "Failed to load account connectors");
  const connectors = Array.isArray(state.data) ? state.data : [];
  const visible = connectors.slice(0, panelListLimit(connectors.length, layout, 3));

  return (
    <PanelShell
      title={`Account Connectors (${connectors.filter((item) => item.connected).length}/${connectors.length})`}
      detail="Private account access for agents; writes remain approval-gated"
      loading={state.loading}
      error={state.error}
    >
      {visible.map((connector) => (
        <Box key={connector.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Box width={layout.narrow ? 20 : 28}>
              <Text bold>{compactPanelValue(connector.label, layout.narrow ? 18 : 26)}</Text>
            </Box>
            <Text
              color={connector.connected ? "green" : connector.configured ? "yellow" : "gray"}
            >
              {connector.connected
                ? "connected"
                : connector.configured
                  ? "configured"
                  : "not configured"}
            </Text>
          </Box>
          <Text color="#9ca6b4">
            {connector.access === "read_write" ? "read/write" : "read-only"} |{" "}
            {connector.services.join(", ")}
          </Text>
        </Box>
      ))}
      <PanelRemainder total={connectors.length} shown={visible.length} />
    </PanelShell>
  );
}
