import { describe, expect, test } from "bun:test";
import {
  parseAntigravityUsageResponse,
  parseAnthropicUsageResponse,
  parseCodexUsageResponse,
  parseGrokUsageResponse,
  parseKimiUsageResponse,
  parseMiniMaxUsageResponse,
  parseOpenCodeUsageResponse,
  parseZaiUsageResponse,
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
        five_hour: { utilization: 30, resets_at: "2026-07-07T10:00:00Z" },
        seven_day: { utilization: 55 },
      },
      500
    );
    expect(result?.planLabel).toBe("Claude Max");
    expect(result?.fiveHour?.usedPercent).toBe(30);
    expect(result?.fiveHour?.resetsAt).toBe("2026-07-07T10:00:00Z");
    expect(result?.weekly?.usedPercent).toBe(55);
    expect(result?.fetchedAt).toBe(500);
  });

  test("maps scoped weekly limits when seven_day is absent", () => {
    const result = parseAnthropicUsageResponse(
      {
        subscription_type: "Pro",
        five_hour: { utilization: 12 },
        limits: [
          { kind: "daily", group: "daily", percent: 90 },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 71,
            resets_at: "2026-07-14T10:00:00Z",
            is_active: true,
          },
        ],
      },
      600
    );
    expect(result?.planLabel).toBe("Claude Pro");
    expect(result?.weekly?.usedPercent).toBe(71);
    expect(result?.weekly?.resetsAt).toBe("2026-07-14T10:00:00Z");
  });

  test("returns null on an empty/unknown body", () => {
    expect(parseAnthropicUsageResponse({}, 1)).toBeNull();
    expect(parseAnthropicUsageResponse({ subscriptionType: "Max" }, 1)).toBeNull();
    expect(parseAnthropicUsageResponse(null, 1)).toBeNull();
  });
});

describe("parseMiniMaxUsageResponse", () => {
  test("maps token-plan remaining quota into used 5h and weekly percentages", () => {
    const result = parseMiniMaxUsageResponse(
      {
        model_remains: [
          {
            model_name: "MiniMax-M*",
            end_time: 1783405927000,
            current_interval_total_count: 1500,
            current_interval_usage_count: 228,
            weekly_end_time: 1783665881000,
            current_weekly_total_count: 15000,
            current_weekly_usage_count: 6000,
          },
        ],
      },
      700
    );

    expect(result?.planLabel).toBe("MiniMax Token Plan");
    expect(result?.source).toBe("provider_api");
    expect(result?.fiveHour?.usedPercent).toBeCloseTo(84.8, 1);
    expect(result?.fiveHour?.resetsAt).toBe(new Date(1783405927000).toISOString());
    expect(result?.weekly?.usedPercent).toBe(60);
    expect(result?.weekly?.resetsAt).toBe(new Date(1783665881000).toISOString());
  });

  test("uses server remaining percentages and handles unlimited weekly quota", () => {
    const result = parseMiniMaxUsageResponse(
      {
        model_remains: [
          {
            model_name: "MiniMax-M3",
            current_interval_remaining_percent: 35,
            current_weekly_status: 3,
            weekly_end_time: 1783665881000,
          },
        ],
      },
      701
    );

    expect(result?.fiveHour?.usedPercent).toBe(65);
    expect(result?.weekly?.usedPercent).toBe(0);
    expect(result?.weekly?.unlimited).toBe(true);
  });
});

describe("parseAntigravityUsageResponse", () => {
  test("maps grouped quota summaries into five-hour and weekly windows", () => {
    const result = parseAntigravityUsageResponse(
      {
        response: {
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                {
                  bucketId: "gemini-5h",
                  displayName: "5-hour limit",
                  remaining: { remainingFraction: 0.91 },
                  resetTime: "2026-06-15T11:39:34Z",
                },
                {
                  bucketId: "gemini-weekly",
                  displayName: "Weekly limit",
                  remainingFraction: 0.82,
                  resetTime: "2026-06-19T08:45:39Z",
                },
              ],
            },
            {
              displayName: "Claude and GPT models",
              buckets: [
                {
                  bucketId: "3p-5h",
                  displayName: "5-hour limit",
                  remaining: { case: "remainingFraction", value: 0.73 },
                },
                {
                  bucketId: "3p-weekly",
                  displayName: "Weekly limit",
                  remaining: { remainingFraction: 0.64 },
                },
              ],
            },
          ],
        },
      },
      750
    );

    expect(result?.planLabel).toBe("Antigravity");
    expect(result?.source).toBe("oauth_api");
    expect(result?.fiveHour?.usedPercent).toBeCloseTo(27, 0);
    expect(result?.fiveHour?.resetsAt).toBeUndefined();
    expect(result?.weekly?.usedPercent).toBe(36);
    expect(result?.weekly?.resetsAt).toBeUndefined();
    expect(result?.fetchedAt).toBe(750);
  });

  test("falls back to legacy model quota buckets", () => {
    const result = parseAntigravityUsageResponse(
      {
        models: {
          "gemini-3-pro": {
            displayName: "Gemini 3 Pro",
            quotaInfo: {
              remainingFraction: 0.8,
              resetTime: "2026-06-15T11:39:34Z",
            },
          },
          "claude-sonnet-4": {
            displayName: "Claude Sonnet 4",
            quotaInfo: { remainingFraction: 0.5 },
          },
        },
      },
      751
    );

    expect(result?.fiveHour?.usedPercent).toBe(50);
    expect(result?.weekly).toBeUndefined();
  });
});

describe("parseZaiUsageResponse", () => {
  test("maps quota-limit token and time percentages into five-hour and weekly windows", () => {
    const result = parseZaiUsageResponse(
      {
        data: {
          limits: [
            { type: "TIME_LIMIT", percentage: 7, nextResetTime: 1783984001998 },
            { type: "TOKENS_LIMIT", percentage: 44, nextResetTime: 1783489036671 },
          ],
        },
      },
      800
    );

    expect(result?.planLabel).toBe("GLM Coding Plan");
    expect(result?.source).toBe("provider_api");
    expect(result?.fiveHour?.usedPercent).toBe(44);
    expect(result?.fiveHour?.resetsAt).toBe(new Date(1783489036671).toISOString());
    expect(result?.weekly?.usedPercent).toBe(7);
    expect(result?.weekly?.resetsAt).toBe(new Date(1783984001998).toISOString());
    expect(result?.fetchedAt).toBe(800);
  });

  test("returns null when no token quota limit is present", () => {
    expect(
      parseZaiUsageResponse({ data: { limits: [{ type: "TIME_LIMIT", percentage: 7 }] } }, 1)
    ).toBeNull();
    expect(parseZaiUsageResponse({}, 1)).toBeNull();
  });
});

describe("parseKimiUsageResponse", () => {
  test("maps coding-plan usage payloads into 5h, weekly, and monthly windows", () => {
    const result = parseKimiUsageResponse(
      {
        usage: { name: "Weekly Usage", limit: 1000, used: 300, resetTime: 1783665881000 },
        limits: [
          {
            detail: { name: "Fast 5h", limit: 100, remaining: 25, reset_in: 3600 },
            window: { duration: 5, time_unit: "HOUR" },
          },
          {
            detail: { name: "Monthly", percent: 41, reset_at: "2026-07-31T00:00:00Z" },
            window: { duration: 1, time_unit: "MONTH" },
          },
        ],
      },
      900
    );

    expect(result?.planLabel).toBe("Kimi Coding Plan");
    expect(result?.source).toBe("provider_api");
    expect(result?.weekly?.usedPercent).toBe(30);
    expect(result?.weekly?.resetsAt).toBe(new Date(1783665881000).toISOString());
    expect(result?.fiveHour?.usedPercent).toBe(75);
    expect(result?.fiveHour?.resetsAt).toBe(new Date(900 + 3600_000).toISOString());
    expect(result?.monthly?.usedPercent).toBe(41);
    expect(result?.monthly?.resetsAt).toBe("2026-07-31T00:00:00Z");
  });

  test("maps Kimi data-list summaries and returns null for unknown shapes", () => {
    const result = parseKimiUsageResponse(
      {
        data: [
          { model_name: "all", limit: 1000, used: 450 },
          { name: "5h Limit", limit: 100, used: 20 },
        ],
      },
      901
    );

    expect(result?.weekly?.usedPercent).toBe(45);
    expect(result?.fiveHour?.usedPercent).toBe(20);
    expect(parseKimiUsageResponse({ data: [{ name: "unknown" }] }, 1)).toBeNull();
  });
});

describe("parseGrokUsageResponse", () => {
  test("maps Grok billing JSON-RPC results into a monthly usage window", () => {
    const result = parseGrokUsageResponse(
      {
        result: {
          billingCycle: {
            billingPeriodEnd: "2026-08-01T00:00:00Z",
          },
          monthlyLimit: { val: 99900 },
          usage: {
            totalUsed: { val: 24975 },
          },
        },
      },
      902
    );

    expect(result?.planLabel).toBe("Grok Build");
    expect(result?.source).toBe("cli");
    expect(result?.monthly?.usedPercent).toBe(25);
    expect(result?.monthly?.resetsAt).toBe("2026-08-01T00:00:00Z");
  });
});

describe("parseOpenCodeUsageResponse", () => {
  test("maps OpenCode Go usage windows from dashboard payloads", () => {
    const result = parseOpenCodeUsageResponse(
      {
        data: {
          renewAt: "2026-08-01T00:00:00Z",
          usage: {
            rollingUsage: { usagePercent: 12.5, resetInSec: 3600 },
            weeklyUsage: { used: 44, limit: 100, resetAt: "2026-07-14T00:00:00Z" },
            monthlyUsage: { usage_percent: 65 },
          },
        },
      },
      903
    );

    expect(result?.planLabel).toBe("OpenCode Go");
    expect(result?.source).toBe("browser_cookie");
    expect(result?.fiveHour?.usedPercent).toBe(12.5);
    expect(result?.fiveHour?.resetsAt).toBe(new Date(903 + 3600_000).toISOString());
    expect(result?.weekly?.usedPercent).toBe(44);
    expect(result?.weekly?.resetsAt).toBe("2026-07-14T00:00:00Z");
    expect(result?.monthly?.usedPercent).toBe(65);
  });
});
