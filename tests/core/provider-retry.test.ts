import { describe, expect, test } from "bun:test";
import {
  boundedPoolRetryDelayMs,
  parseProviderRetryAfterMs,
  providerExceptionRetryDelayMs,
  providerRetryDelayMs,
  resolveProviderRetryPolicy,
} from "../../src/core/provider-retry";

const codexRuntimeSource = await Bun.file(
  new URL("../../src/core/agent-provider-codex-runtime.ts", import.meta.url)
).text();

describe("provider retry policy", () => {
  test("parses millisecond, second, and HTTP-date retry hints", () => {
    expect(parseProviderRetryAfterMs(new Headers({ "retry-after-ms": "125" }), 999, 1_000)).toBe(
      125
    );
    expect(parseProviderRetryAfterMs(new Headers({ "retry-after": "2.5" }), 999, 1_000)).toBe(
      2_500
    );
    expect(
      parseProviderRetryAfterMs(
        new Headers({ "retry-after": new Date(6_000).toUTCString() }),
        999,
        1_000
      )
    ).toBe(5_000);
  });

  test("uses bounded exponential backoff with nonnegative jitter", () => {
    expect(providerRetryDelayMs(503, new Headers(), 0, () => 0)).toBe(1_000);
    expect(providerRetryDelayMs(503, new Headers(), 2, () => 1)).toBe(4_250);
    expect(providerRetryDelayMs(503, new Headers(), 10, () => 0)).toBe(8_000);
    expect(providerRetryDelayMs(429, new Headers(), 5, () => 0)).toBe(30_000);
    expect(providerRetryDelayMs(429, new Headers(), 10, () => 0)).toBe(30_000);
  });

  test("does not retry caller aborts or non-transient errors", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      providerExceptionRetryDelayMs(new Error("fetch failed: ECONNRESET"), 0, controller.signal)
    ).toBeUndefined();
    expect(providerExceptionRetryDelayMs(new Error("invalid request"), 0)).toBeUndefined();
  });

  test("does not allow an empty credential pool to create an infinite delay", () => {
    expect(boundedPoolRetryDelayMs(Number.POSITIVE_INFINITY, 1_250)).toBe(1_250);
    expect(boundedPoolRetryDelayMs(3_000, 1_250)).toBe(3_000);
  });

  test("gives subscription coding sessions a longer bounded transient recovery budget", () => {
    expect(resolveProviderRetryPolicy("kimi-code-oauth")).toEqual({
      maxRetries: 5,
      maxDelayMs: 180_000,
    });
    expect(resolveProviderRetryPolicy("openai-codex")).toEqual({
      maxRetries: 5,
      maxDelayMs: 180_000,
    });
    expect(resolveProviderRetryPolicy("openai")).toEqual({
      maxRetries: 5,
      maxDelayMs: 120_000,
    });
    expect(
      providerExceptionRetryDelayMs(new Error("fetch failed: ECONNRESET"), 4, undefined, () => 0, 5)
    ).toBe(8_000);
  });

  test("uses the provider retry policy in the Codex and Grok transport", () => {
    expect(codexRuntimeSource).toContain(
      "resolveProviderRetryPolicy(rateLimitContext?.providerType)"
    );
    expect(codexRuntimeSource).toContain("transientRetryCount < retryPolicy.maxRetries");
    expect(codexRuntimeSource).toContain("retryDelayMs <= retryPolicy.maxDelayMs");
    expect(codexRuntimeSource).not.toContain("transientRetryCount < 3");
    expect(codexRuntimeSource).not.toContain("${transientRetryCount}/3");
  });
});
