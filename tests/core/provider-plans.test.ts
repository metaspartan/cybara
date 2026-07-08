import { afterEach, describe, expect, test } from "bun:test";
import { tables } from "../../src/core/database";
import { config } from "../../src/core/config";
import {
  enrichProviderPlanStatusWithLiveUsage,
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
const originalFetch = globalThis.fetch;

function createProvider(
  provider = "openai-codex",
  accessToken = "token",
  baseUrl = "https://example.test"
): string {
  const id = `plan-test-${crypto.randomUUID()}`;
  tables.providers.create({
    id,
    provider,
    name: `Plan Test ${id}`,
    base_url: baseUrl,
    api_key: undefined,
    access_token: accessToken,
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
  globalThis.fetch = originalFetch;
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
    expect(snapshot.appliedPresetId).toBeUndefined();
    expect(snapshot.presetSuggestions.map((preset) => preset.id)).toContain("openai-codex-plus");
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
    expect(
      snapshot?.presetSuggestions.find((preset) => preset.id === "gemini-code-assist-standard")
    ).toMatchObject({
      routeLimitWeekly: 10500,
      confidence: "exact",
    });
    expect(status.summary.monitored).toBeGreaterThan(0);
    expect(status.summary.configured).toBeGreaterThan(0);
  });

  test("status indexes local usage metrics once for all providers", () => {
    const codexProviderId = createProvider("openai-codex");
    const geminiProviderId = createProvider("google-gemini-cli");
    const copilotProviderId = createProvider("github_copilot");
    addProviderTokens(codexProviderId, 100);
    addProviderTokens(geminiProviderId, 200);
    addProviderTokens(copilotProviderId, 300);
    setProviderPlanMonitoringConfig({
      enabled: true,
      providers: {
        [codexProviderId]: { monthly: { tokenLimit: 1000 } },
        [geminiProviderId]: { weekly: { tokenLimit: 1000 } },
        [copilotProviderId]: { fiveHour: { tokenLimit: 1000 } },
      },
    });

    const originalGetByTypeSince = tables.metrics.getByTypeSince;
    const queriedTypes: string[] = [];
    tables.metrics.getByTypeSince = ((type: string, sinceSql: string) => {
      queriedTypes.push(type);
      return originalGetByTypeSince(type, sinceSql);
    }) as typeof tables.metrics.getByTypeSince;

    try {
      const status = getProviderPlanStatus();

      expect(
        status.providers.filter((provider) =>
          [codexProviderId, geminiProviderId, copilotProviderId].includes(
            provider.configuredProviderId ?? ""
          )
        )
      ).toHaveLength(3);
      expect(queriedTypes.sort()).toEqual(["router_usage", "token_usage_by_provider"]);
    } finally {
      tables.metrics.getByTypeSince = originalGetByTypeSince;
    }
  });

  test("normalizes and exposes applied coding plan presets", () => {
    const providerId = createProvider("github_copilot");
    setProviderPlanMonitoringConfig({
      enabled: true,
      providers: {
        [providerId]: {
          presetId: "github-copilot-pro-plus",
          planName: "Copilot Pro+",
          sourceMode: "oauth_api",
          monthly: { spendLimit: 70 },
        },
      },
    });

    const snapshot = getProviderPlanSnapshot(providerId);

    expect(snapshot.providerType).toBe("github_copilot");
    expect(snapshot.appliedPresetId).toBe("github-copilot-pro-plus");
    expect(snapshot.presetSuggestions.map((preset) => preset.id)).toContain("github-copilot-max");
    expect(
      snapshot.presetSuggestions.find((preset) => preset.id === "github-copilot-pro-plus")
    ).toMatchObject({
      monthlySpendLimit: 70,
      sourceMode: "oauth_api",
    });
  });

  test("enriches OAuth provider plan status from live usage without manual limits", async () => {
    const providerId = createProvider("openai-codex", "x".repeat(64));
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              used_percent: 48,
              limit_window_seconds: 18000,
              reset_at: 1783405927,
            },
            secondary_window: {
              used_percent: 82,
              limit_window_seconds: 604800,
              reset_at: 1783665881,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(snapshot?.planName).toBe("Codex Pro");
    expect(snapshot?.sourceMode).toBe("oauth_api");
    expect(snapshot?.sourceLabel).toBe("OpenAI OAuth usage");
    expect(snapshot?.dataConfidence).toBe("exact");
    expect(snapshot?.status).toBe("warning");
    expect(snapshot?.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["5h", 48],
      ["weekly", 82],
      ["local_30d", undefined, undefined],
    ]);
    expect(status.summary.configured).toBeGreaterThanOrEqual(1);
    expect(status.summary.warnings).toBeGreaterThanOrEqual(1);
  });

  test("marks provider-managed plans as automatic and read-only for manual caps", () => {
    const providerId = createProvider("minimax");
    addProviderTokens(providerId, 321);
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const snapshot = getProviderPlanSnapshot(providerId);

    expect(snapshot.providerType).toBe("minimax");
    expect(snapshot.managedAutomatically).toBe(true);
    expect(snapshot.manualPlanEditable).toBe(false);
    expect(snapshot.automaticTrackingLabel).toBe("MiniMax token-plan quota");
    expect(snapshot.status).toBe("ok");
    expect(snapshot.reason).toBe("Automatic provider-plan tracking active");
    const localWindow = snapshot.windows.find((window) => window.id === "local_30d");
    expect(localWindow?.title).toBe("Last 30 days");
    expect(localWindow?.usedTokens).toBeGreaterThanOrEqual(321);
    expect(snapshot.presetSuggestions.map((preset) => preset.id)).toContain("minimax-token-plan");
  });

  test("enriches MiniMax token-plan quota from provider API", async () => {
    const providerId = createProvider("minimax", "sk-cp-test-token");
    const seenUrls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        "Bearer sk-cp-test-token"
      );
      return Response.json({
        model_remains: [
          {
            model_name: "MiniMax-M3",
            current_interval_remaining_percent: 38.4,
            current_weekly_status: 3,
          },
        ],
      });
    }) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(seenUrls[0]).toBe("https://api.minimax.io/v1/token_plan/remains");
    expect(snapshot?.sourceMode).toBe("provider_api");
    expect(snapshot?.sourceLabel).toBe("MiniMax token-plan quota");
    expect(snapshot?.manualPlanEditable).toBe(false);
    expect(
      snapshot?.windows.map((window) => [window.id, window.usedPercent, window.unlimited])
    ).toEqual([
      ["5h", 61.6, undefined],
      ["weekly", 0, true],
      ["local_30d", undefined],
    ]);
  });

  test("enriches Z.ai coding plan quota from provider monitor endpoint", async () => {
    const providerId = createProvider(
      "z.ai-coding",
      "zai-token",
      "https://api.z.ai/api/coding/paas/v4"
    );
    const seenUrls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("zai-token");
      return Response.json({
        data: {
          limits: [
            { type: "TIME_LIMIT", percentage: 22 },
            { type: "TOKENS_LIMIT", percentage: 91 },
          ],
        },
      });
    }) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(seenUrls[0]).toBe("https://api.z.ai/api/monitor/usage/quota/limit");
    expect(snapshot?.sourceMode).toBe("provider_api");
    expect(snapshot?.sourceLabel).toBe("Z.ai quota monitor");
    expect(snapshot?.status).toBe("warning");
    expect(snapshot?.manualPlanEditable).toBe(false);
    expect(snapshot?.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["5h", 91],
      ["weekly", 22],
      ["local_30d", undefined],
    ]);
  });

  test("enriches Kimi coding plan quota from provider usage endpoint", async () => {
    const providerId = createProvider(
      "kimi-code",
      "sk-kimi-test-token",
      "https://api.kimi.com/coding/v1"
    );
    const seenUrls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        "Bearer sk-kimi-test-token"
      );
      return Response.json({
        usage: { name: "Weekly Usage", limit: 1000, used: 420, resetTime: 1783665881000 },
        limits: [
          {
            detail: { name: "5h Limit", limit: 100, used: 64, resetTime: 1783405927000 },
            window: { duration: 5, time_unit: "HOUR" },
          },
        ],
      });
    }) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(seenUrls[0]).toBe("https://api.kimi.com/coding/v1/usages");
    expect(snapshot?.sourceMode).toBe("provider_api");
    expect(snapshot?.sourceLabel).toBe("Kimi usage source");
    expect(snapshot?.planName).toBe("Kimi Coding Plan");
    expect(snapshot?.manualPlanEditable).toBe(false);
    expect(snapshot?.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["5h", 64],
      ["weekly", 42],
      ["local_30d", undefined],
    ]);
  });
});
