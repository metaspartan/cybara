import { describe, expect, test } from "bun:test";
import {
  normalizeProviderSettings,
  readDevinProviderSettings,
} from "../../src/core/provider-settings";

describe("provider settings", () => {
  test("normalizes Devin transport settings", () => {
    const normalized = normalizeProviderSettings("devin", {
      organizationId: "org_123",
      pollIntervalMs: 2500,
      timeoutMs: 900000,
    });

    expect(readDevinProviderSettings(normalized)).toEqual({
      organizationId: "org_123",
      pollIntervalMs: 2500,
      timeoutMs: 900000,
    });
  });

  test("rejects settings for providers without a settings contract", () => {
    expect(normalizeProviderSettings("openai", { accountPool: true })).toBeUndefined();
  });
});
