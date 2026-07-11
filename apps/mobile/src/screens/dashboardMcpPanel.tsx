import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { Link2, Play, Plus, Square, Trash2 } from "lucide-react-native";
import type { CybaraMobileApi, MobileMcpServer } from "../lib/api";
import { colors } from "../theme/liquidGlass";
import { DetailActionButton, SettingsSection, SettingsTextField } from "./dashboardControls";
import { styles } from "./dashboardStyles";

export function MobileMcpSettingsPanel({
  accentColor,
  api,
}: {
  accentColor: string;
  api: CybaraMobileApi;
}) {
  const [servers, setServers] = useState<MobileMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authorization, setAuthorization] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setServers(await api.listMcpServers());
    } catch (error) {
      Alert.alert(
        "MCP servers unavailable",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (error) {
      Alert.alert("MCP update failed", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const addServer = async () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl.startsWith("https://")) {
      Alert.alert("HTTPS endpoint required", "Enter a name and an HTTPS MCP server URL.");
      return;
    }
    setBusyId("new");
    try {
      await api.createMcpServer({
        name: trimmedName,
        url: trimmedUrl,
        authorization: authorization.trim() || undefined,
      });
      setName("");
      setUrl("");
      setAuthorization("");
      await load();
    } catch (error) {
      Alert.alert(
        "MCP server could not be added",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <SettingsSection title="MCP servers">
        {loading && servers.length === 0 ? (
          <ActivityIndicator color={accentColor} size="small" />
        ) : null}
        {servers.map((server) => {
          const running = server.status === "running" || server.status === "connected";
          return (
            <View key={server.id} style={styles.listRow}>
              <View style={styles.listIcon}>
                <Link2 color={running ? colors.green : accentColor} size={20} strokeWidth={2.1} />
              </View>
              <View style={styles.listText}>
                <Text numberOfLines={1} style={styles.listTitle}>
                  {server.name}
                </Text>
                <Text numberOfLines={2} style={styles.listDetail}>
                  {server.url || server.command || "Configured"} - {server.toolCount} tools
                </Text>
                <View style={styles.settingsActionRow}>
                  <DetailActionButton
                    Icon={running ? Square : Play}
                    busy={busyId === server.id}
                    label={running ? "Stop" : "Start"}
                    onPress={() =>
                      void run(server.id, () =>
                        running ? api.stopMcpServer(server.id) : api.startMcpServer(server.id)
                      )
                    }
                    tone={running ? colors.amber : colors.green}
                  />
                  <DetailActionButton
                    Icon={Trash2}
                    disabled={busyId !== null}
                    label="Remove"
                    onPress={() => void run(server.id, () => api.deleteMcpServer(server.id))}
                    tone={colors.red}
                  />
                </View>
              </View>
            </View>
          );
        })}
        {!loading && servers.length === 0 ? (
          <Text style={styles.settingsFieldHelp}>No MCP servers configured.</Text>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Add remote server">
        <SettingsTextField
          label="Name"
          onChangeText={setName}
          placeholder="Research tools"
          value={name}
        />
        <SettingsTextField
          keyboardType="url"
          label="HTTPS URL"
          onChangeText={setUrl}
          placeholder="https://service.example.com/mcp"
          value={url}
        />
        <SettingsTextField
          label="Authorization"
          onChangeText={setAuthorization}
          placeholder="Optional bearer token"
          secureTextEntry
          value={authorization}
        />
        <View style={styles.settingsActionRow}>
          <DetailActionButton
            Icon={Plus}
            busy={busyId === "new"}
            disabled={busyId !== null && busyId !== "new"}
            label="Add MCP server"
            onPress={() => void addServer()}
            tone={accentColor}
          />
        </View>
      </SettingsSection>
    </>
  );
}
