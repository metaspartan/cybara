import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  getProviderAvailability,
  getPricing,
  getRouterStatus,
  recordProviderFailure,
  recordProviderSuccess,
  recordRateLimit,
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

// ─── Pricing DB ─────────────────────────────────────────────────────────────

describe("built-in pricing DB", () => {
  test("getPricing returns stamped Anthropic prices", () => {
    const p = getPricing("anthropic", "claude-opus-4-8");
    expect(p).not.toBeNull();
    expect(p!.inputPerM).toBe(5.0);
    expect(p!.outputPerM).toBe(25.0);
    expect(p!.cacheReadPerM).toBe(0.5);
    expect(p!.cacheWritePerM).toBe(6.25);
  });

  test("getPricing returns stamped DeepSeek prices", () => {
    const p = getPricing("deepseek", "deepseek-chat");
    expect(p!.inputPerM).toBe(0.14);
    expect(p!.outputPerM).toBe(0.28);
  });

  test("getPricing returns estimated OpenAI prices", () => {
    const p = getPricing("openai", "gpt-5.4-mini");
    expect(p!.inputPerM).toBe(0.4);
    expect(p!.outputPerM).toBe(1.6);
  });

  test("getPricing returns null for unknown provider", () => {
    expect(getPricing("unknown-provider")).toBeNull();
  });

  test("getPricing falls back to provider-level match when model unknown", () => {
    const p = getPricing("openai", "nonexistent-model");
    expect(p).not.toBeNull();
    expect(p!.inputPerM).toBeGreaterThan(0);
  });
});

// ─── Availability + limits ──────────────────────────────────────────────────

describe("router availability + limits", () => {
  test("provider available when router disabled", () => {
    config.set("router", null);
    expect(getProviderAvailability("openai").available).toBe(true);
  });

  test("5h rate limit blocks when exceeded", () => {
    setRouterConfig({ routes: { openai: { weight: 50, limit5h: 2 } } });
    recordUsage("openai", 100, 50, true);
    recordUsage("openai", 100, 50, true);
    const avail = getProviderAvailability("openai");
    expect(avail.available).toBe(false);
    expect(avail.reason).toContain("5h");
  });

  test("daily spend limit blocks when exceeded", () => {
    setRouterConfig({
      routes: { openai: { weight: 50, spendLimitDaily: 1.0, priceInputPerM: 10, priceOutputPerM: 30 } },
    });
    recordUsage("openai", 200_000, 200_000, true);
    expect(getProviderAvailability("openai").available).toBe(false);
  });

  test("global spend limit blocks all providers", () => {
    setRouterConfig({
      globalSpendLimitDaily: 1.0,
      routes: {
        openai: { weight: 50, priceInputPerM: 10 },
        anthropic: { weight: 50, priceInputPerM: 10 },
      },
    });
    recordUsage("openai", 200_000, 0, true);
    expect(getProviderAvailability("anthropic").available).toBe(false);
  });

  test("disabled route is not available", () => {
    setRouterConfig({ routes: { openai: { weight: 50, enabled: false } } });
    expect(getProviderAvailability("openai").available).toBe(false);
  });
});

// ─── Circuit breaker ────────────────────────────────────────────────────────

describe("circuit breaker", () => {
  test("opens after 5 consecutive failures", () => {
    setRouterConfig({ routes: { openai: { weight: 50 } } });
    for (let i = 0; i < 5; i++) recordProviderFailure("openai");
    const avail = getProviderAvailability("openai");
    expect(avail.available).toBe(false);
    expect(avail.circuitOpen).toBe(true);
    expect(avail.reason).toContain("Circuit breaker");
  });

  test("resets on success", () => {
    setRouterConfig({ routes: { openai: { weight: 50 } } });
    for (let i = 0; i < 5; i++) recordProviderFailure("openai");
    expect(getProviderAvailability("openai").circuitOpen).toBe(true);
    recordProviderSuccess("openai");
    expect(getProviderAvailability("openai").circuitOpen).toBe(false);
  });

  test("recordUsage(success=false) feeds the breaker", () => {
    setRouterConfig({ routes: { openai: { weight: 50 } } });
    for (let i = 0; i < 5; i++) recordUsage("openai", 10, 10, false);
    expect(getProviderAvailability("openai").circuitOpen).toBe(true);
  });
});

// ─── Rate-limit cooldown ────────────────────────────────────────────────────

describe("rate-limit cooldown", () => {
  test("recordRateLimit puts provider in cooldown", () => {
    setRouterConfig({ routes: { openai: { weight: 50 } } });
    recordRateLimit("openai", 60_000);
    const avail = getProviderAvailability("openai");
    expect(avail.available).toBe(false);
    expect(avail.inCooldown).toBe(true);
    expect(avail.reason).toContain("cooldown");
  });
});

// ─── Selection strategies ───────────────────────────────────────────────────

describe("provider selection", () => {
  test("preferred provider passthrough when available", () => {
    setRouterConfig({ routes: { openai: { weight: 50 }, anthropic: { weight: 50 } } });
    expect(selectProvider("openai")).toBe("openai");
  });

  test("failover when preferred is rate-limited", () => {
    setRouterConfig({ routes: { openai: { weight: 50, limit5h: 1 }, anthropic: { weight: 50 } } });
    recordUsage("openai", 10, 10, true);
    expect(selectProvider("openai")).toBe("anthropic");
  });

  test("priority strategy selects lowest priority tier first", () => {
    setRouterConfig({
      strategy: "priority",
      routes: {
        openai: { weight: 50, priority: 1 },
        anthropic: { weight: 50, priority: 0 },
      },
    });
    expect(selectProvider()).toBe("anthropic");
  });

  test("round_robin alternates", () => {
    setRouterConfig({
      strategy: "round_robin",
      routes: { openai: { weight: 50 }, anthropic: { weight: 50 } },
    });
    const first = selectProvider();
    const second = selectProvider();
    expect(first).not.toBe(second);
  });

  test("lowest_cost prefers cheaper provider", () => {
    setRouterConfig({
      strategy: "lowest_cost",
      routes: {
        openai: { weight: 50, priceInputPerM: 5, priceOutputPerM: 20 },
        deepseek: { weight: 50, priceInputPerM: 0.14, priceOutputPerM: 0.28 },
      },
    });
    expect(selectProvider()).toBe("deepseek");
  });

  test("weighted excludes zero-weight providers", () => {
    setRouterConfig({
      routes: {
        openai: { weight: 0 },
        anthropic: { weight: 100 },
      },
    });
    // With openai at weight 0, it should never be selected.
    for (let i = 0; i < 10; i++) {
      expect(selectProvider()).toBe("anthropic");
    }
  });

  test("returns null when all exhausted and no fallback", () => {
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

// ─── Input validation ───────────────────────────────────────────────────────

describe("input validation", () => {
  test("negative weight is clamped to 0", () => {
    setRouterConfig({ routes: { openai: { weight: -10 } } });
    const avail = getProviderAvailability("openai");
    expect(avail.weight).toBe(0);
  });

  test("weight above 100 is clamped to 100", () => {
    setRouterConfig({ routes: { openai: { weight: 999 } } });
    expect(getProviderAvailability("openai").weight).toBe(100);
  });
});

// ─── Status + spend tracking ────────────────────────────────────────────────

describe("status + spend tracking", () => {
  test("getRouterStatus includes pricing from built-in DB", () => {
    setRouterConfig({ routes: { anthropic: { weight: 70 } } });
    recordUsage("anthropic", 1_000_000, 500_000, true); // $5 in + $12.5 out
    const status = getRouterStatus();
    expect(status.routes[0].spendToday).toBeCloseTo(17.5, 1);
    expect(status.routes[0].inputPerM).toBe(5.0);
    expect(status.routes[0].outputPerM).toBe(25.0);
  });
});
