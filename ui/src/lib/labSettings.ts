import type { LabSettings, ResearchExportFormat } from "./api";

export const defaultLabSettings: LabSettings = {
  enabled: true,
  goldenTurnsEnabled: true,
  trajectoryCaptureEnabled: true,
  sanitizeExportsByDefault: true,
  defaultExportFormat: "distillation_sft",
};

const exportFormats = new Set<ResearchExportFormat>([
  "distillation_sft",
  "trl_sft",
  "hf_session_trace",
  "cybara_trace",
  "long_context",
  "prompt_completion",
]);

export function readLabSettings(value: unknown): LabSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const format = record.defaultExportFormat;
  return {
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : defaultLabSettings.enabled,
    goldenTurnsEnabled:
      typeof record.goldenTurnsEnabled === "boolean"
        ? record.goldenTurnsEnabled
        : defaultLabSettings.goldenTurnsEnabled,
    trajectoryCaptureEnabled:
      typeof record.trajectoryCaptureEnabled === "boolean"
        ? record.trajectoryCaptureEnabled
        : defaultLabSettings.trajectoryCaptureEnabled,
    sanitizeExportsByDefault:
      typeof record.sanitizeExportsByDefault === "boolean"
        ? record.sanitizeExportsByDefault
        : defaultLabSettings.sanitizeExportsByDefault,
    defaultExportFormat:
      typeof format === "string" && exportFormats.has(format as ResearchExportFormat)
        ? (format as ResearchExportFormat)
        : defaultLabSettings.defaultExportFormat,
  };
}
