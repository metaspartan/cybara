import {
  Building2,
  Cloud,
  ExternalLink,
  Link2,
  Mail,
  NotebookText,
  Package,
  Server,
  Unplug,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Text, View } from "react-native";
import type {
  CybaraMobileApi,
  MobileAccountConnector,
  MobileAccountConnectorId,
  MobileMcpServer,
  MobilePlugin,
} from "../lib/api";
import { colors } from "../theme/liquidGlass";
import {
  DetailActionButton,
  SettingsSection,
  SettingsTextField,
  SettingToggle,
} from "./dashboardControls";
import { styles } from "./dashboardStyles";

interface ConnectorDraft {
  clientId: string;
  clientSecret: string;
  writeAccess: boolean;
}

async function waitForOAuth(api: CybaraMobileApi, state: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    const status = await api.accountConnectorOAuthStatus(state);
    if (status.status === "connected") return;
    if (status.status === "error") throw new Error(status.error || "Authorization failed");
    if (status.status === "not_found") throw new Error("Authorization expired");
  }
  throw new Error("Authorization timed out");
}

export function MobilePluginsPanel({
  accentColor,
  api,
}: {
  accentColor: string;
  api: CybaraMobileApi;
}) {
  const [connectors, setConnectors] = useState<MobileAccountConnector[]>([]);
  const [plugins, setPlugins] = useState<MobilePlugin[]>([]);
  const [services, setServices] = useState<MobileMcpServer[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<MobileAccountConnectorId, ConnectorDraft>>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api.listAccountConnectors(),
      api.listPlugins(),
      api.listMcpServers(),
    ]);
    const [connectorResult, pluginResult, serviceResult] = results;
    if (connectorResult.status === "fulfilled") {
      setConnectors(connectorResult.value);
      setDrafts((current) => {
        const output = { ...current };
        for (const connector of connectorResult.value) {
          output[connector.id] = output[connector.id] || {
            clientId: "",
            clientSecret: "",
            writeAccess: connector.access === "read_write",
          };
        }
        return output;
      });
    }
    if (pluginResult.status === "fulfilled") setPlugins(pluginResult.value);
    if (serviceResult.status === "fulfilled") setServices(serviceResult.value);
    const failures = results.flatMap((result) =>
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : []
    );
    if (failures.length > 0) throw new Error(failures.join(". "));
  }, [api]);

  useEffect(() => {
    void load()
      .catch((error) =>
        Alert.alert("Plugins unavailable", error instanceof Error ? error.message : String(error))
      )
      .finally(() => setLoading(false));
  }, [load]);

  const patch = (connector: MobileAccountConnector, next: Partial<ConnectorDraft>): void => {
    setDrafts((current) => ({
      ...current,
      [connector.id]: {
        clientId: "",
        clientSecret: "",
        writeAccess: connector.access === "read_write",
        ...current[connector.id],
        ...next,
      },
    }));
  };

  const connect = async (connector: MobileAccountConnector): Promise<void> => {
    const draft = drafts[connector.id];
    if (!draft) return;
    setBusy(connector.id);
    try {
      await api.updateAccountConnector(connector.id, {
        ...(draft.clientId.trim() ? { clientId: draft.clientId.trim() } : {}),
        ...(draft.clientSecret.trim() ? { clientSecret: draft.clientSecret.trim() } : {}),
        access: draft.writeAccess ? "read_write" : "read",
      });
      const started = await api.startAccountConnectorOAuth(connector.id);
      await api.openUrlOnGateway(started.authUrl);
      Alert.alert(
        "Continue on your gateway",
        "Complete account authorization in the browser that opened on your gateway computer."
      );
      await waitForOAuth(api, started.state);
      await load();
    } catch (error) {
      Alert.alert("Connection failed", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (connector: MobileAccountConnector): Promise<void> => {
    setBusy(connector.id);
    try {
      await api.disconnectAccountConnector(connector.id);
      await load();
    } catch (error) {
      Alert.alert("Disconnect failed", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  if (loading && connectors.length === 0 && plugins.length === 0 && services.length === 0) {
    return <ActivityIndicator color={accentColor} size="small" />;
  }

  return (
    <>
      <SettingsSection title="Installed plugins">
        {plugins.length === 0 ? (
          <Text style={styles.settingsFieldHelp}>No plugin bundles are installed.</Text>
        ) : (
          plugins.map((plugin) => (
            <View key={plugin.id} style={styles.listRow}>
              <View style={styles.listIcon}>
                <Package color={accentColor} size={19} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{plugin.name}</Text>
                <Text style={styles.listDetail}>
                  v{plugin.version} · {plugin.skillCount} skill
                  {plugin.skillCount === 1 ? "" : "s"} · {plugin.source}
                </Text>
              </View>
            </View>
          ))
        )}
      </SettingsSection>
      <SettingsSection title="MCP services">
        {services.length === 0 ? (
          <Text style={styles.settingsFieldHelp}>No MCP services are configured.</Text>
        ) : (
          services.map((service) => (
            <View key={service.id} style={styles.listRow}>
              <View style={styles.listIcon}>
                <Server
                  color={service.status === "running" ? colors.green : accentColor}
                  size={19}
                />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{service.name}</Text>
                <Text style={styles.listDetail}>
                  {service.status} · {service.toolCount} tool
                  {service.toolCount === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
          ))
        )}
      </SettingsSection>
      <SettingsSection title="Account apps">
        <Text style={styles.settingsFieldHelp}>
          Reading is the default. Account changes remain approval-gated.
        </Text>
      </SettingsSection>
      {connectors.map((connector) => {
        const draft = drafts[connector.id] || {
          clientId: "",
          clientSecret: "",
          writeAccess: connector.access === "read_write",
        };
        const Icon =
          connector.id === "google_workspace"
            ? Mail
            : connector.id === "microsoft_365"
              ? Building2
              : connector.id === "notion"
                ? NotebookText
                : Cloud;
        return (
          <SettingsSection key={connector.id} title={connector.label}>
            <View style={styles.listRow}>
              <View style={styles.listIcon}>
                <Icon color={connector.connected ? colors.green : accentColor} size={20} />
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>
                  {connector.account || (connector.connected ? "Connected" : "Not connected")}
                </Text>
                <Text style={styles.listDetail}>{connector.description}</Text>
              </View>
            </View>
            <SettingsTextField
              label={connector.clientIdLabel}
              onChangeText={(clientId) => patch(connector, { clientId })}
              placeholder={connector.configured ? "Configured" : "Client identifier"}
              value={draft.clientId}
            />
            {connector.clientSecretLabel ? (
              <SettingsTextField
                label={connector.clientSecretLabel}
                onChangeText={(clientSecret) => patch(connector, { clientSecret })}
                placeholder={connector.configured ? "Configured" : "Client secret"}
                secureTextEntry
                value={draft.clientSecret}
              />
            ) : null}
            <Text selectable style={styles.settingsFieldHelp}>
              OAuth callback: {connector.redirectUri}
            </Text>
            <SettingToggle
              detail="Messages, files, events, and pages still require agent approval."
              label="Allow account changes"
              onPress={() => patch(connector, { writeAccess: !draft.writeAccess })}
              tone={accentColor}
              value={draft.writeAccess}
            />
            <View style={styles.settingsActionRow}>
              <DetailActionButton
                Icon={Link2}
                busy={busy === connector.id}
                label={connector.connected ? "Reconnect" : "Connect"}
                onPress={() => void connect(connector)}
                tone={accentColor}
              />
              {connector.connected ? (
                <DetailActionButton
                  Icon={Unplug}
                  disabled={busy !== null}
                  label="Disconnect"
                  onPress={() => void disconnect(connector)}
                  tone={colors.red}
                />
              ) : null}
              <DetailActionButton
                Icon={ExternalLink}
                disabled={busy !== null}
                label="Setup"
                onPress={() =>
                  void Linking.openURL(connector.docsUrl).catch((error) =>
                    Alert.alert(
                      "Unable to open setup",
                      error instanceof Error ? error.message : String(error)
                    )
                  )
                }
                tone={accentColor}
              />
            </View>
          </SettingsSection>
        );
      })}
    </>
  );
}
