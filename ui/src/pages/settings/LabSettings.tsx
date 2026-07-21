import {
  AlertCircle,
  BrainCircuit,
  Database,
  ExternalLink,
  FlaskConical,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { type LabSettings, type ResearchExportFormat, settingsApi } from "@/lib/api";
import { labExportFormatDescription, labExportFormats } from "@/lib/labFormats";
import { defaultLabSettings, readLabSettings } from "@/lib/labSettings";
import { useUIStore } from "@/stores/uiStore";

export function LabSettingsSection() {
  const { addToast } = useUIStore();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<LabSettings>(defaultLabSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await settingsApi.getConfig();
      if (!response.success) throw new Error(response.error || "Failed to load Lab settings");
      setSettings(readLabSettings(response.data?.lab));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load Lab settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const update = async (patch: Partial<LabSettings>) => {
    if (loading || saving || loadError) return;
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const response = await settingsApi.updateConfig({ lab: next });
      if (!response.success || response.data?.success === false) {
        throw new Error(response.error || "Failed to update Lab settings");
      }
      addToast("success", "Lab settings updated");
    } catch (error) {
      setSettings(previous);
      addToast("error", error instanceof Error ? error.message : "Failed to update Lab settings");
    } finally {
      setSaving(false);
    }
  };
  const controlsDisabled = loading || saving || !!loadError;

  return (
    <div className="space-y-6">
      {loadError && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-red-400/25 bg-red-400/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Lab settings unavailable
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{loadError}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => void loadSettings()} disabled={loading}>
            <RotateCcw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Retry
          </Button>
        </div>
      )}
      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
            Lab availability
          </CardTitle>
          <CardDescription>
            Control local experiment, benchmark, trace, and dataset features without deleting saved
            data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Switch
            checked={settings.enabled}
            onChange={(enabled) => void update({ enabled })}
            disabled={controlsDisabled}
            label="Enable Lab"
            description="Expose Lab pages and APIs, replay evals, and allow dataset exports."
          />
          <Switch
            checked={settings.goldenTurnsEnabled}
            onChange={(goldenTurnsEnabled) => void update({ goldenTurnsEnabled })}
            disabled={controlsDisabled || !settings.enabled}
            label="Show golden turn actions"
            description="Allow completed assistant turns to be saved as replayable golden tests."
          />
          <Switch
            checked={settings.trajectoryCaptureEnabled}
            onChange={(trajectoryCaptureEnabled) => void update({ trajectoryCaptureEnabled })}
            disabled={controlsDisabled || !settings.enabled}
            label="Capture completed turns"
            description="Record replayable prompts, responses, observable reasoning, and tool I/O locally."
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              disabled={controlsDisabled || !settings.enabled}
              onClick={() => navigate("/lab")}
            >
              Open Lab
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card variant="liquid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
            Training exports
          </CardTitle>
          <CardDescription>
            Choose safe defaults for curated datasets, sequence distillation, and agent trace
            research.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Switch
            checked={settings.sanitizeExportsByDefault}
            onChange={(sanitizeExportsByDefault) => void update({ sanitizeExportsByDefault })}
            disabled={controlsDisabled || !settings.enabled}
            label="Redact exports by default"
            description="Remove prompt content, workspace paths, reasoning text, tool arguments, and tool output unless explicitly changed."
          />
          <Select
            label="Default dataset format"
            value={settings.defaultExportFormat}
            options={[...labExportFormats]}
            helperText={labExportFormatDescription(settings.defaultExportFormat)}
            onChange={(value) =>
              void update({ defaultExportFormat: value as ResearchExportFormat })
            }
            disabled={controlsDisabled || !settings.enabled}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3">
              <BrainCircuit className="h-4 w-4 text-[rgb(var(--accent-primary))]" />
              <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
                Honest distillation
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                Exports teacher responses, model provenance, observable reasoning, and tool behavior
                without inventing hidden logits.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3">
              <ShieldCheck className="h-4 w-4 text-[rgb(var(--accent-primary))]" />
              <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">
                Publish deliberately
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                Generated dataset cards document sources, splits, redaction state, intended uses,
                and limitations.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
