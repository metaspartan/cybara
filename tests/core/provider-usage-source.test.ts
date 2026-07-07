import { describe, expect, test } from "bun:test";
import {
  parseAnthropicUsageResponse,
  parseCodexUsageResponse,
} from "../../src/core/provider-usage-source";

// Real shape captured from chatgpt.com/backend-api/wham/usage.
const CODEX_BODY = {
  plan_type: "pro",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 42,
      limit_window_seconds: 18000,
      reset_at: 1783405927,
    },
    secondary_window: {
      used_percent: 62,
      limit_window_seconds: 604800,
      reset_at: 1783665881,
    },
  },
};

describe("parseCodexUsageResponse", () => {
  test("maps primary/secondary windows to 5h/weekly with reset times", () => {
    const result = parseCodexUsageResponse(CODEX_BODY, 1000);
    expect(result?.planLabel).toBe("Codex Pro");
    expect(result?.fiveHour?.usedPercent).toBe(42);
    expect(result?.fiveHour?.windowSeconds).toBe(18000);
    expect(result?.fiveHour?.resetsAt).toBe(new Date(1783405927 * 1000).toISOString());
    expect(result?.weekly?.usedPercent).toBe(62);
    expect(result?.weekly?.resetsAt).toBe(new Date(1783665881 * 1000).toISOString());
    expect(result?.source).toBe("oauth_api");
    expect(result?.fetchedAt).toBe(1000);
  });

  test("returns null when rate_limit is absent", () => {
    expect(parseCodexUsageResponse({ plan_type: "pro" }, 1)).toBeNull();
    expect(parseCodexUsageResponse(null, 1)).toBeNull();
  });

  test("clamps out-of-range percentages", () => {
    const result = parseCodexUsageResponse(
      { rate_limit: { primary_window: { used_percent: 150 } } },
      1
    );
    expect(result?.fiveHour?.usedPercent).toBe(100);
  });
});

describe("parseAnthropicUsageResponse", () => {
  test("maps five_hour/seven_day windows and plan tier", () => {
    const result = parseAnthropicUsageResponse(
      {
        subscriptionType: "Max",
        five_hour: { used_percent: 30, resets_at: 1783405927 },
        seven_day: { utilization: 55 },
      },
      500
    );
    expect(result?.planLabel).toBe("Claude Max");
    expect(result?.fiveHour?.usedPercent).toBe(30);
    expect(result?.weekly?.usedPercent).toBe(55);
    expect(result?.fetchedAt).toBe(500);
  });

  test("returns null on an empty/unknown body", () => {
    expect(parseAnthropicUsageResponse({}, 1)).toBeNull();
    expect(parseAnthropicUsageResponse(null, 1)).toBeNull();
  });
});
