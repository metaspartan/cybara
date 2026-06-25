import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  getProviderAvailability,
  getRouterStatus,
  recordUsage,
  resetRouterForTests,
  selectProvider,
  type RouterConfig,
} from "../../src/core/router";

afterEach(() => {
  resetRouterForTests();
  config.set("router", null);
});

function setRouterConfig(cfg: Partial<RouterConfig>): void {
  config.set("router", {
    enabled: true,
    strategy: "weighted",
    fallbackToAny: true,
    routes: {},
    ...cfg,
  });
}

describe("model router availability + limits", () => {
  test("provider is available when router is disabled", () => {
    config.set("router", null);
    const avail = getProviderAvailability("openai");
    expect(avail.available).toBe(true);
  });

  test("5h rate limit blocks provider when exceeded", () => {
    setRouterConfig({
      routes: { openai: { weight: 50, limit5h: 2 } },
    });
    recordUsage("openai", 100, 50, true);
    recordUsage("openai", 100, 50, true);
    const avail = getProviderAvailability("openai");
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain("5h rate limit");
  });

  test("weekly rate limit blocks provider when exceeded", () => {
    setRouterConfig({
      routes: { anthropic: { weight: 50, limitWeekly: 1 } },
    });
    recordUsage("anthropic", 100, 50, true);
    const avail = getProviderAvailability("anthropic");
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain("Weekly");
  });

  test("daily spend limit blocks provider when exceeded", () => {
    setRouterConfig({
      routes: {
        openai: {
          weight: 50,
          spendLimitDaily: 1.0,
          priceInputPerM: 10,
          priceOutputPerM: 30,
        },
      },
    });
    // 200k input + 200k output = $2 + $6 = $8 total, exceeds $1 limit.
    recordUsage("openai", 200_000, 200_000, true);
    const avail = getProviderAvailability("openai");
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain("Daily spend");
  });

  test("global spend limit blocks all providers when exceeded", () => {
    setRouterConfig({
      globalSpendLimitDaily: 1.0,
      routes: {
        openai: { weight: 50, priceInputPerM: 10 },
        anthropic: { weight: 50, priceInputPerM: 10 },
      },
    });
    recordUsage("openai", 200_000, 0, true);
    const avail = getProviderAvailability("anthropic");
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain("Global daily spend");
  });

  test("disabled route is not available", () => {
    setRouterConfig({
      routes: { openai: { weight: 50, enabled: false } },
    });
    expect(getProviderAvailability("openai").available).toBe(false);
  });
});

describe("model router provider selection", () => {
  test("returns preferred provider when available", () => {
    setRouterConfig({
      routes: { openai: { weight: 50 }, anthropic: { weight: 50 } },
    });
    const selected = selectProvider("openai");
    expect(selected).toBe("openai");
  });

  test("falls back to another configured provider when preferred is unavailable", () => {
    setRouterConfig({
      routes: {
        openai: { weight: 50, limit5h: 1 },
        anthropic: { weight: 50 },
      },
    });
    recordUsage("openai", 10, 10, true); // exhaust openai's 5h limit
    const selected = selectProvider("openai");
    expect(selected).toBe("anthropic");
  });

  test("round_robin strategy alternates", () => {
    setRouterConfig({
      strategy: "round_robin",
      routes: { openai: { weight: 50 }, anthropic: { weight: 50 } },
    });
    const first = selectProvider();
    const second = selectProvider();
    expect(first).not.toBe(second);
  });

  test("returns null when all configured providers are exhausted and no fallback", () => {
    setRouterConfig({
      fallbackToAny: false,
      routes: {
        openai: { weight: 50, limit5h: 0 },
        anthropic: { weight: 50, limit5h: 0 },
      },
    });
    // limit5h=0 means unlimited, so manually disable both.
    config.set("router", {
      enabled: true,
      strategy: "weighted",
      fallbackToAny: false,
      routes: {
        openai: { weight: 50, enabled: false },
        anthropic: { weight: 50, enabled: false },
      },
    });
    expect(selectProvider()).toBeNull();
  });
});

describe("model router status + spend tracking", () => {
  test("getRouterStatus returns structured state", () => {
    setRouterConfig({
      globalSpendLimitDaily: 10,
      routes: { openai: { weight: 70, priceInputPerM: 5 } },
    });
    recordUsage("openai", 1_000_000, 0, true); // $5
    const status = getRouterStatus();
    expect(status.enabled).toBe(true);
    expect(status.routes.length).toBe(1);
    expect(status.routes[0].spendToday).toBeCloseTo(5, 1);
    expect(status.globalSpendToday).toBeCloseTo(5, 1);
  });
});
