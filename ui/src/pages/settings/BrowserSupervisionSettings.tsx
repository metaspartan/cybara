import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import {
  browserSupervisionApi,
  type BrowserDownloadPolicy,
  type BrowserSupervisionSettings as Settings,
  type BrowserSupervisionStatus,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { MonitorCog } from "lucide-react";
import { useEffect, useState } from "react";

const DEFAULT_SETTINGS: Settings = {
  autoRestart: true,
  healthCheckIntervalMs: 30000,
  downloadPolicy: "ask",
  remoteRoutingEnabled: false,
  remoteEndpoint: "",
  remoteToken: "",
};

const DOWNLOAD_POLICY_OPTIONS: Array<{ value: BrowserDownloadPolicy; label: string }> = [
  { value: "ask", label: "Ask before downloading" },
  { value: "allow", label: "Always allow" },
  { value: "deny", label: "Block downloads" },
];

export function BrowserSupervisionSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<BrowserSupervisionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useUIStore();

  useEffect(() => {
    let active = true;
    void browserSupervisionApi.get().then((result) => {
      if (!active) return;
      if (result.success && result.data) {
        setSettings(result.data.settings);
        setStatus(result.data.status);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async (next: Settings) => {
    setSaving(true);
    try {
      const result = await browserSupervisionApi.update(next);
      if (!result.success || !result.data?.success)
        throw new Error(result.error || "Update failed");
      setSettings(result.data.settings);
      setStatus(result.data.status);
      addToast("success", "Browser supervision settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save browser settings");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: "autoRestart" | "remoteRoutingEnabled", value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    void save(next);
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorCog className="h-5 w-5" /> Browser Supervision
        </CardTitle>
        <CardDescription>
          Control browser recovery, downloads, and optional remote routing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Switch
          label="Restart after unexpected exit"
          description="Recover an active browser preview when its process disconnects"
          checked={settings.autoRestart}
          disabled={loading || saving}
          onChange={(value) => toggle("autoRestart", value)}
        />
        <Select
          label="Download policy"
          value={settings.downloadPolicy}
          options={DOWNLOAD_POLICY_OPTIONS}
          disabled={loading || saving}
          onChange={(value) =>
            setSettings({ ...settings, downloadPolicy: value as BrowserDownloadPolicy })
          }
        />
        <Switch
          label="Remote browser routing"
          description="Connect to a trusted CDP browser instead of launching one on this device"
          checked={settings.remoteRoutingEnabled}
          disabled={loading || saving}
          onChange={(value) => toggle("remoteRoutingEnabled", value)}
        />
        {settings.remoteRoutingEnabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="CDP endpoint"
              placeholder="https://browser.example.com"
              value={settings.remoteEndpoint}
              onChange={(event) => setSettings({ ...settings, remoteEndpoint: event.target.value })}
            />
            <Input
              label="Access token"
              type="password"
              placeholder="Optional bearer token"
              value={settings.remoteToken}
              onChange={(event) => setSettings({ ...settings, remoteToken: event.target.value })}
            />
          </div>
        ) : null}
        {status ? (
          <div className="grid gap-2 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3 text-xs sm:grid-cols-3">
            <span className="text-[var(--text-muted)]">
              Owner <strong className="text-[var(--text-primary)]">{status.owner}</strong>
            </span>
            <span className="text-[var(--text-muted)]">
              Health{" "}
              <strong className="text-[var(--text-primary)]">
                {status.healthy ? "Ready" : "Idle"}
              </strong>
            </span>
            <span className="text-[var(--text-muted)]">
              Restarts <strong className="text-[var(--text-primary)]">{status.restartCount}</strong>
            </span>
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" isLoading={saving} onClick={() => void save(settings)}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
