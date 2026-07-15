import { Save, Send } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import type {
  CybaraMobileApi,
  ExternalTelemetrySettings,
  ExternalTelemetryStatus,
} from "../lib/api";
import {
  DetailActionButton,
  SettingsSection,
  SettingsTextField,
  SettingToggle,
} from "./dashboardControls";

const DEFAULT_SETTINGS: ExternalTelemetrySettings = {
  enabled: false,
  serviceName: "cybara",
  environment: "production",
  prometheusEnabled: false,
  otlpEnabled: false,
  otlpEndpoint: "http://127.0.0.1:4318",
  otlpHeaders: {},
  metricsEnabled: true,
  tracesEnabled: true,
  exportIntervalMs: 15000,
};

export function MobileTelemetrySettingsPanel({
  accentColor,
  api,
}: {
  accentColor: string;
  api: CybaraMobileApi;
}) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<ExternalTelemetryStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([api.externalTelemetrySettings(), api.externalTelemetryStatus()])
      .then(([nextSettings, nextStatus]) => {
        if (!active) return;
        setSettings(nextSettings);
        setStatus(nextStatus);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  const save = async (next = settings) => {
    setBusy(true);
    try {
      const result = await api.updateExternalTelemetrySettings(next);
      setSettings(result.settings);
    } catch (error) {
      Alert.alert(
        "Telemetry update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: keyof ExternalTelemetrySettings) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    void save(next);
  };

  const test = async () => {
    setBusy(true);
    try {
      const result = await api.testExternalTelemetry();
      setStatus(result.status);
      Alert.alert(
        result.status.lastError ? "Collector test failed" : "Collector connected",
        result.status.lastError ?? "Test telemetry was accepted."
      );
    } catch (error) {
      Alert.alert("Collector test failed", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="External telemetry">
      <SettingToggle
        busy={busy}
        detail="Export gateway operations only when explicitly enabled."
        label="External telemetry"
        onPress={() => toggle("enabled")}
        tone={accentColor}
        value={settings.enabled}
      />
      <SettingToggle
        busy={busy}
        label="OTLP metrics and traces"
        onPress={() => toggle("otlpEnabled")}
        tone={accentColor}
        value={settings.otlpEnabled}
      />
      <SettingToggle
        busy={busy}
        label="Prometheus endpoint"
        onPress={() => toggle("prometheusEnabled")}
        tone={accentColor}
        value={settings.prometheusEnabled}
      />
      <SettingsTextField
        editable={!busy}
        label="Service name"
        onChangeText={(value) => setSettings({ ...settings, serviceName: value })}
        value={settings.serviceName}
      />
      <SettingsTextField
        editable={!busy}
        label="Environment"
        onChangeText={(value) => setSettings({ ...settings, environment: value })}
        value={settings.environment}
      />
      {settings.otlpEnabled ? (
        <SettingsTextField
          editable={!busy}
          keyboardType="url"
          label="OTLP HTTP endpoint"
          onChangeText={(value) => setSettings({ ...settings, otlpEndpoint: value })}
          value={settings.otlpEndpoint}
        />
      ) : null}
      <DetailActionButton
        Icon={Save}
        busy={busy}
        label="Save"
        onPress={() => void save()}
        tone={accentColor}
      />
      {settings.enabled && settings.otlpEnabled ? (
        <DetailActionButton
          Icon={Send}
          busy={busy}
          label="Test collector"
          onPress={() => void test()}
          tone={accentColor}
        />
      ) : null}
      {status?.lastError ? (
        <SettingsTextField
          editable={false}
          label="Last export error"
          onChangeText={() => undefined}
          value={status.lastError}
        />
      ) : null}
    </SettingsSection>
  );
}
