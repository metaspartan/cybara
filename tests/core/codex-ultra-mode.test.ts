import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODEX_FAST_MODE_SERVICE_TIER,
  CODEX_ULTRAFAST_MODE_SERVICE_TIER,
  codexServiceTier,
  codexUltrafastServiceTier,
  supportsCodexFastMode,
  supportsCodexUltrafastMode,
} from "../../shared/codex-fast-mode";
import { supportedReasoningEfforts } from "../../shared/reasoning-capabilities";
import { shouldShowCodexUltrafastMode } from "../../ui/src/pages/chat/ChatFastModeToggle";

describe("codex fast and ultra mode model matching", () => {
  test("gpt-6.1-sol is fast capable even though its version is dotted", () => {
    expect(supportsCodexFastMode("gpt-6.1-sol")).toBe(true);
    expect(codexUltrafastServiceTier(true, "gpt-6.1-sol")).toBeNull();
  });

  test("fast capability follows the numeric version, not a string prefix", () => {
    expect(supportsCodexFastMode("gpt-6.2-sol")).toBe(true);
    expect(supportsCodexFastMode("gpt-6.10-sol")).toBe(true);
    expect(supportsCodexFastMode("gpt-7-sol")).toBe(true);
    expect(supportsCodexFastMode("gpt-5.6-sol")).toBe(true);
    expect(supportsCodexFastMode("gpt-5.4-mini")).toBe(true);
  });

  test("models below the fast-mode threshold stay unsupported", () => {
    expect(supportsCodexFastMode("gpt-5.3-codex")).toBe(false);
    expect(supportsCodexFastMode("gpt-5.2")).toBe(false);
    expect(supportsCodexFastMode("gpt-5.1-codex-max")).toBe(false);
    expect(supportsCodexFastMode("gpt-5-pro")).toBe(false);
  });

  test("reduced-cost suffixes are still excluded from fast mode", () => {
    expect(supportsCodexFastMode("gpt-6.1-pro")).toBe(false);
    expect(supportsCodexFastMode("gpt-6.1-nano")).toBe(false);
    expect(supportsCodexFastMode("gpt-6.1-spark")).toBe(false);
    expect(supportsCodexFastMode("gpt-5.4-nano")).toBe(false);
  });

  test("blank and non-string model ids are not fast capable", () => {
    expect(supportsCodexFastMode("")).toBe(false);
    expect(supportsCodexFastMode("   ")).toBe(false);
    expect(supportsCodexFastMode(null)).toBe(false);
    expect(supportsCodexFastMode(undefined)).toBe(false);
  });

  test("ultrafast is offered only for the astra tier", () => {
    expect(supportsCodexUltrafastMode("gpt-6-astra")).toBe(true);
    expect(codexUltrafastServiceTier(true, "gpt-6-astra")).toBe(CODEX_ULTRAFAST_MODE_SERVICE_TIER);
    expect(supportsCodexUltrafastMode("gpt-6.1-sol")).toBe(false);
    expect(supportsCodexUltrafastMode("gpt-6-sol")).toBe(false);
    expect(supportsCodexUltrafastMode("gpt-6-luna")).toBe(false);
    expect(supportsCodexUltrafastMode("gpt-5.6-sol")).toBe(false);
    expect(supportsCodexUltrafastMode("gpt-6-astral")).toBe(false);
    expect(codexUltrafastServiceTier(false, "gpt-6-astra")).toBeNull();
  });

  test("ultra takes precedence over fast and both stay off when disabled", () => {
    expect(codexServiceTier({ fastMode: true, ultrafastMode: true, modelId: "gpt-6-astra" })).toBe(
      CODEX_ULTRAFAST_MODE_SERVICE_TIER
    );
    expect(codexServiceTier({ fastMode: true, ultrafastMode: false, modelId: "gpt-6-astra" })).toBe(
      CODEX_FAST_MODE_SERVICE_TIER
    );
    expect(
      codexServiceTier({ fastMode: false, ultrafastMode: true, modelId: "gpt-6.1-sol" })
    ).toBeNull();
    expect(
      codexServiceTier({ fastMode: false, ultrafastMode: false, modelId: "gpt-6-astra" })
    ).toBeNull();
  });

  test("the ultra toggle is scoped to the codex provider", () => {
    expect(shouldShowCodexUltrafastMode("openai-codex", "gpt-6-astra")).toBe(true);
    expect(shouldShowCodexUltrafastMode("openai-codex", "gpt-6.1-sol")).toBe(false);
    expect(shouldShowCodexUltrafastMode("openai", "gpt-6-astra")).toBe(false);
    expect(shouldShowCodexUltrafastMode(null, "gpt-6-astra")).toBe(false);
  });

  test("gpt-6.1-sol exposes the full effort range including extra high and max", () => {
    for (const providerId of ["openai", "openai-codex"]) {
      expect(supportedReasoningEfforts(providerId, "gpt-6.1-sol")).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
    }
    expect(supportedReasoningEfforts("openai", "gpt-6.1-sol")).not.toContain("minimal");
  });

  test("the runtime resolves the service tier through the shared helper", () => {
    const runtime = readFileSync(
      join(process.cwd(), "src/core/agent-provider-codex-runtime.ts"),
      "utf8"
    );
    expect(runtime).toContain("import { codexServiceTier }");
    expect(runtime).toContain("ultrafastMode: config.getCodexUltrafastMode()");
    expect(runtime).toContain("requestBody.service_tier = serviceTier");
    expect(runtime).not.toContain("fastModeTier");
  });

  test("the config surface persists the ultra toggle", () => {
    const config = readFileSync(join(process.cwd(), "src/core/config.ts"), "utf8");
    expect(config).toContain("getCodexUltrafastMode()");
    expect(config).toContain('this.set("codex_ultrafast_mode", value)');
    const routes = readFileSync(join(process.cwd(), "src/api/routes.ts"), "utf8");
    expect(routes).toContain("codex_ultrafast_mode: config.getCodexUltrafastMode()");
    expect(routes).toContain("config.setCodexUltrafastMode(value)");
  });
});
