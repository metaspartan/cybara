import { describe, expect, test } from "bun:test";
import {
  boundedPoolRetryDelayMs,
  parseProviderRetryAfterMs,
  providerExceptionRetryDelayMs,
  providerRetryDelayMs,
  resolveProviderRetryPolicy,
} from "../../src/core/provider-retry";

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

  test("gives Kimi coding sessions a longer bounded transient recovery budget", () => {
    expect(resolveProviderRetryPolicy("kimi-code-oauth")).toEqual({
      maxRetries: 5,
      maxDelayMs: 180_000,
    });
    expect(resolveProviderRetryPolicy("openai")).toEqual({
      maxRetries: 3,
      maxDelayMs: 120_000,
    });
    expect(
      providerExceptionRetryDelayMs(new Error("fetch failed: ECONNRESET"), 4, undefined, () => 0, 5)
    ).toBe(8_000);
  });
});
