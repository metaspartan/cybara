import { afterEach, describe, expect, test } from "bun:test";
import { tables, type Provider } from "../../src/core/database";
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
    metadata: JSON.stringify({
      providerId: providerKey,
      provider: providerKey,
    }),
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
    expect(snapshot?.externalSourceLabel).toBe("Google coding quota");
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

    const originalGetKeyTotalsForWindows = tables.metrics.getKeyTotalsForWindows;
    const queriedTypes: string[] = [];
    tables.metrics.getKeyTotalsForWindows = ((type: string, startsSql: string[]) => {
      queriedTypes.push(type);
      return originalGetKeyTotalsForWindows(type, startsSql);
    }) as typeof tables.metrics.getKeyTotalsForWindows;

    try {
      const status = getProviderPlanStatus();

      expect(
        status.providers.filter((provider) =>
          [codexProviderId, geminiProviderId, copilotProviderId].includes(
            provider.configuredProviderId ?? ""
          )
        )
      ).toHaveLength(3);
      expect(new Set(queriedTypes)).toEqual(new Set(["router_usage", "token_usage_by_provider"]));
      expect(queriedTypes).toHaveLength(2);
    } finally {
      tables.metrics.getKeyTotalsForWindows = originalGetKeyTotalsForWindows;
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
    expect(
      snapshot?.windows.map((window) => [window.id, window.usedPercent, window.unlimited])
    ).toEqual([
      ["5h", 0, true],
      ["weekly", 82, undefined],
      ["local_30d", undefined, undefined],
    ]);
    expect(snapshot?.windows.find((window) => window.id === "5h")?.resetDescription).toBe(
      "No limit"
    );
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

  test("marks Google OAuth coding plans as automatic and read-only", () => {
    const geminiProviderId = createProvider("google-gemini-cli", "g".repeat(64));
    const antigravityProviderId = createProvider("antigravity", "a".repeat(64));
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const gemini = getProviderPlanSnapshot(geminiProviderId);
    const antigravity = getProviderPlanSnapshot(antigravityProviderId);

    expect(gemini.managedAutomatically).toBe(true);
    expect(gemini.manualPlanEditable).toBe(false);
    expect(gemini.automaticTrackingLabel).toBe("Google coding quota");
    expect(gemini.externalSourceMode).toBe("oauth_api");
    expect(antigravity.managedAutomatically).toBe(true);
    expect(antigravity.manualPlanEditable).toBe(false);
    expect(antigravity.automaticTrackingLabel).toBe("Antigravity quota");
    expect(antigravity.presetSuggestions.map((preset) => preset.id)).toContain(
      "gemini-code-assist-standard"
    );
  });

  test("keeps providers as explicit sources until CLI or account sessions are connected", () => {
    const grokProviderId = createProvider("xai", "xai-test-key", "https://api.x.ai/v1");
    const openCodeProviderId = createProvider(
      "opencode-go",
      "oc-test-key",
      "https://opencode.ai/zen/go/v1"
    );
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const grok = getProviderPlanSnapshot(grokProviderId);
    const opencode = getProviderPlanSnapshot(openCodeProviderId);

    expect(grok.managedAutomatically).toBe(false);
    expect(grok.manualPlanEditable).toBe(true);
    expect(grok.externalSourceLabel).toBe("Grok Build usage");
    expect(grok.externalSourceMode).toBe("cli");
    expect(grok.presetSuggestions.map((preset) => preset.id)).toContain("grok-build");
    expect(opencode.managedAutomatically).toBe(false);
    expect(opencode.externalSourceMode).toBe("browser_cookie");
  });

  test("marks xAI OAuth Grok Build as automatic and read-only", () => {
    const providerId = createProvider("xai-oauth", "xai-oauth-test-token", "https://api.x.ai/v1");
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const snapshot = getProviderPlanSnapshot(providerId);

    expect(snapshot.providerType).toBe("xai-oauth");
    expect(snapshot.managedAutomatically).toBe(true);
    expect(snapshot.manualPlanEditable).toBe(false);
    expect(snapshot.automaticTrackingLabel).toBe("Grok Build usage");
    expect(snapshot.externalSourceMode).toBe("oauth_api");
    expect(snapshot.presetSuggestions.map((preset) => preset.id)).toContain("grok-build");
  });

  test("refreshes expired xAI OAuth before loading Grok Build usage", async () => {
    const providerId = createProvider("xai-oauth", "o".repeat(64), "https://api.x.ai/v1");
    const stored = tables.providers.get(providerId) as Provider;
    tables.providers.update(providerId, {
      ...stored,
      expires_at: Date.now() - 1,
    });
    const refreshedToken = "n".repeat(64);
    const seenUrls: string[] = [];
    const hex =
      "0a3f0d7f6a9c3f12001a002206088097f3d0062a060880b191d2063a07080215a9389b3f3a07080115d6ea183c421208011206088097f3d0061a060880b191d206";
    const billingBytes = Uint8Array.from(
      hex.match(/../g)?.map((part) => Number.parseInt(part, 16)) ?? []
    );
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      if (String(url) === "https://auth.x.ai/oauth2/token") {
        return Response.json({
          access_token: refreshedToken,
          expires_in: 3600,
        });
      }
      expect(String(url)).toBe(
        "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig"
      );
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        `Bearer ${refreshedToken}`
      );
      return new Response(billingBytes);
    }) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(seenUrls).toEqual([
      "https://auth.x.ai/oauth2/token",
      "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
    ]);
    expect(snapshot?.sourceMode).toBe("oauth_api");
    expect(snapshot?.windows.find((window) => window.id === "5h")?.unlimited).toBe(true);
    expect(snapshot?.windows.find((window) => window.id === "weekly")?.usedPercent).toBeCloseTo(
      1.222,
      3
    );
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

  test("enriches Antigravity OAuth quota from Google quota endpoints", async () => {
    const providerId = createProvider("antigravity", "a".repeat(64));
    const seenUrls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(
        `Bearer ${"a".repeat(64)}`
      );
      if (String(url).endsWith("v1internal:loadCodeAssist")) {
        return Response.json({
          currentTier: { id: "standard-tier", name: "standard" },
          cloudaicompanionProject: "managed-project-123",
        });
      }
      if (String(url).endsWith("v1internal:retrieveUserQuotaSummary")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          project: "managed-project-123",
        });
        return Response.json({
          response: {
            groups: [
              {
                displayName: "Gemini Models",
                buckets: [
                  {
                    bucketId: "gemini-5h",
                    remaining: { remainingFraction: 0.91 },
                  },
                  {
                    bucketId: "gemini-weekly",
                    remaining: { remainingFraction: 0.82 },
                  },
                ],
              },
              {
                displayName: "Claude and GPT models",
                buckets: [
                  { bucketId: "3p-5h", remaining: { remainingFraction: 0.73 } },
                  {
                    bucketId: "3p-weekly",
                    remaining: { remainingFraction: 0.64 },
                  },
                ],
              },
            ],
          },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(seenUrls).toEqual([
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    ]);
    expect(snapshot?.sourceMode).toBe("oauth_api");
    expect(snapshot?.sourceLabel).toBe("Antigravity quota");
    expect(snapshot?.planName).toBe("Antigravity standard");
    expect(snapshot?.manualPlanEditable).toBe(false);
    expect(snapshot?.windows.map((window) => window.id)).toEqual(["5h", "weekly", "local_30d"]);
    expect(snapshot?.windows[0]?.usedPercent).toBeCloseTo(27, 5);
    expect(snapshot?.windows[1]?.usedPercent).toBeCloseTo(36, 5);
    expect(snapshot?.windows[2]?.usedPercent).toBeUndefined();
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
            {
              type: "TIME_LIMIT",
              unit: 5,
              percentage: 22,
              usageDetails: [{ modelCode: "search-prime", usage: 220 }],
            },
            { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 91 },
            { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 37 },
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
      ["weekly", 37],
      ["billing_month", 22],
      ["local_30d", undefined],
    ]);
    expect(snapshot?.windows.find((window) => window.id === "billing_month")?.title).toBe(
      "Monthly MCP"
    );
  });

  test("retries Z.ai usage with bearer authorization after an API-level auth failure", async () => {
    const providerId = createProvider(
      "z.ai-coding",
      "zai-bearer-token",
      "https://api.z.ai/api/coding/paas/v4"
    );
    const seenAuthorization: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const authorization = (init?.headers as Record<string, string>)?.Authorization ?? "";
      seenAuthorization.push(authorization);
      if (authorization === "zai-bearer-token") {
        return Response.json({
          code: 401,
          success: false,
          msg: "token expired",
        });
      }
      return Response.json({
        code: 200,
        success: true,
        data: {
          limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 18 }],
        },
      });
    }) as typeof fetch;
    setProviderPlanMonitoringConfig({ enabled: true, providers: {} });

    const status = await enrichProviderPlanStatusWithLiveUsage(getProviderPlanStatus());
    const snapshot = status.providers.find(
      (provider) => provider.configuredProviderId === providerId
    );

    expect(seenAuthorization).toEqual(["zai-bearer-token", "Bearer zai-bearer-token"]);
    expect(snapshot?.windows.find((window) => window.id === "5h")?.usedPercent).toBe(18);
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
        usage: {
          name: "Weekly Usage",
          limit: 1000,
          used: 420,
          resetTime: 1783665881000,
        },
        limits: [
          {
            detail: {
              name: "5h Limit",
              limit: 100,
              used: 64,
              resetTime: 1783405927000,
            },
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
