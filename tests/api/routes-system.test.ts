import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { parse, join } from "path";
import { homedir } from "os";
import { createRoutesFixture } from "./routes.fixture";

const fixture = createRoutesFixture();

describe("Metrics API", () => {
  test("GET /api/metrics should return metrics", async () => {
    const { status, data } = await fixture.api("GET", "/api/metrics");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
    expect(data).toHaveProperty("memory");
    expect(data).toHaveProperty("uptime");
  });

  test("GET /api/metrics/storage returns storage usage details", async () => {
    const storage = await fixture.api("GET", "/api/metrics/storage");
    expect(storage.status).toBe(200);
    expect(typeof storage.data.totalBytes).toBe("number");
    expect(storage.data.totalBytes).toBeGreaterThanOrEqual(0);
    expect(typeof storage.data.accountedBytes).toBe("number");
    expect(typeof storage.data.uncategorizedBytes).toBe("number");
    expect(typeof storage.data.directories).toBe("object");
    expect(typeof storage.data.components).toBe("object");
    expect(typeof storage.data.components.database.bytes).toBe("number");
    expect(storage.data.components.database.path).toContain("platform.db");
    expect(typeof storage.data.components.artifacts.bytes).toBe("number");
    expect(typeof storage.data.components.logs.bytes).toBe("number");
    expect(typeof storage.data.components.memory.bytes).toBe("number");
    expect(typeof storage.data.components.data.bytes).toBe("number");
    expect(typeof storage.data.components.sessions.bytes).toBe("number");
    expect(typeof storage.data.components.media.bytes).toBe("number");
    expect(typeof storage.data.components.channels.bytes).toBe("number");
    expect(typeof storage.data.components.other.bytes).toBe("number");
    expect(Array.isArray(storage.data.topLevel)).toBe(true);
    const accountedPlusOther =
      Number(storage.data.accountedBytes || 0) + Number(storage.data.uncategorizedBytes || 0);
    expect(accountedPlusOther).toBeLessThanOrEqual(storage.data.totalBytes + 1);
  });

  test("GET /api/metrics/snapshot returns a mobile-friendly aggregate", async () => {
    const snapshot = await fixture.api("GET", "/api/metrics/snapshot");
    expect(snapshot.status).toBe(200);
    expect(typeof snapshot.data.overview?.tokenUsage?.total).toBe("number");
    expect(typeof snapshot.data.storage?.totalBytes).toBe("number");
    expect(typeof snapshot.data.providerPlans?.enabled).toBe("boolean");
    expect(snapshot.data.availability.overview.ok).toBe(true);
    expect(snapshot.data.availability.storage.ok).toBe(true);
    expect(snapshot.data.availability.providerPlans.ok).toBe(true);
  });

  test("GET /api/metrics/snapshot supports a compact mobile aggregate", async () => {
    const snapshot = await fixture.api("GET", "/api/metrics/snapshot?compact=1");
    expect(snapshot.status).toBe(200);
    expect(typeof snapshot.data.overview?.tokenUsage?.total).toBe("number");
    expect(snapshot.data.tokens).toBeNull();
    expect(snapshot.data.providerPlans).toBeNull();
    expect(snapshot.data.availability.tokens.ok).toBe(true);
    expect(snapshot.data.availability.providerPlans.ok).toBe(true);
  });

  test("metrics detail endpoints tolerate malformed metadata rows", async () => {
    const suffix = Date.now().toString();
    const malformedProvider = `prov_bad_${suffix}`;
    const providerWithUrl = `prov_url_${suffix}`;
    const uniqueTokenValue = 987_654_321;
    const uniqueFileOp = `file_op_${suffix}`;
    const uniqueTool = `tool_${suffix}`;
    const apiOnlyKey = `api_only_${suffix}`;

    fixture.insertRawProvider(malformedProvider, "custom", "Malformed Metrics Provider");
    fixture.insertRawProvider(providerWithUrl, "custom", "URL Metrics Provider");
    fixture.insertRawMetric("token_usage_by_provider", malformedProvider, 11, "{bad-json");
    fixture.insertRawMetric("api_call", malformedProvider, 5, "{still-bad");
    fixture.insertRawMetric("token_usage_by_provider", providerWithUrl, 22, "{bad-json");
    fixture.insertRawMetric(
      "api_call",
      providerWithUrl,
      2,
      JSON.stringify({ url: `https://metrics.${suffix}.example/v1` })
    );

    fixture.insertRawMetric("token_usage", `token_${suffix}`, uniqueTokenValue, "{bad-json");
    fixture.insertRawMetric("file_operation", uniqueFileOp, 13, "{bad-json");
    fixture.insertRawMetric("tool_call", uniqueTool, 17, "{bad-json");
    fixture.insertRawMetric(
      "api_call",
      apiOnlyKey,
      19,
      JSON.stringify({ url: "https://example.com" })
    );

    const providersRes = await fixture.api("GET", "/api/metrics/providers");
    expect(providersRes.status).toBe(200);
    const providers = (providersRes.data.providers || []) as Array<{
      provider: string;
      hits: number;
      tokens: number;
      url: string;
    }>;
    const providerMap = new Map(providers.map((p) => [p.provider, p]));
    expect(providerMap.get(malformedProvider)).toEqual({
      provider: malformedProvider,
      hits: 5,
      tokens: 11,
      url: "unknown",
    });
    expect(providerMap.get(providerWithUrl)).toEqual({
      provider: providerWithUrl,
      hits: 2,
      tokens: 22,
      url: `https://metrics.${suffix}.example/v1`,
    });
    expect(providerMap.has(apiOnlyKey)).toBe(false);

    const tokensRes = await fixture.api("GET", "/api/metrics/tokens");
    expect(tokensRes.status).toBe(200);
    const tokenRow = (tokensRes.data.recentUsage || []).find(
      (row: { tokens: number; metadata: unknown }) => row.tokens === uniqueTokenValue
    ) as { tokens: number; metadata: unknown } | undefined;
    expect(tokenRow).toBeDefined();
    expect(tokenRow?.metadata).toBeNull();

    const filesRes = await fixture.api("GET", "/api/metrics/files");
    expect(filesRes.status).toBe(200);
    const fileRow = (filesRes.data.recentOperations || []).find(
      (row: { type: string; metadata: unknown }) => row.type === uniqueFileOp
    ) as { type: string; metadata: unknown } | undefined;
    expect(fileRow).toBeDefined();
    expect(fileRow?.metadata).toBeNull();

    const toolsRes = await fixture.api("GET", "/api/metrics/tools");
    expect(toolsRes.status).toBe(200);
    const toolRow = (toolsRes.data.recentCalls || []).find(
      (row: { tool: string; metadata: unknown }) => row.tool === uniqueTool
    ) as { tool: string; metadata: unknown } | undefined;
    expect(toolRow).toBeDefined();
    expect(toolRow?.metadata).toBeNull();
  });

  test("metrics insights endpoint returns efficiency and trend summaries", async () => {
    const suffix = Date.now().toString();
    const provider = `insight_provider_${suffix}`;
    const model = `insight_model_${suffix}`;
    const tool = `insight_tool_${suffix}`;
    const tokenTotal = 9_000_000;

    fixture.insertRawProvider(provider, "custom", "Insights Metrics Provider");
    fixture.insertRawMetric("token_usage", "all", tokenTotal);
    fixture.insertRawMetric("token_usage", "input", 3_000_000);
    fixture.insertRawMetric("token_usage", "output", 6_000_000);
    fixture.insertRawMetric("token_usage_by_model", model, tokenTotal);
    fixture.insertRawMetric(
      "token_usage_by_provider",
      provider,
      tokenTotal,
      JSON.stringify({ url: `https://${provider}.example/v1` })
    );
    fixture.insertRawMetric(
      "api_call",
      provider,
      3,
      JSON.stringify({ url: `https://${provider}.example/v1` })
    );
    fixture.insertRawMetric("tool_call", tool, 5);
    fixture.insertRawMetric("tool_error", tool, 1);

    const insightsRes = await fixture.api("GET", "/api/metrics/insights");
    expect(insightsRes.status).toBe(200);
    expect(insightsRes.data.tokenBreakdown.total).toBeGreaterThan(0);
    expect(typeof insightsRes.data.tokenTrend24h.changePct).toBe("number");
    expect(["up", "down", "flat"]).toContain(insightsRes.data.tokenTrend24h.direction);

    const providerRow = (insightsRes.data.providerEfficiency || []).find(
      (row: { provider: string }) => row.provider === provider
    ) as
      | {
          provider: string;
          tokens: number;
          calls: number;
          tokensPerCall: number;
        }
      | undefined;
    expect(providerRow).toBeDefined();
    expect(providerRow?.tokens).toBeGreaterThanOrEqual(tokenTotal);
    expect(providerRow?.calls).toBeGreaterThan(0);
    expect(typeof providerRow?.tokensPerCall).toBe("number");

    const toolRow = (insightsRes.data.toolUsage24h || []).find(
      (row: { tool: string }) => row.tool === tool
    ) as { tool: string; calls: number } | undefined;
    expect(toolRow).toBeDefined();
    expect(toolRow?.calls).toBeGreaterThanOrEqual(5);

    expect(typeof insightsRes.data.toolReliability.successRatePct).toBe("number");
    expect(
      insightsRes.data.modelInsights.some((entry: { model: string }) => entry.model === model)
    ).toBe(true);
  });

  test("provider metrics return every configured provider without synthetic stale keys", async () => {
    const suffix = Date.now().toString();
    const providerIds = Array.from(
      { length: 25 },
      (_, index) => `uncapped_provider_${suffix}_${index}`
    );
    const staleKey = `stale_provider_${suffix}`;

    for (const [index, providerId] of providerIds.entries()) {
      fixture.insertRawProvider(providerId, "custom", `Configured Provider ${index + 1}`);
      fixture.insertRawMetric("token_usage_by_provider", providerId, index + 1);
    }
    fixture.insertRawMetric("token_usage_by_provider", staleKey, 1_000_000_000);

    const providersRes = await fixture.api("GET", "/api/metrics/providers");
    expect(providersRes.status).toBe(200);
    const returnedProviders = new Set(
      (providersRes.data.providers || []).map((entry: { provider: string }) => entry.provider)
    );
    for (const providerId of providerIds) expect(returnedProviders.has(providerId)).toBe(true);
    expect(returnedProviders.has(staleKey)).toBe(false);

    const tokensRes = await fixture.api("GET", "/api/metrics/tokens");
    expect(tokensRes.status).toBe(200);
    const returnedTokenProviders = new Set(
      (tokensRes.data.topProviders || []).map((entry: { provider: string }) => entry.provider)
    );
    for (const providerId of providerIds) expect(returnedTokenProviders.has(providerId)).toBe(true);
    expect(returnedTokenProviders.has(staleKey)).toBe(false);
  });
});

describe("Config API", () => {
  test("GET /api/config should return config object", async () => {
    const { status, data } = await fixture.api("GET", "/api/config");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
    expect(typeof data.dangerous_tool_policy).toBe("object");
    expect(typeof data.dangerous_tool_policy.enabled).toBe("boolean");
    expect(["audit", "block"]).toContain(data.dangerous_tool_policy.mode);
    expect(["always_allow", "ask"]).toContain(data.tool_approval_mode);
    expect(typeof data.follow_up_behavior_enabled).toBe("boolean");
    expect(typeof data.token_optimization.toonStructuredDataEnabled).toBe("boolean");
    expect(typeof data.acp_enabled).toBe("boolean");
  });

  test("GET /api/config tolerates malformed stored JSON values", async () => {
    const key = `routes_bad_config_${Date.now()}`;
    const rawValue = "{bad-json";
    fixture.upsertRawConfig(key, rawValue);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data[key]).toBe(rawValue);
  });

  test("PUT /api/config should update a temporary key", async () => {
    const key = `routes_test_key_${Date.now()}`;
    const value = `value-${Date.now()}`;

    const putRes = await fixture.api("PUT", "/api/config", {
      [key]: value,
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data[key]).toBe(value);
  });

  test("PUT /api/config ignores redacted sentinel values echoed back by clients", async () => {
    const key = `routes_probe_credential_${Date.now()}`;
    const secret = `secret-${Date.now()}`;

    const putRes = await fixture.api("PUT", "/api/config", {
      [key]: secret,
    });
    expect(putRes.status).toBe(200);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data[key]).toBe("***redacted***");

    const echoRes = await fixture.api("PUT", "/api/config", {
      [key]: "***redacted***",
    });
    expect(echoRes.status).toBe(200);
    expect(echoRes.data.success).toBe(true);
    expect(fixture.readRawConfig(key)).toBe(JSON.stringify(secret));
  });

  test("GET /api/config never returns the sandbox remote API key", async () => {
    const putRes = await fixture.api("PUT", "/api/config", {
      sandbox_runtime: {
        enabled: false,
        provider: "auto",
        network: "deny",
        remoteUrl: "https://api.e2b.dev",
        remoteApiKey: "e2b-live-secret",
      },
    });
    expect(putRes.status).toBe(200);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.sandbox_runtime.remoteApiKey).toBe("***redacted***");
    expect(JSON.stringify(getRes.data)).not.toContain("e2b-live-secret");

    const echoRes = await fixture.api("PUT", "/api/config", {
      sandbox_runtime: getRes.data.sandbox_runtime,
    });
    expect(echoRes.status).toBe(200);
    const stored = fixture.readRawConfig("sandbox_runtime") ?? "";
    expect(stored).not.toContain("e2b-live-secret");
    expect(stored).not.toContain("***redacted***");
    const parsed = JSON.parse(stored) as { remoteApiKey?: string };
    expect(
      fixture.openSealedValue("sandbox-runtime:remote_api_key", parsed.remoteApiKey ?? "")
    ).toBe("e2b-live-secret");

    await fixture.api("PUT", "/api/config", {
      sandbox_runtime: { enabled: false, provider: "auto", network: "deny" },
    });
  });

  test("PUT /api/config binds a redacted sandbox key to its destination", async () => {
    const configured = await fixture.api("PUT", "/api/config", {
      sandbox_runtime: {
        enabled: true,
        provider: "auto",
        network: "deny",
        remoteUrl: "https://api.e2b.dev",
        remoteApiKey: "sandbox-bound-secret",
      },
    });
    expect(configured.status).toBe(200);

    const rejected = await fixture.api("PUT", "/api/config", {
      sandbox_runtime: {
        enabled: true,
        provider: "auto",
        network: "deny",
        remoteUrl: "https://replacement.invalid",
        remoteApiKey: "***redacted***",
      },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.data.code).toBe("VALIDATION_ERROR");
    expect(String(rejected.data.error)).toContain("must be re-entered");

    await fixture.api("PUT", "/api/config", {
      sandbox_runtime: { enabled: false, provider: "auto", network: "deny" },
    });
  });

  test("PUT /api/config normalizes dangerous tool policy payloads", async () => {
    const putRes = await fixture.api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: true, mode: "invalid-mode" },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.dangerous_tool_policy).toEqual({
      enabled: true,
      mode: "audit",
    });

    const resetRes = await fixture.api("PUT", "/api/config", {
      dangerous_tool_policy: { enabled: false, mode: "audit" },
    });
    expect(resetRes.status).toBe(200);
  });

  test("PUT /api/config normalizes token optimization payloads", async () => {
    const putDisabled = await fixture.api("PUT", "/api/config", {
      token_optimization: { toon_structured_data_enabled: false },
    });
    expect(putDisabled.status).toBe(200);
    expect(putDisabled.data.success).toBe(true);

    const getDisabled = await fixture.api("GET", "/api/config");
    expect(getDisabled.status).toBe(200);
    expect(getDisabled.data.token_optimization).toEqual({
      toonStructuredDataEnabled: false,
    });

    const putInvalid = await fixture.api("PUT", "/api/config", {
      token_optimization: { toonStructuredDataEnabled: "yes" },
    });
    expect(putInvalid.status).toBe(200);

    const getInvalid = await fixture.api("GET", "/api/config");
    expect(getInvalid.status).toBe(200);
    expect(getInvalid.data.token_optimization).toEqual({
      toonStructuredDataEnabled: true,
    });
  });

  test("PUT /api/config normalizes tool approval mode payloads", async () => {
    const putAsk = await fixture.api("PUT", "/api/config", {
      tool_approval_mode: "ask",
    });
    expect(putAsk.status).toBe(200);
    expect(putAsk.data.success).toBe(true);

    const getAsk = await fixture.api("GET", "/api/config");
    expect(getAsk.status).toBe(200);
    expect(getAsk.data.tool_approval_mode).toBe("ask");

    const putInvalid = await fixture.api("PUT", "/api/config", {
      tool_approval_mode: "not-a-mode",
    });
    expect(putInvalid.status).toBe(200);
    expect(putInvalid.data.success).toBe(true);

    const getInvalid = await fixture.api("GET", "/api/config");
    expect(getInvalid.status).toBe(200);
    expect(getInvalid.data.tool_approval_mode).toBe("ask");
  });

  test("PUT /api/config normalizes web tool url policy payloads", async () => {
    const putRes = await fixture.api("PUT", "/api/config", {
      web_tool_url_policy: {
        enabled: true,
        fetch_allowlist: ["EXAMPLE.com", "  *.Allowed.io  ", "", 123],
        search_result_allowlist: ["NEWS.EXAMPLE.com", null, "*.ALLOWED.io"],
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.web_tool_url_policy).toEqual({
      enabled: true,
      fetch_allowlist: ["example.com", "*.allowed.io"],
      search_result_allowlist: ["news.example.com", "*.allowed.io"],
    });

    const resetRes = await fixture.api("PUT", "/api/config", {
      web_tool_url_policy: {
        enabled: false,
        fetch_allowlist: [],
        search_result_allowlist: [],
      },
    });
    expect(resetRes.status).toBe(200);
  });

  test("PUT /api/config normalizes computer-use driver command override", async () => {
    const putRes = await fixture.api("PUT", "/api/config", {
      computer_use: {
        driverCommand:
          '"C:\\Users\\carsen\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe"',
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.computer_use).toEqual({
      driverCommand:
        "C:\\Users\\carsen\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe",
      trajectoryCaptureEnabled: false,
      trajectoryVideoEnabled: false,
    });

    const resetRes = await fixture.api("PUT", "/api/config", {
      computer_use: { driverCommand: "" },
    });
    expect(resetRes.status).toBe(200);
  });

  test("PUT /api/config normalizes memory behavior settings", async () => {
    const putRes = await fixture.api("PUT", "/api/config", {
      memory: {
        backgroundReviewEnabled: false,
        backgroundReviewMinIntervalMs: 2500,
        backgroundReviewTimeoutSeconds: 9999,
        memoryFlushEnabled: true,
        memoryFlushSoftThresholdTokens: 10,
        memoryFlushPrompt: "  capture durable facts only  ",
        memoryFlushSystemPrompt: "  memory system  ",
      },
    });
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const getRes = await fixture.api("GET", "/api/config");
    expect(getRes.status).toBe(200);
    expect(getRes.data.memory).toMatchObject({
      backgroundReviewEnabled: false,
      backgroundReviewMinIntervalMs: 10000,
      backgroundReviewTimeoutSeconds: 600,
      memoryFlushEnabled: true,
      memoryFlushSoftThresholdTokens: 500,
      memoryFlushPrompt: "capture durable facts only",
      memoryFlushSystemPrompt: "memory system",
    });

    const resetRes = await fixture.api("PUT", "/api/config", {
      memory: {
        backgroundReviewEnabled: true,
        backgroundReviewMinIntervalMs: 300000,
        backgroundReviewTimeoutSeconds: 90,
        memoryFlushEnabled: true,
        memoryFlushSoftThresholdTokens: 4000,
      },
    });
    expect(resetRes.status).toBe(200);
  });
});

describe("Browser API", () => {
  test("GET /api/browser/status should return browser state", async () => {
    const { status, data } = await fixture.api("GET", "/api/browser/status");
    expect(status).toBe(200);
    expect(typeof data.running).toBe("boolean");
  });

  test("GET /api/browser/tabs should return tabs array", async () => {
    const { status, data } = await fixture.api("GET", "/api/browser/tabs");
    expect(status).toBe(200);
    expect(Array.isArray(data.tabs)).toBe(true);
  });

  test("POST /api/browser/tabs/:id/navigate should validate missing url", async () => {
    const { status, data } = await fixture.api(
      "POST",
      "/api/browser/tabs/nonexistent/navigate",
      {}
    );
    expect(status).toBe(200);
    expect(data.error).toBe("URL is required");
  });

  test("POST /api/browser/tabs/:id/click should validate selector", async () => {
    const { status, data } = await fixture.api("POST", "/api/browser/tabs/nonexistent/click", {});
    expect(status).toBe(200);
    expect(data.error).toBe("Selector is required");
  });

  test("POST /api/browser/tabs/:id/type should validate selector and text", async () => {
    const { status, data } = await fixture.api("POST", "/api/browser/tabs/nonexistent/type", {
      selector: "",
      text: "",
    });
    expect(status).toBe(200);
    expect(data.error).toBe("Selector and text are required");
  });

  test("DELETE /api/browser/tabs/:id should return not found for unknown page", async () => {
    const { status, data } = await fixture.api("DELETE", "/api/browser/tabs/nonexistent");
    expect(status).toBe(200);
    expect(data.error).toBe("Page not found");
  });

  test("POST /api/browser/close should return success", async () => {
    const { status, data } = await fixture.api("POST", "/api/browser/close");
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});

describe("Open URL API", () => {
  test("POST /api/open-url should reject invalid URLs as validation errors", async () => {
    const { status, data } = await fixture.api("POST", "/api/open-url", {
      url: "not-a-valid-url",
    });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/open-url should reject missing url", async () => {
    const { status, data } = await fixture.api("POST", "/api/open-url", {});
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/open-url should reject non-http protocols", async () => {
    const { status, data } = await fixture.api("POST", "/api/open-url", {
      url: "javascript:alert(1)",
    });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/open-url should reject localhost/private targets", async () => {
    const { status, data } = await fixture.api("POST", "/api/open-url", {
      url: "http://localhost:3000",
    });
    expect(status).toBe(400);
    expect(data.code).toBe("VALIDATION_ERROR");
  });
});

describe("System Prompt & Identity API", () => {
  test("system prompt and identity endpoints tolerate malformed persisted JSON", async () => {
    fixture.upsertRawConfig("systemPrompt", "{bad-json");
    fixture.upsertRawConfig("identity", "{bad-json");

    const systemPromptRes = await fixture.api("GET", "/api/system-prompt");
    expect(systemPromptRes.status).toBe(200);
    expect(typeof systemPromptRes.data.template).toBe("string");
    expect(systemPromptRes.data.template).toBe("default");
    expect(systemPromptRes.data.identity.name).toBe("Cybara");

    const identityRes = await fixture.api("GET", "/api/identity");
    expect(identityRes.status).toBe(200);
    expect(identityRes.data.name).toBe("Cybara");
    expect(identityRes.data.avatar).toBe("");

    const previewRes = await fixture.api("GET", "/api/system-prompt/preview");
    expect(previewRes.status).toBe(200);
    expect(typeof previewRes.data.preview).toBe("string");
    expect(previewRes.data.preview.length).toBeGreaterThan(50);
  });

  test("system prompt config can be updated and preview generated", async () => {
    const getRes = await fixture.api("GET", "/api/system-prompt");
    expect(getRes.status).toBe(200);
    expect(typeof getRes.data.template).toBe("string");
    expect(getRes.data.identity).toBeDefined();

    const updated = {
      template: "custom",
      customPrompt: "You are a test prompt profile.",
      defaultBasePrompt: "Base prompt text",
      identity: {
        name: "Cybara Test",
        emoji: "🧪",
        creature: "assistant",
        vibe: "focused",
        theme: "light",
      },
      features: {
        memoryEnabled: true,
        skillsEnabled: true,
        messagingEnabled: false,
        replyTagsEnabled: true,
      },
    };

    const putRes = await fixture.api("PUT", "/api/system-prompt", updated);
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const verifyRes = await fixture.api("GET", "/api/system-prompt");
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.data.template).toBe("custom");
    expect(verifyRes.data.identity.name).toBe("Cybara Test");
    expect(verifyRes.data.features.messagingEnabled).toBe(false);

    const previewRes = await fixture.api("GET", "/api/system-prompt/preview");
    expect(previewRes.status).toBe(200);
    expect(typeof previewRes.data.preview).toBe("string");
    expect(previewRes.data.preview.length).toBeGreaterThan(50);
  });

  test("identity config can be updated and re-read", async () => {
    const getRes = await fixture.api("GET", "/api/identity");
    expect(getRes.status).toBe(200);
    expect(typeof getRes.data.name).toBe("string");

    const updated = {
      name: "Cybara Identity Test",
      emoji: "🤖",
      creature: "bot",
      vibe: "calm",
      theme: "dark",
      avatar: "https://example.com/avatar.png",
    };

    const putRes = await fixture.api("PUT", "/api/identity", updated);
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);

    const verifyRes = await fixture.api("GET", "/api/identity");
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.data.name).toBe(updated.name);
    expect(verifyRes.data.emoji).toBe(updated.emoji);
    expect(verifyRes.data.avatar).toBe(updated.avatar);
  });
});

describe("System Status API", () => {
  test("GET /api/system/status should return lightweight status payload", async () => {
    const { status, data } = await fixture.api("GET", "/api/system/status");
    expect(status).toBe(200);
    expect(typeof data.status).toBe("string");
    expect(typeof data.timestamp).toBe("number");
    expect(typeof data.agentCount).toBe("number");
  });
});

describe("Memory API", () => {
  test("POST /api/memory should create file and DELETE should remove it", async () => {
    const file = `routes-memory-${Date.now()}.md`;
    const createRes = await fixture.api("POST", "/api/memory", {
      file,
      content: "memory integration test",
    });

    expect(createRes.status).toBe(200);
    expect(createRes.data.success).toBe(true);
    expect(createRes.data.file).toBe(file);

    const listRes = await fixture.api("GET", "/api/memory");
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.data.files)).toBe(true);
    expect(listRes.data.files).toContain(file);

    const deleteRes = await fixture.api("DELETE", `/api/memory/${file}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);
  });

  test("GET /api/memory/search should return search results array", async () => {
    const file = `routes-memory-search-${Date.now()}.md`;
    const needle = `needle-${Date.now()}`;

    const createRes = await fixture.api("POST", "/api/memory", {
      file,
      content: `memory search ${needle}`,
    });
    expect(createRes.status).toBe(200);

    const searchRes = await fixture.api(
      "GET",
      `/api/memory/search?query=${encodeURIComponent(needle)}`
    );
    expect(searchRes.status).toBe(200);
    expect(Array.isArray(searchRes.data.results)).toBe(true);
    expect(searchRes.data.results.length).toBeGreaterThan(0);

    await fixture.api("DELETE", `/api/memory/${file}`);
  });

  test("POST /api/memory appends entries to existing files and supports edit/delete", async () => {
    const file = `routes-memory-append-${Date.now()}.md`;

    try {
      const firstCreate = await fixture.api("POST", "/api/memory", {
        file,
        content: "first memory entry",
      });
      expect(firstCreate.status).toBe(200);
      expect(firstCreate.data.success).toBe(true);
      expect(firstCreate.data.appended).toBe(false);

      const appendCreate = await fixture.api("POST", "/api/memory", {
        file,
        content: "second memory entry",
      });
      expect(appendCreate.status).toBe(200);
      expect(appendCreate.data.success).toBe(true);
      expect(appendCreate.data.appended).toBe(true);

      const listAfterAppend = await fixture.api("GET", "/api/memory");
      const memoryFile = listAfterAppend.data.memories.find(
        (item: { file: string }) => item.file === file
      );
      expect(memoryFile.entries).toHaveLength(2);
      expect(memoryFile.entries[1].content).toContain("second memory entry");

      const searchRes = await fixture.api("GET", "/api/memory/search?query=second%20memory");
      const searchHit = searchRes.data.results.find((item: { file: string }) => item.file === file);
      expect(searchHit.file).toBe(file);
      expect(searchHit.entry.index).toBe(1);

      const editRes = await fixture.api("PUT", `/api/memory/${file}`, {
        index: 1,
        content: "edited second memory entry",
      });
      expect(editRes.status).toBe(200);
      expect(editRes.data.success).toBe(true);

      const deleteEntryRes = await fixture.api("DELETE", `/api/memory/${file}`, {
        index: 0,
      });
      expect(deleteEntryRes.status).toBe(200);
      expect(deleteEntryRes.data.success).toBe(true);

      const listAfterDelete = await fixture.api("GET", "/api/memory");
      const updatedMemoryFile = listAfterDelete.data.memories.find(
        (item: { file: string }) => item.file === file
      );
      expect(updatedMemoryFile.entries).toHaveLength(1);
      expect(updatedMemoryFile.entries[0].content).toContain("edited second memory entry");
    } finally {
      await fixture.api("DELETE", `/api/memory/${file}`);
    }
  });

  test("memory edit and delete decode encoded route filenames before sanitizing", async () => {
    const rawFile = `routes memory encoded ${Date.now()}.md`;
    const expectedFile = rawFile.replace(/[^\w.-]/g, "-");
    const encodedFile = encodeURIComponent(rawFile);

    try {
      const createRes = await fixture.api("POST", "/api/memory", {
        file: rawFile,
        content: "encoded memory entry",
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.file).toBe(expectedFile);

      const editRes = await fixture.api("PUT", `/api/memory/${encodedFile}`, {
        index: 0,
        content: "encoded memory entry updated",
      });
      expect(editRes.status).toBe(200);
      expect(editRes.data.success).toBe(true);

      const searchRes = await fixture.api(
        "GET",
        "/api/memory/search?query=encoded%20memory%20entry%20updated"
      );
      expect(searchRes.status).toBe(200);
      const hit = searchRes.data.results.find(
        (item: { file: string }) => item.file === expectedFile
      );
      expect(hit.entry.content).toContain("encoded memory entry updated");

      const deleteRes = await fixture.api("DELETE", `/api/memory/${encodedFile}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.data.success).toBe(true);

      const listRes = await fixture.api("GET", "/api/memory");
      expect(listRes.data.files).not.toContain(expectedFile);
    } finally {
      await fixture.api("DELETE", `/api/memory/${encodeURIComponent(expectedFile)}`);
    }
  });
});

describe("IDE & Git API", () => {
  test("IDE browse/read/write/create routes should work inside HOME sandbox", async () => {
    const ideMetricsBefore = fixture.countMetrics("ide_operation");
    const fileMetricsBefore = fixture.countMetrics("file_operation");

    const fileName = `ide-test-${Date.now()}.txt`;
    const filePath = join(fixture.testHome, fileName);
    writeFileSync(filePath, "initial-content", "utf8");

    const browseRes = await fixture.api(
      "GET",
      `/api/ide/browse?path=${encodeURIComponent(fixture.testHome)}`
    );
    expect(browseRes.status).toBe(200);
    expect(browseRes.data.success).toBe(true);
    expect(Array.isArray(browseRes.data.entries)).toBe(true);
    expect(
      browseRes.data.entries.some(
        (entry: { name: string; type: string }) => entry.name === fileName
      )
    ).toBe(true);

    const readRes = await fixture.api("GET", `/api/ide/read?path=${encodeURIComponent(filePath)}`);
    expect(readRes.status).toBe(200);
    expect(readRes.data.success).toBe(true);
    expect(readRes.data.content).toBe("initial-content");

    const writeRes = await fixture.api("POST", "/api/ide/write", {
      path: filePath,
      content: "updated-content",
    });
    expect(writeRes.status).toBe(200);
    expect(writeRes.data.success).toBe(true);

    const rereadRes = await fixture.api(
      "GET",
      `/api/ide/read?path=${encodeURIComponent(filePath)}`
    );
    expect(rereadRes.status).toBe(200);
    expect(rereadRes.data.success).toBe(true);
    expect(rereadRes.data.content).toBe("updated-content");

    const createdFileName = `ide-created-${Date.now()}.md`;
    const createRes = await fixture.api("POST", "/api/ide/create", {
      parentPath: fixture.testHome,
      name: createdFileName,
      type: "file",
    });
    expect(createRes.status).toBe(200);
    expect(createRes.data.success).toBe(true);
    expect(createRes.data.type).toBe("file");

    const ideMetricsAfter = fixture.countMetrics("ide_operation");
    const fileMetricsAfter = fixture.countMetrics("file_operation");
    expect(ideMetricsAfter).toBeGreaterThan(ideMetricsBefore);
    expect(fileMetricsAfter).toBeGreaterThan(fileMetricsBefore);
  });

  test("IDE routes block sibling paths that only share HOME prefix", async () => {
    const siblingDir = `${fixture.testHome}-outside-${Date.now()}`;
    const siblingFile = join(siblingDir, "escape.txt");
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(siblingFile, "outside-home", "utf8");

    try {
      const browseRes = await fixture.api(
        "GET",
        `/api/ide/browse?path=${encodeURIComponent(siblingDir)}`
      );
      expect(browseRes.status).toBe(200);
      expect(browseRes.data.success).toBe(false);
      expect(String(browseRes.data.error || "")).toContain("Access denied");

      const readRes = await fixture.api(
        "GET",
        `/api/ide/read?path=${encodeURIComponent(siblingFile)}`
      );
      expect(readRes.status).toBe(200);
      expect(readRes.data.success).toBe(false);
      expect(String(readRes.data.error || "")).toContain("Access denied");

      const writeRes = await fixture.api("POST", "/api/ide/write", {
        path: siblingFile,
        content: "mutated",
      });
      expect(writeRes.status).toBe(200);
      expect(writeRes.data.success).toBe(false);
      expect(String(writeRes.data.error || "")).toContain("Access denied");

      const createRes = await fixture.api("POST", "/api/ide/create", {
        parentPath: siblingDir,
        name: "new.txt",
        type: "file",
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.success).toBe(false);
      expect(String(createRes.data.error || "")).toContain("Access denied");
    } finally {
      rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  test("IDE routes block symlink escapes outside HOME", async () => {
    const outsideDir = `${fixture.testHome}-symlink-outside-${Date.now()}`;
    const outsideFile = join(outsideDir, "outside.txt");
    const linkPath = join(fixture.testHome, `ide-symlink-${Date.now()}`);

    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(outsideFile, "outside-home", "utf8");
    try {
      symlinkSync(outsideDir, linkPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        expect(true).toBe(true);
        rmSync(outsideDir, { recursive: true, force: true });
        return;
      }
      throw error;
    }

    try {
      const linkedFilePath = join(linkPath, "outside.txt");

      const browseRes = await fixture.api(
        "GET",
        `/api/ide/browse?path=${encodeURIComponent(linkPath)}`
      );
      expect(browseRes.status).toBe(200);
      expect(browseRes.data.success).toBe(false);
      expect(String(browseRes.data.error || "")).toContain("Access denied");

      const readRes = await fixture.api(
        "GET",
        `/api/ide/read?path=${encodeURIComponent(linkedFilePath)}`
      );
      expect(readRes.status).toBe(200);
      expect(readRes.data.success).toBe(false);
      expect(String(readRes.data.error || "")).toContain("Access denied");

      const writeRes = await fixture.api("POST", "/api/ide/write", {
        path: join(linkPath, "new.txt"),
        content: "mutated",
      });
      expect(writeRes.status).toBe(200);
      expect(writeRes.data.success).toBe(false);
      expect(String(writeRes.data.error || "")).toContain("Access denied");

      const createRes = await fixture.api("POST", "/api/ide/create", {
        parentPath: linkPath,
        name: "new.txt",
        type: "file",
      });
      expect(createRes.status).toBe(200);
      expect(createRes.data.success).toBe(false);
      expect(String(createRes.data.error || "")).toContain("Access denied");
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  test("Git status/branch routes return shaped responses and diff validates params", async () => {
    const repoDir = mkdtempSync(join(fixture.testHome, "git-status-route-"));
    fixture.git(["init", "-q", "-b", "main"], repoDir);
    const statusRes = await fixture.api(
      "GET",
      `/api/git/status?path=${encodeURIComponent(repoDir)}`
    );
    expect(statusRes.status).toBe(200);
    expect(typeof statusRes.data.isRepo).toBe("boolean");
    expect(Array.isArray(statusRes.data.staged)).toBe(true);
    expect(Array.isArray(statusRes.data.modified)).toBe(true);
    expect(Array.isArray(statusRes.data.untracked)).toBe(true);

    const branchRes = await fixture.api(
      "GET",
      `/api/git/branch?path=${encodeURIComponent(repoDir)}`
    );
    expect(branchRes.status).toBe(200);
    expect("branch" in branchRes.data).toBe(true);

    const missingDiffPathRes = await fixture.api("GET", "/api/git/diff");
    expect(missingDiffPathRes.status).toBe(200);
    expect(missingDiffPathRes.data.success).toBe(false);
    expect(typeof missingDiffPathRes.data.error).toBe("string");
  });

  test("Git routes reject paths outside the IDE home boundary", async () => {
    const outsidePath = parse(homedir()).root;
    const statusRes = await fixture.api(
      "GET",
      `/api/git/status?path=${encodeURIComponent(outsidePath)}`
    );
    const diffRes = await fixture.api(
      "GET",
      `/api/git/diff?path=${encodeURIComponent(outsidePath)}`
    );
    const branchRes = await fixture.api("POST", "/api/git/branch", {
      path: outsidePath,
      branch: "main",
    });

    expect(statusRes.status).toBe(400);
    expect(diffRes.status).toBe(400);
    expect(branchRes.status).toBe(400);
    expect(String(statusRes.data.message || statusRes.data.error)).toContain(
      "outside the allowed IDE scope"
    );
  });

  test("Git branch routes list, checkout, and create branches in a workspace repo", async () => {
    const repoDir = mkdtempSync(join(fixture.testHome, "git-branch-route-"));
    fixture.git(["init", "-q", "-b", "main"], repoDir);
    fixture.git(["config", "user.email", "test@example.com"], repoDir);
    fixture.git(["config", "user.name", "Test"], repoDir);
    writeFileSync(join(repoDir, "file.txt"), "initial\n", "utf8");
    fixture.git(["add", "-A"], repoDir);
    fixture.git(["commit", "-q", "-m", "initial"], repoDir);
    fixture.git(["branch", "feature/ui"], repoDir);

    const listRes = await fixture.api(
      "GET",
      `/api/git/branches?path=${encodeURIComponent(repoDir)}`
    );
    expect(listRes.status).toBe(200);
    expect(listRes.data.success).toBe(true);
    expect(listRes.data.current).toBe("main");
    expect(listRes.data.branches.map((branch: { name: string }) => branch.name)).toContain(
      "feature/ui"
    );

    const checkoutRes = await fixture.api("POST", "/api/git/branch", {
      path: repoDir,
      branch: "feature/ui",
    });
    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.data).toMatchObject({
      success: true,
      branch: "feature/ui",
    });

    const createRes = await fixture.api("POST", "/api/git/branch", {
      path: repoDir,
      branch: "feature/new-local",
      create: true,
    });
    expect(createRes.status).toBe(200);
    expect(createRes.data).toMatchObject({
      success: true,
      branch: "feature/new-local",
    });

    const invalidRes = await fixture.api("POST", "/api/git/branch", {
      path: repoDir,
      branch: "bad branch",
    });
    expect(invalidRes.status).toBe(200);
    expect(invalidRes.data.success).toBe(false);
    expect(String(invalidRes.data.error)).toContain("Invalid branch name");
  });
});

describe("Channel Security API", () => {
  let testChannelId: string;

  beforeAll(async () => {
    const { data } = await fixture.api("POST", "/api/channels", {
      name: `security-test-${Date.now()}`,
      type: "telegram",
      config: { bot_token: "test-token" },
    });
    testChannelId = data?.id;
  });

  test("GET /api/channels/:id/pairings should return pairings", async () => {
    if (!testChannelId) return;
    const { status, data } = await fixture.api("GET", `/api/channels/${testChannelId}/pairings`);
    expect(status).toBe(200);
    expect(Array.isArray(data.pairings)).toBe(true);
    expect(typeof data.pendingCount).toBe("number");
    expect(data.config).toBeDefined();
  });

  test("GET /api/channels/:id/allowed-senders should return senders", async () => {
    if (!testChannelId) return;
    const { status, data } = await fixture.api(
      "GET",
      `/api/channels/${testChannelId}/allowed-senders`
    );
    expect(status).toBe(200);
    expect(Array.isArray(data.senders)).toBe(true);
  });

  test("POST /api/channels/:id/allowed-senders should add sender", async () => {
    if (!testChannelId) return;
    const senderId = `test-sender-${Date.now()}`;
    const { status, data } = await fixture.api(
      "POST",
      `/api/channels/${testChannelId}/allowed-senders`,
      {
        senderId,
      }
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });

  test("PUT /api/channels/:id/security should update security config", async () => {
    if (!testChannelId) return;
    const { status, data } = await fixture.api("PUT", `/api/channels/${testChannelId}/security`, {
      dm_policy: "allowlist",
    });
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config.dm_policy).toBe("allowlist");
  });

  afterAll(async () => {
    if (testChannelId) {
      await fixture.api("DELETE", `/api/channels/${testChannelId}`);
    }
  });
});
