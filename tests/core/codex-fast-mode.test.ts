import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODEX_FAST_MODE_SERVICE_TIER,
  codexFastModeServiceTier,
  supportsCodexFastMode,
} from "../../shared/codex-fast-mode";
import { shouldShowCodexFastMode } from "../../ui/src/pages/chat/ChatFastModeToggle";

describe("codex fast mode", () => {
  test("covers the model families OpenAI documents as fast capable", () => {
    for (const model of [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.5",
      "gpt-5.6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]) {
      expect(`${model}:${supportsCodexFastMode(model)}`).toBe(`${model}:true`);
    }
  });

  test("leaves older families and separate models alone", () => {
    for (const model of [
      "gpt-5.1",
      "gpt-5.1-codex-max",
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-4o",
      "glm-5.2",
      "",
    ]) {
      expect(`${model}:${supportsCodexFastMode(model)}`).toBe(`${model}:false`);
    }
    expect(supportsCodexFastMode(null)).toBe(false);
    expect(supportsCodexFastMode(undefined)).toBe(false);
  });

  test("only emits a service tier when the toggle is on and the model qualifies", () => {
    expect(codexFastModeServiceTier(true, "gpt-5.6-luna")).toBe(CODEX_FAST_MODE_SERVICE_TIER);
    expect(codexFastModeServiceTier(false, "gpt-5.6-luna")).toBeNull();
    expect(codexFastModeServiceTier(true, "gpt-5.2-codex")).toBeNull();
  });

  test("gpt-6 models support fast mode except excluded suffixes", () => {
    expect(supportsCodexFastMode("gpt-6")).toBe(true);
    expect(supportsCodexFastMode("gpt-6-astra")).toBe(true);
    expect(supportsCodexFastMode("gpt-6-sol")).toBe(true);
    expect(supportsCodexFastMode("gpt-6-luna")).toBe(true);
    expect(supportsCodexFastMode("gpt-6-pro")).toBe(false);
    expect(supportsCodexFastMode("gpt-6-nano")).toBe(false);
    expect(supportsCodexFastMode("gpt-6-spark")).toBe(false);
    expect(supportsCodexFastMode("GPT-6-Astra")).toBe(true);
    expect(supportsCodexFastMode("gpt-7")).toBe(false);
  });

  test("sends the tier value the Codex backend accepts", () => {
    expect(CODEX_FAST_MODE_SERVICE_TIER).toBe("priority");
  });

  test("the toggle only appears for the Codex provider on a capable model", () => {
    expect(shouldShowCodexFastMode("openai-codex", "gpt-5.6-luna")).toBe(true);
    expect(shouldShowCodexFastMode("openai-codex", "gpt-5.2-codex")).toBe(false);
    expect(shouldShowCodexFastMode("openai", "gpt-5.6-luna")).toBe(false);
    expect(shouldShowCodexFastMode(null, "gpt-5.6-luna")).toBe(false);
  });

  test("the runtime attaches the tier to the request body and defaults to off", () => {
    const runtime = readFileSync(
      join(process.cwd(), "src/core/agent-provider-codex-runtime.ts"),
      "utf8"
    );
    expect(runtime).toContain("codexFastModeServiceTier(config.getCodexFastMode(), activeModelId)");
    expect(runtime).toContain("requestBody.service_tier = fastModeTier");

    const config = readFileSync(join(process.cwd(), "src/core/config.ts"), "utf8");
    expect(config).toContain('this.get<unknown>("codex_fast_mode") === true');
  });
});
