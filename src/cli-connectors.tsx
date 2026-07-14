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
import { isAccountConnectorId } from "./core/account-connectors/store";
import {
  ACCOUNT_CONNECTOR_IDS,
  type AccountConnectorId,
} from "./core/account-connectors/types";
import { openUrlInBrowser } from "./core/runtime/open-url";

const connectorIdHelp = ACCOUNT_CONNECTOR_IDS.join("|");

interface ConnectorStatus {
  id: AccountConnectorId;
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

interface PluginStatus {
  id: string;
  name: string;
  version: string;
  source: "bundled" | "local" | "workspace";
  skillCount: number;
}

interface MCPServiceStatus {
  id: string;
  name: string;
  status: string;
  toolCount: number;
  transport?: "stdio" | "http";
}

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

function connectorId(value: string | undefined): AccountConnectorId {
  if (isAccountConnectorId(value)) return value;
  throw new Error(`Account app must be one of: ${ACCOUNT_CONNECTOR_IDS.join(", ")}`);
}

function printConnectorHelp(): void {
  console.log("Plugin Account App Commands:");
  console.log("  cybara plugin apps");
  console.log(`  cybara plugin configure <${connectorIdHelp}> --client-id <id>`);
  console.log("    [--read|--write] [CYBARA_CONNECTOR_CLIENT_SECRET=...]");
  console.log(`  cybara plugin connect <${connectorIdHelp}>`);
  console.log(`  cybara plugin disconnect <${connectorIdHelp}>`);
  console.log(`  cybara plugin setup <${connectorIdHelp}>`);
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

export function TUIPluginsCommand({ fetchAPI }: { fetchAPI: TUIDataFetch }) {
  const layout = useTerminalLayout();
  const appLoader = React.useCallback(
    () => fetchAPI<ConnectorStatus[]>("/api/connectors"),
    [fetchAPI]
  );
  const pluginLoader = React.useCallback(
    () => fetchAPI<{ plugins: PluginStatus[] }>("/api/plugins"),
    [fetchAPI]
  );
  const serviceLoader = React.useCallback(
    () => fetchAPI<MCPServiceStatus[]>("/api/mcp"),
    [fetchAPI]
  );
  const appState = usePanelData(appLoader, "Failed to load account apps");
  const pluginState = usePanelData(pluginLoader, "Failed to load plugins");
  const serviceState = usePanelData(serviceLoader, "Failed to load MCP services");
  const connectors = Array.isArray(appState.data) ? appState.data : [];
  const plugins = Array.isArray(pluginState.data?.plugins) ? pluginState.data.plugins : [];
  const services = Array.isArray(serviceState.data) ? serviceState.data : [];
  const visiblePlugins = plugins.slice(0, panelListLimit(plugins.length, layout, 2));
  const visibleApps = connectors.slice(0, panelListLimit(connectors.length, layout, 3));
  const visibleServices = services.slice(0, panelListLimit(services.length, layout, 3));

  return (
    <PanelShell
      title={`Plugins (${plugins.length} bundles · ${connectors.filter((item) => item.connected).length}/${connectors.length} apps · ${services.length} MCP)`}
      detail="Installed skills, account apps, and MCP services"
      loading={appState.loading || pluginState.loading || serviceState.loading}
      error={appState.error || pluginState.error || serviceState.error}
    >
      {visiblePlugins.length > 0 ? <Text color="cyan">Installed bundles</Text> : null}
      {visiblePlugins.map((plugin) => (
        <Box key={plugin.id}>
          <Box width={layout.narrow ? 20 : 28}>
            <Text bold>{compactPanelValue(plugin.name, layout.narrow ? 18 : 26)}</Text>
          </Box>
          <Text color="#9ca6b4">
            v{plugin.version} · {plugin.skillCount} skills · {plugin.source}
          </Text>
        </Box>
      ))}
      <PanelRemainder total={plugins.length} shown={visiblePlugins.length} />
      {visibleApps.length > 0 ? <Text color="cyan">Account apps</Text> : null}
      {visibleApps.map((connector) => (
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
      <PanelRemainder total={connectors.length} shown={visibleApps.length} />
      {visibleServices.length > 0 ? <Text color="cyan">MCP services</Text> : null}
      {visibleServices.map((service) => (
        <Box key={service.id}>
          <Box width={layout.narrow ? 20 : 28}>
            <Text bold>{compactPanelValue(service.name, layout.narrow ? 18 : 26)}</Text>
          </Box>
          <Text color={service.status === "running" ? "green" : "#9ca6b4"}>
            {service.status} · {service.toolCount} tools ·{" "}
            {service.transport === "http" ? "remote" : "local"}
          </Text>
        </Box>
      ))}
      <PanelRemainder total={services.length} shown={visibleServices.length} />
      <Text color="#9ca6b4">Manage MCP services with cybara tui mcp</Text>
    </PanelShell>
  );
}
