import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import {
  externalTelemetryApi,
  type ExternalTelemetrySettings as Settings,
  type ExternalTelemetryStatus,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { Activity, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const DEFAULT_SETTINGS: Settings = {
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

interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

function rowsFromHeaders(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([name, value]) => ({ id: crypto.randomUUID(), name, value }));
}

export function ExternalTelemetrySettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<ExternalTelemetryStatus | null>(null);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const { addToast } = useUIStore();

  useEffect(() => {
    let active = true;
    void Promise.all([externalTelemetryApi.getSettings(), externalTelemetryApi.getStatus()]).then(
      ([settingsResult, statusResult]) => {
        if (!active) return;
        if (settingsResult.success && settingsResult.data) {
          setSettings(settingsResult.data);
          setHeaders(rowsFromHeaders(settingsResult.data.otlpHeaders));
        }
        if (statusResult.success && statusResult.data) setStatus(statusResult.data);
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const save = async (next: Settings) => {
    setSaving(true);
    try {
      const otlpHeaders = Object.fromEntries(
        headers
          .filter((header) => header.name.trim() && header.value.trim())
          .map((header) => [header.name.trim(), header.value.trim()])
      );
      const result = await externalTelemetryApi.updateSettings({ ...next, otlpHeaders });
      if (!result.success || !result.data?.success)
        throw new Error(result.error || "Update failed");
      setSettings(result.data.settings);
      setHeaders(rowsFromHeaders(result.data.settings.otlpHeaders));
      addToast("success", "Telemetry settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save telemetry");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof Settings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    void save(next);
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await externalTelemetryApi.test();
      if (!result.success || !result.data?.success) throw new Error(result.error || "Test failed");
      setStatus(result.data.status);
      if (result.data.status.lastError) throw new Error(result.data.status.lastError);
      addToast("success", "Collector accepted test telemetry");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Collector test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" /> External Telemetry
        </CardTitle>
        <CardDescription>
          Export gateway metrics and traces to your observability stack
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Switch
          label="External telemetry"
          description="Keep disabled unless this gateway should export operational data"
          checked={settings.enabled}
          disabled={loading || saving}
          onChange={(value) => toggle("enabled", value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Service name"
            value={settings.serviceName}
            disabled={!settings.enabled}
            onChange={(event) => setSettings({ ...settings, serviceName: event.target.value })}
          />
          <Input
            label="Environment"
            value={settings.environment}
            disabled={!settings.enabled}
            onChange={(event) => setSettings({ ...settings, environment: event.target.value })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Switch
            label="OTLP"
            checked={settings.otlpEnabled}
            disabled={!settings.enabled || saving}
            onChange={(value) => toggle("otlpEnabled", value)}
          />
          <Switch
            label="Metrics"
            checked={settings.metricsEnabled}
            disabled={!settings.enabled || saving}
            onChange={(value) => toggle("metricsEnabled", value)}
          />
          <Switch
            label="Traces"
            checked={settings.tracesEnabled}
            disabled={!settings.enabled || saving}
            onChange={(value) => toggle("tracesEnabled", value)}
          />
        </div>
        <Switch
          label="Prometheus endpoint"
          description="Expose gateway counters at /api/telemetry/prometheus"
          checked={settings.prometheusEnabled}
          disabled={!settings.enabled || saving}
          onChange={(value) => toggle("prometheusEnabled", value)}
        />
        {settings.otlpEnabled ? (
          <div className="space-y-3">
            <Input
              label="OTLP HTTP endpoint"
              value={settings.otlpEndpoint}
              onChange={(event) => setSettings({ ...settings, otlpEndpoint: event.target.value })}
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">Request headers</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() =>
                    setHeaders([...headers, { id: crypto.randomUUID(), name: "", value: "" }])
                  }
                >
                  Add
                </Button>
              </div>
              {headers.map((header) => (
                <div
                  key={header.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
                >
                  <Input
                    aria-label="Header name"
                    placeholder="Authorization"
                    value={header.name}
                    onChange={(event) =>
                      setHeaders(
                        headers.map((row) =>
                          row.id === header.id ? { ...row, name: event.target.value } : row
                        )
                      )
                    }
                  />
                  <Input
                    aria-label="Header value"
                    type="password"
                    placeholder="Bearer token"
                    value={header.value}
                    onChange={(event) =>
                      setHeaders(
                        headers.map((row) =>
                          row.id === header.id ? { ...row, value: event.target.value } : row
                        )
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Remove header"
                    className="self-center px-2"
                    onClick={() => setHeaders(headers.filter((row) => row.id !== header.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {status ? (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3 text-xs sm:grid-cols-4">
            <span className="text-[var(--text-muted)]">
              Metrics{" "}
              <strong className="text-[var(--text-primary)]">{status.exportedMetrics}</strong>
            </span>
            <span className="text-[var(--text-muted)]">
              Spans <strong className="text-[var(--text-primary)]">{status.exportedSpans}</strong>
            </span>
            <span className="text-[var(--text-muted)]">
              Queued{" "}
              <strong className="text-[var(--text-primary)]">
                {status.queuedMetrics + status.queuedSpans}
              </strong>
            </span>
            <span className="text-[var(--text-muted)]">
              Last export{" "}
              <strong className="text-[var(--text-primary)]">
                {status.lastExportAt ? new Date(status.lastExportAt).toLocaleTimeString() : "Never"}
              </strong>
            </span>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!settings.enabled || !settings.otlpEnabled}
            isLoading={testing}
            leftIcon={<Send className="h-4 w-4" />}
            onClick={() => void test()}
          >
            Test
          </Button>
          <Button type="button" isLoading={saving} onClick={() => void save(settings)}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
