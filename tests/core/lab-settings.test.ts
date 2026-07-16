import { afterEach, describe, expect, test } from "bun:test";
import { config, DEFAULT_LAB_SETTINGS, normalizeLabSettings } from "../../src/core/config";
import { isToolEnabledForAgent } from "../../src/core/tools/index";

afterEach(() => {
  config.setLabSettings(DEFAULT_LAB_SETTINGS);
});

describe("lab settings", () => {
  test("defaults to enabled without discarding captured data", () => {
    expect(normalizeLabSettings(undefined)).toEqual(DEFAULT_LAB_SETTINGS);
  });

  test("normalizes partial updates and rejects unknown export formats", () => {
    expect(
      normalizeLabSettings({
        enabled: false,
        goldenTurnsEnabled: false,
        trajectoryCaptureEnabled: false,
        sanitizeExportsByDefault: false,
        defaultExportFormat: "unsupported",
      })
    ).toEqual({
      enabled: false,
      goldenTurnsEnabled: false,
      trajectoryCaptureEnabled: false,
      sanitizeExportsByDefault: false,
      defaultExportFormat: "distillation_sft",
    });
  });

  test("accepts every supported training export format", () => {
    for (const format of [
      "distillation_sft",
      "trl_sft",
      "hf_session_trace",
      "cybara_trace",
      "long_context",
      "prompt_completion",
    ] as const) {
      expect(normalizeLabSettings({ defaultExportFormat: format }).defaultExportFormat).toBe(
        format
      );
    }
  });

  test("withholds Lab tools when the corresponding capability is disabled", () => {
    config.setLabSettings({ enabled: false });
    expect(isToolEnabledForAgent("eval_save")).toBe(false);
    expect(isToolEnabledForAgent("eval_replay")).toBe(false);

    config.setLabSettings({ enabled: true, goldenTurnsEnabled: false });
    expect(isToolEnabledForAgent("eval_save")).toBe(false);
    expect(isToolEnabledForAgent("eval_replay")).toBe(true);
  });
});
