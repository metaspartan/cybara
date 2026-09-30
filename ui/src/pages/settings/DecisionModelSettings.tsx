import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { decisionApi, type DecisionSettings } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { AlertCircle, Brain, RotateCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const EMPTY: DecisionSettings = {
  models: [],
  base_url: "",
  has_api_key: false,
  model: "",
  provider_ready: false,
};

export function DecisionModelSettings() {
  const [settings, setSettings] = useState<DecisionSettings>(EMPTY);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { addToast } = useUIStore();

  const applySettings = useCallback((next: DecisionSettings) => {
    setSettings(next);
    setBaseUrl(next.base_url);
    setModel(next.model);
    setApiKey("");
    setClearApiKey(false);
  }, []);

  const loadSettings = useCallback(
    async (active: () => boolean = () => true): Promise<void> => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await decisionApi.get();
        if (!active()) return;
        if (!result.success || !result.data) {
          throw new Error(result.error || "Decision settings are unavailable");
        }
        applySettings(result.data);
      } catch (error) {
        if (!active()) return;
        setLoadError(error instanceof Error ? error.message : "Decision settings are unavailable");
      } finally {
        if (active()) setLoading(false);
      }
    },
    [applySettings]
  );

  useEffect(() => {
    let active = true;
    void loadSettings(() => active);
    return () => {
      active = false;
    };
  }, [loadSettings]);

  const save = async () => {
    setSaving(true);
    try {
      const update: Parameters<typeof decisionApi.update>[0] = { base_url: baseUrl, model };
      if (clearApiKey) update.api_key = "";
      else if (apiKey.trim()) update.api_key = apiKey.trim();
      const result = await decisionApi.update(update);
      if (!result.success || !result.data?.success) {
        throw new Error(result.error || "Update failed");
      }
      applySettings(result.data);
      addToast("success", "Decision model settings saved");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Failed to save decision settings"
      );
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    baseUrl !== settings.base_url ||
    model !== settings.model ||
    apiKey.trim().length > 0 ||
    (clearApiKey && settings.has_api_key);

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" /> Decision Models
        </CardTitle>
        <CardDescription>
          Calibrate probabilities and compare options with a dedicated decision model
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-2.5">
          <p className="min-w-0 text-xs leading-relaxed text-[var(--text-muted)]">
            A decision model scores a bounded question set. It does not act, write, or approve, and
            it never replaces your primary model.
          </p>
          <Badge variant={settings.provider_ready ? "success" : "default"}>
            {settings.provider_ready ? "Ready" : settings.model ? "Not configured" : "Disabled"}
          </Badge>
        </div>

        {loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm text-red-300">
              <AlertCircle className="h-4 w-4" />
              {loadError}
            </span>
            <Button variant="outline" size="sm" onClick={() => void loadSettings()}>
              <RotateCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : null}

        <div className="space-y-3.5">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">Model</span>
            <Select value={model} onChange={setModel} aria-label="Decision model">
              <option value="">None</option>
              {settings.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.provider})
                </option>
              ))}
            </Select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">Endpoint</span>
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.typesafe.ai/v1/systemone"
            />
            <span className="text-xs text-[var(--text-muted)]">
              Point this at a local System One server to run without an API key.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">API key</span>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setClearApiKey(false);
                }}
                placeholder={
                  clearApiKey ? "Will be cleared" : settings.has_api_key ? "Saved" : "Not set"
                }
                autoComplete="off"
                disabled={clearApiKey}
              />
              {settings.has_api_key && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setApiKey("");
                    setClearApiKey((value) => !value);
                  }}
                >
                  {clearApiKey ? "Keep key" : "Clear"}
                </Button>
              )}
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {clearApiKey
                ? "The saved key will be removed from this device when you save."
                : "Stored encrypted. Leave blank to keep the saved key."}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadSettings()}>
            <RotateCw className="h-4 w-4" />
            Reload
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || loading || !dirty}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
