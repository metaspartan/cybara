import { RefreshCw, Save, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import type { ComputerUseStatus, CybaraMobileApi } from "../lib/api";
import { DetailActionButton, SettingsSection, SettingsTextField } from "./dashboardControls";

export function MobileComputerUsePanel({ api }: { api: CybaraMobileApi }) {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [driverPath, setDriverPath] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const next = await api.computerUseStatus();
      setStatus(next);
      setDriverPath(next.configuredCommand ?? "");
    } catch (error) {
      Alert.alert(
        "Computer use unavailable",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateConfig({ computer_use: { driverCommand: driverPath.trim() } });
      await load();
    } catch (error) {
      Alert.alert(
        "Driver path update failed",
        error instanceof Error ? error.message : String(error)
      );
      setBusy(false);
    }
  };

  const grant = async () => {
    setBusy(true);
    try {
      const result = await api.grantComputerUsePermissions();
      Alert.alert(
        result.ok ? "Permission request opened" : "Permission request failed",
        result.message
      );
      await load();
    } catch (error) {
      Alert.alert(
        "Permission request failed",
        error instanceof Error ? error.message : String(error)
      );
      setBusy(false);
    }
  };

  const detail = status
    ? `${status.ready ? "Ready" : status.available ? "Needs attention" : "Not installed"}${status.version ? ` · v${status.version}` : ""} · ${status.platform}`
    : "Checking gateway computer-use support";

  return (
    <SettingsSection title="Computer use">
      <SettingsTextField
        editable={!busy}
        help={`${detail}. ${status?.message ?? ""}`.trim()}
        label="Driver path override"
        onChangeText={setDriverPath}
        placeholder="Leave empty to use automatic detection"
        value={driverPath}
      />
      <DetailActionButton
        Icon={Save}
        busy={busy}
        label="Save driver path"
        onPress={() => void save()}
      />
      <DetailActionButton
        Icon={RefreshCw}
        busy={busy}
        label="Check status"
        onPress={() => void load()}
      />
      {status?.platform === "darwin" ? (
        <DetailActionButton
          Icon={ShieldCheck}
          busy={busy}
          label="Request macOS permissions"
          onPress={() => void grant()}
        />
      ) : null}
    </SettingsSection>
  );
}
