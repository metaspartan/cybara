import { describe, expect, test } from "bun:test";
import {
  isRateLimited,
  msUntilReset,
  parseRateLimitHeaders,
  recordRateLimit,
} from "../../src/core/rate-limit-tracker";

describe("parseRateLimitHeaders", () => {
  test("parses Anthropic-style remaining/limit/reset headers", () => {
    const headers = new Headers({
      "x-ratelimit-remaining-requests": "42",
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-reset-requests": "60",
    });
    const { requests } = parseRateLimitHeaders(headers);
    expect(requests?.remaining).toBe(42);
    expect(requests?.limit).toBe(1000);
    expect(requests?.resetSeconds).toBe(60);
    expect(typeof requests?.resetAt).toBe("number");
  });

  test("parses token-tier headers separately", () => {
    const headers = new Headers({
      "x-ratelimit-remaining-tokens": "5000",
      "x-ratelimit-reset-tokens": "30",
    });
    const { requests, tokens } = parseRateLimitHeaders(headers);
    expect(requests).toBeUndefined();
    expect(tokens?.remaining).toBe(5000);
    expect(tokens?.resetSeconds).toBe(30);
  });

  test("returns undefined when no rate-limit headers present", () => {
    const { requests, tokens } = parseRateLimitHeaders(new Headers());
    expect(requests).toBeUndefined();
    expect(tokens).toBeUndefined();
  });
});

describe("rate-limit state tracking", () => {
  test("isRateLimited is true when remaining is 0", () => {
    const key = `test-exhausted-${Date.now()}`;
    recordRateLimit(key, new Headers({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "60" }));
    expect(isRateLimited(key)).toBe(true);
  });

  test("isRateLimited is false when remaining is positive", () => {
    const key = `test-ok-${Date.now()}`;
    recordRateLimit(key, new Headers({ "x-ratelimit-remaining-requests": "5" }));
    expect(isRateLimited(key)).toBe(false);
  });

  test("isRateLimited clears after the reset window elapses", () => {
    const key = `test-reset-${Date.now()}`;
    // resetSeconds of 0 means resetAt is now (already elapsed).
    recordRateLimit(key, new Headers({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "0" }));
    expect(isRateLimited(key)).toBe(false);
  });

  test("msUntilReset is 0 when unknown or elapsed", () => {
    const key = `test-unknown-${Date.now()}`;
    expect(msUntilReset(key)).toBe(0);
    recordRateLimit(key, new Headers({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "0" }));
    expect(msUntilReset(key)).toBe(0);
  });
});
