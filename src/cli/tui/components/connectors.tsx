import React from "react";
import { Box, Text } from "ink";
import type {
  ConnectorStatus,
  MCPServiceStatus,
  PluginStatus,
} from "../../commands/connectors";
import {
  compactPanelValue,
  PanelRemainder,
  PanelShell,
  panelListLimit,
  type TUIDataFetch,
  usePanelData,
} from "./panels";
import { useTerminalLayout } from "../terminal";

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
            {plugin.enabled ? "enabled" : "disabled"} · v{plugin.version} · {plugin.skillCount} skills · {plugin.source}
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
