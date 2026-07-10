import { describe, expect, test } from "bun:test";
import { hasProviderIcon } from "../../ui/src/components/ProviderIcon";

describe("provider icon lookup", () => {
  test("recognizes canonical providers and OAuth aliases", () => {
    expect(hasProviderIcon("openai")).toBe(true);
    expect(hasProviderIcon("openai-codex")).toBe(true);
    expect(hasProviderIcon("xai-oauth")).toBe(true);
    expect(hasProviderIcon("minimax-portal")).toBe(true);
    expect(hasProviderIcon("z.ai-coding")).toBe(true);
  });

  test("normalizes provider identifiers", () => {
    expect(hasProviderIcon("  ZAI  ")).toBe(true);
    expect(hasProviderIcon("GOOGLE_VERTEX")).toBe(true);
  });

  test("rejects missing and unknown providers", () => {
    expect(hasProviderIcon()).toBe(false);
    expect(hasProviderIcon(null)).toBe(false);
    expect(hasProviderIcon("custom-provider")).toBe(false);
  });
});
