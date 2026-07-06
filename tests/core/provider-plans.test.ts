import { afterEach, describe, expect, test } from "bun:test";
import { tables } from "../../src/core/database";
import { config } from "../../src/core/config";
import {
  getProviderPlanRouteConstraint,
  getProviderPlanSnapshot,
  getProviderPlanStatus,
  normalizeProviderPlanMonitoringConfig,
  setProviderPlanMonitoringConfig,
} from "../../src/core/provider-plans";
import {
  getProviderAvailability,
  resetRouterForTests,
  type RouterConfig,
} from "../../src/core/router";

const createdProviders: string[] = [];

function createProvider(provider = "openai-codex"): string {
  const id = `plan-test-${crypto.randomUUID()}`;
  tables.providers.create({
    id,
    provider,
    name: `Plan Test ${id}`,
    base_url: "https://example.test",
    api_key: undefined,
    access_token: "token",
    refresh_token: "refresh",
    expires_at: Date.now() + 3600_000,
    is_default: false,
  });
  createdProviders.push(id);
  return id;
}

function addProviderTokens(providerKey: string, tokens: number): void {
  tables.metrics.add({
    id: crypto.randomUUID(),
    type: "token_usage_by_provider",
    key: providerKey,
    value: tokens,
    metadata: JSON.stringify({ providerId: providerKey, provider: providerKey }),
  });
}

afterEach(() => {
  for (const id of createdProviders.splice(0)) {
    try {
      tables.providers.delete(id);
    } catch {
      void 0;
    }
  }
  config.set("provider_plan_monitoring", null);
  config.set("router", null);
  resetRouterForTests();
});

describe("provider plan monitoring", () => {
  test("normalizes garbage config into safe defaults", () => {
    const cfg = normalizeProviderPlanMonitoringConfig({
      enabled: "yes",
      routerEnforcement: true,
      warningThresholdPct: 200,
      providers: {
        "openai-codex": {
          planName: " Team ",
          sourceMode: "browser_cookie",
          externalSourceEnabled: true,
          monthly: { tokenLimit: "1000" },
          weekly: { spendLimit: "-4" },
        },
      },
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.warningThresholdPct).toBe(100);
    expect(cfg.providers["openai-codex"].planName).toBe("Team");
    expect(cfg.providers["openai-codex"].sourceMode).toBe("browser_cookie");
    expect(cfg.providers["openai-codex"].externalSourceEnabled).toBe(true);
    expect(cfg.providers["openai-codex"].monthly?.tokenLimit).toBe(1000);
    expect(cfg.providers["openai-codex"].weekly?.spendLimit).toBeUndefined();
  });

  test("computes local plan windows for an OAuth coding provider", () => {
    const providerId = createProvider();
    addProviderTokens(providerId, 900);
    setProviderPlanMonitoringConfig({
      enabled: true,
      providers: {
        [providerId]: {
          planName: "Codex Plus",
          warningThresholdPct: 80,
          monthly: { tokenLimit: 1000 },
        },
      },
    });

    const snapshot = getProviderPlanSnapshot(providerId);

    expect(snapshot.monitored).toBe(true);
    expect(snapshot.providerType).toBe("openai-codex");
    expect(snapshot.planName).toBe("Codex Plus");
    expect(snapshot.sourceMode).toBe("local");
    expect(snapshot.sourceLabel).toBe("Local usage with configured limits");
    expect(snapshot.externalSourceAvailable).toBe(true);
    expect(snapshot.externalSourceLabel).toBe("OpenAI OAuth usage");
    expect(snapshot.status).toBe("warning");
    expect(snapshot.windows[0].usedTokens).toBeGreaterThanOrEqual(900);
    expect(snapshot.windows[0].usedPercent).toBeGreaterThanOrEqual(90);
  });

  test("router enforcement blocks exhausted configured plan only", () => {
    const providerId = createProvider();
    addProviderTokens(providerId, 1200);
    setProviderPlanMonitoringConfig({
      enabled: true,
      routerEnforcement: true,
      providers: {
        [providerId]: {
          monthly: { tokenLimit: 1000 },
        },
      },
    });
    config.set("router", {
      enabled: true,
      strategy: "weighted",
      fallbackToAny: true,
      routes: { [providerId]: { weight: 50 } },
    } satisfies RouterConfig);

    const constraint = getProviderPlanRouteConstraint(providerId);
    const availability = getProviderAvailability(providerId);

    expect(constraint.enforced).toBe(true);
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain("Plan usage");
  });

  test("status summary counts monitored configured providers", () => {
    const providerId = createProvider("google-gemini-cli");
    setProviderPlanMonitoringConfig({
      enabled: true,
      providers: {
        [providerId]: {
          weekly: { tokenLimit: 5000 },
        },
      },
    });

    const status = getProviderPlanStatus();
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(snapshot?.providerType).toBe("google-gemini-cli");
    expect(snapshot?.externalSourceLabel).toBe("Gemini CLI OAuth quota");
    expect(status.summary.monitored).toBeGreaterThan(0);
    expect(status.summary.configured).toBeGreaterThan(0);
  });
});
