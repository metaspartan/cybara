import { describe, expect, test } from "bun:test";
import {
  buildMobileStatusStreamUrl,
  CybaraMobileApi,
  type SystemPromptConfig,
  normalizeMobileSessionStatusResponse,
  normalizeMobileStatusStreamEvent,
  normalizeActivityLogs,
  normalizeMemoryItems,
  normalizeMemoryList,
  normalizeMemorySearchResults,
  normalizeRemoteItems,
  sortSessionSummaries,
} from "../../apps/mobile/src/lib/api";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";

const profile: GatewayProfile = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:4269",
  apiKey: "cybara_mobile_test",
  createdAt: "2026-06-30T00:00:00.000Z",
};

const systemPromptFixture: SystemPromptConfig = {
  template: "default",
  customPrompt: "",
  defaultBasePrompt: "You are Cybara.",
  identity: {
    name: "Cybara",
    emoji: "",
    creature: "AI assistant",
    vibe: "Useful",
    theme: "dark",
  },
  features: {
    memoryEnabled: true,
    skillsEnabled: true,
    messagingEnabled: true,
    replyTagsEnabled: false,
  },
};

describe("mobile API client", () => {
  test("builds and normalizes the authenticated mobile status stream", () => {
    expect(buildMobileStatusStreamUrl(profile)).toBe(
      "ws://127.0.0.1:4269/api/ws/status?token=cybara_mobile_test"
    );
    expect(
      normalizeMobileStatusStreamEvent({
        type: "snapshot",
        timestamp: 1000,
        activeSessions: [
          {
            sessionId: "s1",
            status: "tool_executing",
            timestamp: 999,
            pendingMessages: [
              {
                id: "pending-1",
                sessionId: "s1",
                content: "follow up",
                createdAt: 1783015200700,
                updatedAt: 1783015200700,
                mode: "queued",
                sequence: 1,
              },
            ],
            activities: [
              {
                id: "activity-1",
                phase: "start",
                text: "Exploring package.json",
                timestamp: 999,
                toolName: "read",
                toolCallId: "read-1",
              },
            ],
          },
        ],
      })
    ).toMatchObject({
      type: "snapshot",
      activeSessions: [
        {
          sessionId: "s1",
          pendingMessages: [{ content: "follow up", mode: "queued" }],
          activities: [{ text: "Exploring package.json", toolCallId: "read-1" }],
        },
      ],
    });
  });

  test("normalizes scoped session status snapshots for chat hydration", () => {
    const status = normalizeMobileSessionStatusResponse({
      sessionId: "s1",
      active: true,
      activeSessionIds: ["s1"],
      session: {
        sessionId: "s1",
        status: "tool_executing",
        timestamp: 1783015200500,
        detail: "Running bun test",
        pendingMessages: [
          {
            id: "pending-1",
            sessionId: "s1",
            content: "steer this",
            createdAt: 1783015200800,
            updatedAt: 1783015200801,
            mode: "steering",
            sequence: 1,
          },
        ],
        activities: [
          {
            id: "activity-1",
            phase: "start",
            text: "Running bun test",
            timestamp: 1783015200400,
            toolName: "exec_command",
            toolCallId: "tool-1",
          },
        ],
      },
    });

    expect(status.active).toBe(true);
    expect(status.session?.sessionId).toBe("s1");
    expect(status.session?.activities[0]).toMatchObject({
      text: "Running bun test",
      toolCallId: "tool-1",
    });
    expect(status.session?.pendingMessages?.[0]).toMatchObject({
      content: "steer this",
      mode: "steering",
    });
  });

  test("dispatches normalized websocket status events", () => {
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;

      constructor(public url: string) {
        FakeWebSocket.instances.push(this);
      }

      close() {
        this.onclose?.();
      }
    }

    const events: unknown[] = [];
    const api = new CybaraMobileApi(profile);
    const disconnect = api.connectStatusStream(
      {
        onEvent: (event) => events.push(event),
      },
      { WebSocketImpl: FakeWebSocket as never }
    );

    expect(FakeWebSocket.instances[0]?.url).toBe(
      "ws://127.0.0.1:4269/api/ws/status?token=cybara_mobile_test"
    );
    FakeWebSocket.instances[0]?.onmessage?.({
      data: JSON.stringify({
        type: "status",
        status: "tool_completed",
        sessionId: "s1",
        timestamp: 1200,
        detail: "Explored package.json",
        toolName: "read",
        toolCallId: "read-1",
      }),
    });
    disconnect();

    expect(events).toEqual([
      {
        type: "status",
        status: "tool_completed",
        sessionId: "s1",
        timestamp: 1200,
        detail: "Explored package.json",
        toolName: "read",
        toolCallId: "read-1",
        toolPhase: undefined,
        agentId: undefined,
        durationMs: undefined,
      },
    ]);
  });

  test("sends bearer auth to gateway requests", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization") });
      return new Response(JSON.stringify({ status: "healthy", uptime: 1, timestamp: "now" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await api.health();
      expect(calls).toEqual([
        {
          url: "http://127.0.0.1:4269/api/health",
          auth: "Bearer cybara_mobile_test",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("manages gateway auth and restart routes through the mobile API client", async () => {
    const calls: Array<{
      method: string;
      path: string;
      auth: string | null;
      gatewayPassword: string | null;
      body?: unknown;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const headers = new Headers(init?.headers);
      calls.push({
        method,
        path: parsedUrl.pathname,
        auth: headers.get("authorization"),
        gatewayPassword: headers.get("x-cybara-gateway-password"),
        body,
      });

      if (parsedUrl.pathname === "/api/auth/settings" && method === "GET") {
        return Response.json({
          success: true,
          apiKeyConfigured: true,
          apiKeyPreview: "cybara_...test",
          apiKeySource: "file",
          apiKeyPath: "/Users/carsen/.cybara/api_key",
          requireAuthForLocalhost: false,
          requireAuthForLocalhostForced: false,
          gatewayPasswordEnabled: false,
          localhostBypassActive: true,
          host: "127.0.0.1",
          configuredHost: "127.0.0.1",
          hostForced: false,
          remoteAccess: {
            enabled: false,
            mode: "private_overlay",
            provider: "tailscale",
            baseUrl: "",
            ready: false,
            requiresGatewayPassword: false,
            status: "off",
            message: "Remote access is off.",
          },
          rateLimits: {},
        });
      }
      if (parsedUrl.pathname === "/api/auth/settings" && method === "PUT") {
        return Response.json({
          success: true,
          apiKeyConfigured: true,
          apiKeyPreview: "cybara_...test",
          apiKeySource: "file",
          apiKeyPath: "/Users/carsen/.cybara/api_key",
          requireAuthForLocalhost: body?.requireAuthForLocalhost,
          requireAuthForLocalhostForced: false,
          host: "127.0.0.1",
          configuredHost: body?.host || "127.0.0.1",
          hostForced: false,
          remoteAccess:
            body?.remoteAccess && typeof body.remoteAccess === "object"
              ? {
                  ...(body.remoteAccess as Record<string, unknown>),
                  ready: true,
                  requiresGatewayPassword: false,
                  status: "ready",
                  message: "Ready.",
                }
              : {
                  enabled: false,
                  mode: "private_overlay",
                  provider: "tailscale",
                  baseUrl: "",
                  ready: false,
                  requiresGatewayPassword: false,
                  status: "off",
                  message: "Remote access is off.",
                },
          gatewayPasswordEnabled:
            typeof body?.gatewayPassword === "string"
              ? true
              : body?.clearGatewayPassword
                ? false
                : false,
          localhostBypassActive: false,
          rateLimits: {},
        });
      }
      if (parsedUrl.pathname === "/api/auth/key" && method === "GET") {
        return Response.json({ success: true, apiKey: "root-key", source: "file" });
      }
      if (parsedUrl.pathname === "/api/auth/rotate-key" && method === "POST") {
        return Response.json({ success: true, apiKey: "rotated-key" });
      }
      if (parsedUrl.pathname === "/api/system/restart" && method === "POST") {
        return Response.json({ success: true, supervised: false, message: "Gateway restarting" });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.gatewayAuthSettings()).resolves.toMatchObject({
        success: true,
        apiKeyConfigured: true,
        apiKeySource: "file",
      });
      await expect(
        api.updateGatewayAuthSettings({ requireAuthForLocalhost: true })
      ).resolves.toMatchObject({
        success: true,
        requireAuthForLocalhost: true,
      });
      await expect(
        api.updateGatewayAuthSettings({ host: "0.0.0.0", applyHostNow: true })
      ).resolves.toMatchObject({
        success: true,
        configuredHost: "0.0.0.0",
      });
      await expect(
        api.updateGatewayAuthSettings({ gatewayPassword: "correct horse battery staple" })
      ).resolves.toMatchObject({
        success: true,
        gatewayPasswordEnabled: true,
      });
      api.setGatewayPassword("correct horse battery staple");
      await expect(
        api.updateGatewayAuthSettings({ clearGatewayPassword: true })
      ).resolves.toMatchObject({
        success: true,
        gatewayPasswordEnabled: false,
      });
      await expect(
        api.updateGatewayAuthSettings({
          remoteAccess: {
            enabled: true,
            mode: "private_overlay",
            provider: "netbird",
            baseUrl: "http://100.94.2.10:4269",
          },
        })
      ).resolves.toMatchObject({
        success: true,
        remoteAccess: {
          enabled: true,
          provider: "netbird",
          baseUrl: "http://100.94.2.10:4269",
        },
      });
      api.setGatewayPassword(undefined);
      await expect(api.revealGatewayApiKey()).resolves.toEqual({
        success: true,
        apiKey: "root-key",
        source: "file",
      });
      const rotated = await api.rotateGatewayApiKey();
      expect(rotated.apiKey).toBe("rotated-key");
      api.setApiKey("rotated-key");
      await expect(api.restartGateway()).resolves.toEqual({
        success: true,
        supervised: false,
        message: "Gateway restarting",
      });

      expect(calls).toEqual([
        {
          method: "GET",
          path: "/api/auth/settings",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: null,
          body: undefined,
        },
        {
          method: "PUT",
          path: "/api/auth/settings",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: null,
          body: { requireAuthForLocalhost: true },
        },
        {
          method: "PUT",
          path: "/api/auth/settings",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: null,
          body: { host: "0.0.0.0", applyHostNow: true },
        },
        {
          method: "PUT",
          path: "/api/auth/settings",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: null,
          body: { gatewayPassword: "correct horse battery staple" },
        },
        {
          method: "PUT",
          path: "/api/auth/settings",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: "correct horse battery staple",
          body: { clearGatewayPassword: true },
        },
        {
          method: "PUT",
          path: "/api/auth/settings",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: "correct horse battery staple",
          body: {
            remoteAccess: {
              enabled: true,
              mode: "private_overlay",
              provider: "netbird",
              baseUrl: "http://100.94.2.10:4269",
            },
          },
        },
        {
          method: "GET",
          path: "/api/auth/key",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: null,
          body: undefined,
        },
        {
          method: "POST",
          path: "/api/auth/rotate-key",
          auth: "Bearer cybara_mobile_test",
          gatewayPassword: null,
          body: undefined,
        },
        {
          method: "POST",
          path: "/api/system/restart",
          auth: "Bearer rotated-key",
          gatewayPassword: null,
          body: undefined,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("manages mobile push notification routes with paired-device auth", async () => {
    const calls: Array<{ method: string; path: string; auth: string | null; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      const headers = new Headers(init?.headers);
      calls.push({ method, path: parsedUrl.pathname, auth: headers.get("authorization"), body });
      if (parsedUrl.pathname === "/api/mobile/push-token" && method === "POST") {
        return Response.json({
          success: true,
          device: {
            id: "mobile-1",
            name: "iPhone",
            push: {
              configured: body?.enabled !== false,
              provider: "expo",
              platform: body?.platform,
            },
          },
        });
      }
      if (parsedUrl.pathname === "/api/mobile/push/test" && method === "POST") {
        return Response.json({
          success: true,
          result: { attempted: 1, sent: 1, skipped: false, errors: [] },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(
        api.registerPushToken({
          token: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]",
          platform: "ios",
        })
      ).resolves.toMatchObject({
        success: true,
        device: { push: { configured: true, provider: "expo", platform: "ios" } },
      });
      await expect(api.sendTestPush()).resolves.toMatchObject({
        success: true,
        result: { sent: 1 },
      });
      await expect(api.clearPushToken()).resolves.toMatchObject({
        success: true,
        device: { push: { configured: false } },
      });

      expect(calls).toEqual([
        {
          method: "POST",
          path: "/api/mobile/push-token",
          auth: "Bearer cybara_mobile_test",
          body: {
            token: "ExpoPushToken[abcdefghijklmnopqrstuvwxyz]",
            provider: "expo",
            platform: "ios",
            enabled: true,
          },
        },
        {
          method: "POST",
          path: "/api/mobile/push/test",
          auth: "Bearer cybara_mobile_test",
          body: undefined,
        },
        {
          method: "POST",
          path: "/api/mobile/push-token",
          auth: "Bearer cybara_mobile_test",
          body: { enabled: false },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("persists mobile theme config through the gateway config endpoint", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });
      if (parsedUrl.pathname === "/api/config" && method === "PUT") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(
        new CybaraMobileApi(profile).updateConfig({
          theme: "emerald",
          themeAccent: "emerald",
          theme_accent: "emerald",
          ui_accent: "emerald",
        })
      ).resolves.toEqual({ success: true });
      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/config",
          body: {
            theme: "emerald",
            themeAccent: "emerald",
            theme_accent: "emerald",
            ui_accent: "emerald",
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads and updates model router settings through gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/router/config" && method === "GET") {
        return Response.json({
          enabled: true,
          strategy: "lowest_cost",
          fallbackToAny: false,
          globalSpendLimitDaily: 25,
          routes: {
            openai: { weight: 80, enabled: true, model: "gpt-5.4" },
          },
        });
      }
      if (parsedUrl.pathname === "/api/router/status" && method === "GET") {
        return Response.json({
          enabled: true,
          strategy: "lowest_cost",
          globalSpendToday: 1.25,
          routes: [
            {
              providerId: "openai",
              weight: 80,
              enabled: true,
              available: true,
              requestsIn5hWindow: 3,
              requestsInWeekWindow: 12,
              spendToday: 1.25,
              spendThisWeek: 6.5,
            },
          ],
        });
      }
      if (parsedUrl.pathname === "/api/router/config" && method === "PUT") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.routerConfig()).resolves.toEqual({
        enabled: true,
        strategy: "lowest_cost",
        fallbackToAny: false,
        globalSpendLimitDaily: 25,
        routes: {
          openai: { weight: 80, enabled: true, model: "gpt-5.4" },
        },
      });
      await expect(api.routerStatus()).resolves.toMatchObject({
        enabled: true,
        strategy: "lowest_cost",
        globalSpendToday: 1.25,
        routes: [{ providerId: "openai", available: true, spendToday: 1.25 }],
      });
      await expect(
        api.updateRouterConfig({
          enabled: false,
          strategy: "weighted",
          fallbackToAny: true,
          routes: {},
        })
      ).resolves.toEqual({ success: true });

      expect(calls).toEqual([
        { method: "GET", path: "/api/router/config", body: undefined },
        { method: "GET", path: "/api/router/status", body: undefined },
        {
          method: "PUT",
          path: "/api/router/config",
          body: {
            enabled: false,
            strategy: "weighted",
            fallbackToAny: true,
            routes: {},
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads and updates provider plan monitoring through gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/provider-plans/config" && method === "GET") {
        return Response.json({
          enabled: true,
          routerEnforcement: true,
          warningThresholdPct: 80,
          staleAfterMinutes: 120,
          providers: {
            "openai-codex": {
              enabled: true,
              presetId: "openai-codex-plus",
              planName: "Codex Plus",
              sourceMode: "browser_cookie",
              externalSourceEnabled: true,
              monthly: { enabled: true, tokenLimit: 2_000_000, spendLimit: 20 },
            },
          },
        });
      }
      if (parsedUrl.pathname === "/api/provider-plans/status" && method === "GET") {
        return Response.json({
          enabled: true,
          routerEnforcement: true,
          warningThresholdPct: 80,
          providers: [
            {
              providerId: "openai-codex",
              providerType: "openai-codex",
              providerName: "OpenAI Codex",
              authType: "oauth",
              monitored: true,
              appliedPresetId: "openai-codex-plus",
              source: "local_metrics_configured_limits",
              sourceMode: "local",
              sourceLabel: "Local usage with configured limits",
              externalSourceAvailable: true,
              externalSourceMode: "oauth_api",
              externalSourceLabel: "OpenAI OAuth usage",
              externalSourceHint: "Use OpenAI OAuth usage APIs.",
              status: "warning",
              localTokens30d: 1_700_000,
              localSpend30d: 17.25,
              presetSuggestions: [
                {
                  id: "openai-codex-plus",
                  label: "ChatGPT Plus",
                  planName: "Codex Plus",
                  description: "Moderate local coding sessions.",
                  confidence: "dynamic",
                  sourceMode: "oauth_api",
                  limitDescription: "Codex uses your ChatGPT agentic allowance.",
                  externalSourceEnabled: true,
                },
              ],
              windows: [
                {
                  id: "monthly",
                  title: "Billing month",
                  kind: "billing_month",
                  usedTokens: 1_700_000,
                  tokenLimit: 2_000_000,
                  usedSpend: 17.25,
                  spendLimit: 20,
                  usedPercent: 85,
                  remainingPercent: 15,
                  resetDescription: "Resets Aug 1",
                  usageKnown: true,
                },
              ],
            },
          ],
          summary: { total: 1, monitored: 1, configured: 1, warnings: 1, exhausted: 0 },
        });
      }
      if (parsedUrl.pathname === "/api/provider-plans/config" && method === "PUT") {
        return Response.json(body);
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.providerPlanConfig()).resolves.toMatchObject({
        enabled: true,
        routerEnforcement: true,
        providers: {
          "openai-codex": {
            presetId: "openai-codex-plus",
            planName: "Codex Plus",
            sourceMode: "browser_cookie",
            externalSourceEnabled: true,
            monthly: { tokenLimit: 2_000_000, spendLimit: 20 },
          },
        },
      });
      await expect(api.providerPlanStatus()).resolves.toMatchObject({
        summary: { monitored: 1, configured: 1, warnings: 1 },
        providers: [
          {
            providerId: "openai-codex",
            status: "warning",
            appliedPresetId: "openai-codex-plus",
            sourceLabel: "Local usage with configured limits",
            externalSourceLabel: "OpenAI OAuth usage",
            presetSuggestions: [
              {
                id: "openai-codex-plus",
                label: "ChatGPT Plus",
                sourceMode: "oauth_api",
              },
            ],
            windows: [{ id: "monthly", usedPercent: 85 }],
          },
        ],
      });
      await expect(
        api.updateProviderPlanConfig({
          enabled: true,
          routerEnforcement: true,
          warningThresholdPct: 75,
          staleAfterMinutes: 120,
          providers: {
            "openai-codex": {
              enabled: true,
              monthly: { enabled: true, tokenLimit: 2_500_000 },
            },
          },
        })
      ).resolves.toMatchObject({
        warningThresholdPct: 75,
        providers: { "openai-codex": { monthly: { tokenLimit: 2_500_000 } } },
      });

      expect(calls).toEqual([
        { method: "GET", path: "/api/provider-plans/config", body: undefined },
        { method: "GET", path: "/api/provider-plans/status", body: undefined },
        {
          method: "PUT",
          path: "/api/provider-plans/config",
          body: {
            enabled: true,
            routerEnforcement: true,
            warningThresholdPct: 75,
            staleAfterMinutes: 120,
            providers: {
              "openai-codex": {
                enabled: true,
                monthly: { enabled: true, tokenLimit: 2_500_000 },
              },
            },
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads and updates system prompt settings through gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/system-prompt" && method === "GET") {
        return Response.json(systemPromptFixture);
      }
      if (parsedUrl.pathname === "/api/system-prompt" && method === "PUT") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.systemPrompt()).resolves.toEqual(systemPromptFixture);
      await expect(
        api.updateSystemPrompt({
          ...systemPromptFixture,
          features: {
            ...systemPromptFixture.features,
            memoryEnabled: false,
          },
        })
      ).resolves.toEqual({ success: true });

      expect(calls).toEqual([
        { method: "GET", path: "/api/system-prompt", body: undefined },
        {
          method: "PUT",
          path: "/api/system-prompt",
          body: {
            ...systemPromptFixture,
            features: {
              ...systemPromptFixture.features,
              memoryEnabled: false,
            },
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("manages gateway memory files through the mobile API client", async () => {
    const calls: Array<{ method: string; path: string; search: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, search: parsedUrl.search, body });

      if (parsedUrl.pathname === "/api/memory" && method === "GET") {
        return Response.json({
          files: ["project notes.md"],
          memories: [
            {
              file: "project notes.md",
              entries: [
                {
                  timestamp: "2026-07-02T18:00:00.000Z",
                  type: "note",
                  content: "remember this",
                },
              ],
            },
          ],
        });
      }
      if (parsedUrl.pathname === "/api/memory/search" && method === "GET") {
        return Response.json({
          results: [{ file: "project notes.md", entry: { content: "remember this" } }],
        });
      }
      if (parsedUrl.pathname === "/api/memory" && method === "POST") {
        return Response.json({ success: true, file: body?.file, appended: false });
      }
      if (parsedUrl.pathname === "/api/memory/project%20notes.md" && method === "PUT") {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/memory/project%20notes.md" && method === "DELETE") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.memoryList()).resolves.toEqual({
        files: ["project notes.md"],
        memories: [
          {
            file: "project notes.md",
            entries: [
              {
                timestamp: "2026-07-02T18:00:00.000Z",
                type: "note",
                content: "remember this",
              },
            ],
          },
        ],
      });
      await expect(api.searchMemory("remember this")).resolves.toEqual([
        { file: "project notes.md", entry: { content: "remember this" } },
      ]);
      await expect(api.createMemory("project notes.md", "new memory")).resolves.toEqual({
        success: true,
        file: "project notes.md",
        appended: false,
      });
      await expect(api.updateMemory("project notes.md", 0, "updated memory")).resolves.toEqual({
        success: true,
      });
      await expect(api.deleteMemory("project notes.md", 0)).resolves.toEqual({ success: true });

      expect(calls).toEqual([
        { method: "GET", path: "/api/memory", search: "", body: undefined },
        {
          method: "GET",
          path: "/api/memory/search",
          search: "?query=remember%20this",
          body: undefined,
        },
        {
          method: "POST",
          path: "/api/memory",
          search: "",
          body: { file: "project notes.md", content: "new memory" },
        },
        {
          method: "PUT",
          path: "/api/memory/project%20notes.md",
          search: "",
          body: { index: 0, content: "updated memory" },
        },
        {
          method: "DELETE",
          path: "/api/memory/project%20notes.md",
          search: "",
          body: { index: 0 },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("encodes fuzzed memory filenames before mobile edit and delete requests", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method: init?.method || "GET", path: parsedUrl.pathname, body });
      return Response.json({ success: true });
    }) as typeof fetch;

    const filenames = [
      "project notes.md",
      "../workspace.md",
      "folder/nested.md",
      "emoji-😀.md",
      "percent%20literal.md",
      "windows\\path.md",
    ];

    try {
      const api = new CybaraMobileApi(profile);
      for (const [index, file] of filenames.entries()) {
        await api.updateMemory(file, index, `updated ${index}`);
        await api.deleteMemory(file, index);
      }

      expect(calls).toHaveLength(filenames.length * 2);
      for (const [index, file] of filenames.entries()) {
        const encodedPath = `/api/memory/${encodeURIComponent(file)}`;
        expect(calls[index * 2]).toEqual({
          method: "PUT",
          path: encodedPath,
          body: { index, content: `updated ${index}` },
        });
        expect(calls[index * 2 + 1]).toEqual({
          method: "DELETE",
          path: encodedPath,
          body: { index },
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("updates wallet settings and sends through gateway wallet routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/wallet/agent-access" && method === "PUT") {
        return Response.json({ success: true, enabled: true });
      }
      if (parsedUrl.pathname === "/api/wallet/agent-policy" && method === "PUT") {
        return Response.json({
          success: true,
          policy: { allowNativeSend: true, allowTokenSend: false },
        });
      }
      if (parsedUrl.pathname === "/api/wallet/send" && method === "POST") {
        return Response.json({
          chain: body?.chain,
          txid: "0xnative",
          explorerUrl: "https://example.test/tx/0xnative",
        });
      }
      if (parsedUrl.pathname === "/api/wallet/send-token" && method === "POST") {
        return Response.json({
          chain: body?.chain,
          txid: "0xtoken",
          explorerUrl: "https://example.test/tx/0xtoken",
          tokenAddress: body?.tokenAddress,
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.setWalletAgentAccess(true)).resolves.toEqual({
        success: true,
        enabled: true,
      });
      await expect(api.updateWalletAgentPolicy({ allowNativeSend: true })).resolves.toEqual({
        success: true,
        policy: { allowNativeSend: true, allowTokenSend: false },
      });
      await expect(
        api.sendWallet({ chain: "eth", to: "0xrecipient", amount: "0.01", memo: "mobile" })
      ).resolves.toEqual({
        chain: "eth",
        txid: "0xnative",
        explorerUrl: "https://example.test/tx/0xnative",
      });
      await expect(
        api.sendWalletToken({
          chain: "eth",
          tokenAddress: "0xtoken",
          to: "0xrecipient",
          amount: "5",
          decimals: 6,
        })
      ).resolves.toEqual({
        chain: "eth",
        txid: "0xtoken",
        explorerUrl: "https://example.test/tx/0xtoken",
        tokenAddress: "0xtoken",
      });

      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/wallet/agent-access",
          body: { enabled: true },
        },
        {
          method: "PUT",
          path: "/api/wallet/agent-policy",
          body: {
            allowNativeSend: true,
          },
        },
        {
          method: "POST",
          path: "/api/wallet/send",
          body: { chain: "eth", to: "0xrecipient", amount: "0.01", memo: "mobile" },
        },
        {
          method: "POST",
          path: "/api/wallet/send-token",
          body: {
            chain: "eth",
            tokenAddress: "0xtoken",
            to: "0xrecipient",
            amount: "5",
            decimals: 6,
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("edits and controls agents through gateway agent routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/agents/agent-1" && method === "PUT") {
        return Response.json({
          id: "agent-1",
          name: "Code Assistant",
          type: "coder",
          model: "MiniMax-M2.5",
          provider_id: "provider-1",
          system_prompt: "Work carefully.",
        });
      }
      if (parsedUrl.pathname === "/api/agents/agent-1/start" && method === "POST") {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/agents/agent-1/stop" && method === "POST") {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/agents/agent-1" && method === "DELETE") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      const updated = await api.updateAgent("agent-1", {
        name: "Code Assistant",
        type: "coder",
        provider_id: "provider-1",
        model: "MiniMax-M2.5",
        system_prompt: "Work carefully.",
      });
      await expect(api.startAgent("agent-1")).resolves.toEqual({ success: true });
      await expect(api.stopAgent("agent-1")).resolves.toEqual({ success: true });
      await expect(api.deleteAgent("agent-1")).resolves.toEqual({ success: true });

      expect(updated).toMatchObject({
        id: "agent-1",
        name: "Code Assistant",
        type: "coder",
        provider_id: "provider-1",
        provider: "provider-1",
        system_prompt: "Work carefully.",
      });
      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/agents/agent-1",
          body: {
            name: "Code Assistant",
            type: "coder",
            provider_id: "provider-1",
            model: "MiniMax-M2.5",
            system_prompt: "Work carefully.",
          },
        },
        { method: "POST", path: "/api/agents/agent-1/start", body: undefined },
        { method: "POST", path: "/api/agents/agent-1/stop", body: undefined },
        { method: "DELETE", path: "/api/agents/agent-1", body: undefined },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("edits, tests, and deletes providers through gateway provider routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/providers/provider-1" && method === "PUT") {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/providers/provider-1/test" && method === "POST") {
        return Response.json({
          success: true,
          provider: "openai",
          message: "OpenAI credentials verified",
        });
      }
      if (parsedUrl.pathname === "/api/providers/provider-1" && method === "DELETE") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(
        api.updateProvider("provider-1", {
          name: "OpenAI Work",
          base_url: "https://api.openai.com/v1",
          api_key: "new-key",
          is_default: true,
        })
      ).resolves.toEqual({ success: true });
      await expect(api.testProvider("provider-1")).resolves.toMatchObject({
        success: true,
        message: "OpenAI credentials verified",
      });
      await expect(api.deleteProvider("provider-1")).resolves.toEqual({ success: true });

      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/providers/provider-1",
          body: {
            name: "OpenAI Work",
            base_url: "https://api.openai.com/v1",
            api_key: "new-key",
            is_default: true,
          },
        },
        { method: "POST", path: "/api/providers/provider-1/test", body: undefined },
        { method: "DELETE", path: "/api/providers/provider-1", body: undefined },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("merges provider health state without exposing provider secrets", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname === "/api/providers") {
        return Response.json([
          {
            id: "provider-1",
            name: "OpenAI",
            provider: "openai",
            info: { authType: "api_key" },
          },
        ]);
      }
      if (parsedUrl.pathname === "/api/providers/health") {
        return Response.json({
          providers: [
            {
              id: "provider-1",
              configured: true,
              requiresCredentials: true,
            },
          ],
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(new CybaraMobileApi(profile).providers()).resolves.toEqual([
        {
          id: "provider-1",
          name: "OpenAI",
          provider: "openai",
          base_url: undefined,
          is_default: false,
          configured: true,
          requiresCredentials: true,
          hasCredentials: true,
          authType: "api_key",
          oauthFlow: null,
          hasOAuthConfig: false,
          oauthLoginUrl: null,
          models: [],
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("normalizes OAuth provider metadata from gateway provider info", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname === "/api/providers") {
        return Response.json([
          {
            id: "provider-codex",
            name: "OpenAI Codex",
            provider: "openai-codex",
            info: {
              authType: "oauth",
              oauthFlow: "redirect",
              oauthConfig: { callbackPort: 1455 },
              oauthLoginUrl: "https://chatgpt.com/",
            },
          },
        ]);
      }
      if (parsedUrl.pathname === "/api/providers/health") {
        return Response.json({ providers: [] });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(new CybaraMobileApi(profile).providers()).resolves.toEqual([
        expect.objectContaining({
          id: "provider-codex",
          provider: "openai-codex",
          authType: "oauth",
          oauthFlow: "redirect",
          hasOAuthConfig: true,
          oauthLoginUrl: "https://chatgpt.com/",
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("starts and polls provider OAuth through gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/providers/oauth/start") {
        return Response.json({ auth_url: "https://auth.example/start", state: "oauth-state" });
      }
      if (parsedUrl.pathname === "/api/providers/oauth/callback-status") {
        return Response.json({ status: "success", access_token: "oauth-token" });
      }
      if (parsedUrl.pathname === "/api/open-url") {
        return Response.json({ ok: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.startProviderOAuth("openai-codex")).resolves.toEqual({
        auth_url: "https://auth.example/start",
        state: "oauth-state",
      });
      await expect(api.providerOAuthCallbackStatus("oauth-state")).resolves.toEqual({
        status: "success",
        access_token: "oauth-token",
      });
      await expect(api.openUrlOnGateway("https://auth.example/start")).resolves.toEqual({
        ok: true,
      });
      expect(calls).toEqual([
        {
          method: "POST",
          path: "/api/providers/oauth/start",
          body: { providerType: "openai-codex" },
        },
        {
          method: "POST",
          path: "/api/providers/oauth/callback-status",
          body: { state: "oauth-state" },
        },
        {
          method: "POST",
          path: "/api/open-url",
          body: { url: "https://auth.example/start" },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("controls channel, task, and approval settings through gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/channels/channel-1" && method === "PUT") {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/channels/channel-1/test" && method === "POST") {
        return Response.json({ success: true, message: "Channel verified" });
      }
      if (parsedUrl.pathname === "/api/channels/channel-1" && method === "DELETE") {
        return Response.json({ success: true });
      }
      if (
        ["/api/tasks/task-1/start", "/api/tasks/task-1/stop", "/api/tasks/task-1/run"].includes(
          parsedUrl.pathname
        ) &&
        method === "POST"
      ) {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/tasks/task-1" && method === "DELETE") {
        return Response.json({ success: true });
      }
      if (parsedUrl.pathname === "/api/tools/approvals/resolve" && method === "POST") {
        return Response.json({ success: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(
        api.updateChannel("channel-1", { name: "Telegram", enabled: false })
      ).resolves.toEqual({
        success: true,
      });
      await expect(api.testChannel("channel-1")).resolves.toMatchObject({
        success: true,
        message: "Channel verified",
      });
      await expect(api.deleteChannel("channel-1")).resolves.toEqual({ success: true });
      await expect(api.startTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.stopTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.runTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.deleteTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.resolveToolApproval("approval-1", "approve_once")).resolves.toEqual({
        success: true,
      });

      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/channels/channel-1",
          body: { name: "Telegram", enabled: false },
        },
        { method: "POST", path: "/api/channels/channel-1/test", body: undefined },
        { method: "DELETE", path: "/api/channels/channel-1", body: undefined },
        { method: "POST", path: "/api/tasks/task-1/start", body: undefined },
        { method: "POST", path: "/api/tasks/task-1/stop", body: undefined },
        { method: "POST", path: "/api/tasks/task-1/run", body: undefined },
        { method: "DELETE", path: "/api/tasks/task-1", body: undefined },
        {
          method: "POST",
          path: "/api/tools/approvals/resolve",
          body: { requestId: "approval-1", decision: "approve_once" },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads a broad feature summary without failing when optional surfaces are unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") {
        return Response.json({ status: "healthy", uptime: 12, timestamp: "now" });
      }
      if (path === "/api/sessions") {
        return Response.json({
          sessions: [{ id: "s1", title: "Build", message_count: 3, updated_at: "now" }],
          total: 1200,
          limit: 100,
          offset: 0,
          hasMore: true,
        });
      }
      if (path === "/api/agents") return Response.json([{ id: "a1", name: "Main" }]);
      if (path === "/api/providers")
        return Response.json([{ id: "p1", name: "Anthropic", provider: "anthropic" }]);
      if (path === "/api/system/monitor") {
        return Response.json({
          status: "healthy",
          timestamp: "2026-06-30T08:00:00.000Z",
          sampleIntervalMs: 1000,
          platform: { type: "darwin", arch: "arm64", release: "26.0.0" },
          cpu: {
            usagePct: 12.5,
            loadPct: 45,
            loadAverage: [1.2, 1.1, 1],
            cores: 10,
            model: "Test CPU",
          },
          memory: {
            totalBytes: 1000,
            freeBytes: 400,
            usedBytes: 600,
            usedPct: 60,
            swap: { totalBytes: 500, freeBytes: 250, usedBytes: 250, usedPct: 50 },
          },
          process: {
            pid: 123,
            uptimeSeconds: 60,
            cpuUsagePct: 2.5,
            memory: {
              rssBytes: 100,
              heapUsedBytes: 50,
              heapTotalBytes: 80,
              externalBytes: 10,
              arrayBuffersBytes: 5,
            },
          },
          disk: { path: "/tmp", totalBytes: 1000, freeBytes: 250, usedBytes: 750, usedPct: 75 },
        });
      }
      if (path === "/api/system-prompt") return Response.json(systemPromptFixture);
      if (path === "/api/config") return Response.json({ tool_approval_mode: "ask" });
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const summary = await new CybaraMobileApi(profile).featureSummary();
      expect(summary.health?.status).toBe("healthy");
      expect(summary.sessions).toHaveLength(1);
      expect(summary.sessionTotal).toBe(1200);
      expect(summary.agents).toHaveLength(1);
      expect(summary.providers).toHaveLength(1);
      expect(summary.channels).toEqual([]);
      expect(summary.availability.channels.ok).toBe(false);
      expect(summary.availability.channels.status).toBe(404);
      expect(summary.availability.systemMonitor.ok).toBe(true);
      expect(summary.systemMonitor?.cpu.usagePct).toBe(12.5);
      expect(summary.systemMonitor?.memory.swap?.usedPct).toBe(50);
      expect(summary.availability.systemPrompt.ok).toBe(true);
      expect(summary.systemPrompt?.features.memoryEnabled).toBe(true);
      expect(summary.config.tool_approval_mode).toBe("ask");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads combined desktop gateway logs for the mobile feature summary", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      calls.push(`${parsedUrl.pathname}${parsedUrl.search}`);
      if (parsedUrl.pathname === "/api/logs/system") {
        return Response.json({
          logs: [
            {
              id: "newer-agent-log",
              level: "info",
              source: "agent",
              message: "Agent abc12345... completed task",
              created_at: "2026-06-30T09:00:00.000Z",
              logType: "agent",
            },
            {
              id: "older-system-log",
              level: "info",
              source: "system",
              message: "Gateway started",
              created_at: "2026-06-30T08:00:00.000Z",
              logType: "system",
            },
          ],
          total: 2604,
          limit: 150,
          offset: 0,
          hasMore: true,
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const summary = await new CybaraMobileApi(profile).featureSummary();

      expect(summary.logs.map((log) => log.id)).toEqual(["newer-agent-log", "older-system-log"]);
      expect(summary.logs[0]).toMatchObject({
        title: "Agent abc12345... completed task",
        detail: "agent",
        source: "agent",
        createdAt: "2026-06-30T09:00:00.000Z",
      });
      expect(summary.logsTotal).toBe(2604);
      expect(summary.logsLimit).toBe(150);
      expect(summary.logsHasMore).toBe(true);
      expect(summary.availability.logs.ok).toBe(true);
      expect(calls).toContain("/api/logs/system?limit=150&offset=0&includeTotal=1");
      expect(calls).not.toContain("/api/logs/activity?minutes=1440");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to recent activity logs on older gateways without combined logs", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      calls.push(`${parsedUrl.pathname}${parsedUrl.search}`);
      if (parsedUrl.pathname === "/api/logs/system") {
        return new Response("missing", { status: 404 });
      }
      if (parsedUrl.pathname === "/api/logs/activity") {
        return Response.json({
          system: [
            {
              id: "system-activity",
              message: "Health probe recovered",
              created_at: "2026-06-30T08:00:00.000Z",
            },
          ],
          messages: [
            {
              id: "message-activity",
              content: "User asked for logs",
              session_id: "session-1",
              created_at: "2026-06-30T09:00:00.000Z",
            },
          ],
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const logs = await new CybaraMobileApi(profile).logs();

      expect(calls).toEqual([
        "/api/logs/system?limit=150&offset=0&includeTotal=1",
        "/api/logs/activity?minutes=1440",
      ]);
      expect(logs.map((log) => log.id)).toEqual(["message-activity", "system-activity"]);
      expect(logs[0]).toMatchObject({
        title: "User asked for logs",
        detail: "session-1",
        source: "messages",
        createdAt: "2026-06-30T09:00:00.000Z",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads additional mobile log pages with explicit offsets", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      calls.push(`${parsedUrl.pathname}${parsedUrl.search}`);
      if (parsedUrl.pathname === "/api/logs/system") {
        return Response.json({
          logs: [
            {
              id: "log-151",
              level: "info",
              source: "channel",
              message: "Next page row",
              created_at: "2026-06-30T07:59:00.000Z",
              logType: "channel",
            },
          ],
          total: 2604,
          limit: 150,
          offset: 150,
          hasMore: true,
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const page = await new CybaraMobileApi(profile).logsPage(150, 150);

      expect(calls).toEqual(["/api/logs/system?limit=150&offset=150&includeTotal=1"]);
      expect(page.total).toBe(2604);
      expect(page.offset).toBe(150);
      expect(page.hasMore).toBe(true);
      expect(page.logs[0]).toMatchObject({ id: "log-151", source: "channel" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses bounded session endpoints and posts into an existing mobile chat", async () => {
    const calls: Array<{ method: string; path: string; search: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, search: parsedUrl.search, body });

      if (parsedUrl.pathname === "/api/sessions") {
        return Response.json([
          {
            id: "s1",
            title: "Build mobile",
            agentId: "agent-1",
            providerName: "OpenAI",
            provider: "openai",
            providerId: "provider-openai",
            model: "gpt-5-mini",
            messageCount: 2,
            updatedAt: "2026-06-30T08:00:00.000Z",
          },
        ]);
      }

      if (parsedUrl.pathname === "/api/sessions/s1") {
        return Response.json({
          id: "s1",
          title: "Build mobile",
          agent_id: "agent-1",
          provider_name: "OpenAI",
          provider: "openai",
          provider_id: "provider-openai",
          model: "gpt-5-mini",
          workspace_dir: "/repo",
          contextUsage: {
            usedTokens: 1200,
            limitTokens: 128000,
            remainingTokens: 126800,
            usedPercent: 0.9,
            messageCount: 1,
          },
          messagesList: [
            {
              id: "m1",
              role: "assistant",
              content: "Done",
              thinking: "checking files",
              tool_calls: [{ id: "tool-1", name: "read_file", status: "completed" }],
              process_activities: [
                {
                  id: "activity-1",
                  phase: "result",
                  text: "Read DashboardScreen",
                  timestamp: 1000,
                  toolName: "read_file",
                },
              ],
            },
          ],
        });
      }

      if (parsedUrl.pathname === "/api/chat" && method === "POST") {
        return Response.json({
          sessionId: "s1",
          workspaceDir: "/repo",
          contextUsage: {
            usedTokens: 1500,
            limitTokens: 128000,
            remainingTokens: 126500,
            usedPercent: 1.2,
            messageCount: 2,
          },
          thinking: "top-level thought",
          message: {
            id: "m2",
            role: "assistant",
            content: "Updated",
            timestamp: "2026-06-30T08:01:00.000Z",
            tool_calls: [
              {
                id: "tool-2",
                name: "shell",
                status: "completed",
                args: { cmd: "bun test" },
                result: { stdout: "ok ✅", exit_code: 0 },
                duration: "1.2s",
              },
            ],
          },
        });
      }

      if (parsedUrl.pathname === "/api/sessions/s1/agent" && method === "PUT") {
        return Response.json({
          success: true,
          sessionId: "s1",
          agentId: "agent-2",
          agentName: "Coder",
          provider: "openai",
          providerId: "provider-openai",
          providerName: "OpenAI",
          model: "gpt-5-codex",
          contextUsage: {
            usedTokens: 1800,
            limitTokens: 128000,
            remainingTokens: 126200,
            usedPercent: 1.4,
            messageCount: 2,
          },
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      const sessions = await api.sessions();
      const detail = await api.session("s1");
      const sent = await api.sendChat({ sessionId: "s1", message: "continue", agentId: "agent-1" });
      const updatedAgent = await api.updateSessionAgent("s1", "agent-2");

      expect(sessions[0]).toMatchObject({
        id: "s1",
        agent_id: "agent-1",
        provider_name: "OpenAI",
        provider: "openai",
        provider_id: "provider-openai",
        model: "gpt-5-mini",
        message_count: 2,
      });
      expect(detail).toMatchObject({
        providerName: "OpenAI",
        provider: "openai",
        providerId: "provider-openai",
        model: "gpt-5-mini",
      });
      expect(detail.messages[0].toolCalls?.[0].name).toBe("read_file");
      expect(detail.messages[0].processActivities?.[0].text).toBe("Read DashboardScreen");
      expect(detail.contextUsage?.usedTokens).toBe(1200);
      expect(detail.contextUsage?.limitTokens).toBe(128000);
      expect(sent.contextUsage?.usedTokens).toBe(1500);
      expect(updatedAgent).toMatchObject({
        success: true,
        agentId: "agent-2",
        model: "gpt-5-codex",
      });
      expect(updatedAgent.contextUsage?.usedTokens).toBe(1800);
      expect(sent.message.thinking).toBe("top-level thought");
      expect(sent.message.toolCalls?.[0].name).toBe("shell");
      expect(sent.message.toolCalls?.[0]).toMatchObject({
        command: "bun test",
        resultSummary: "ok ✅",
        exitCode: "0",
        duration: "1.2s",
      });
      expect(calls.map((call) => `${call.method} ${call.path}${call.search}`)).toEqual([
        "GET /api/sessions?limit=100&includeTotal=1",
        "GET /api/sessions/s1?includeFullToolCalls=1",
        "POST /api/chat",
        "PUT /api/sessions/s1/agent",
      ]);
      expect(calls[2].body).toMatchObject({
        sessionId: "s1",
        agentId: "agent-1",
        message: "continue",
      });
      expect(calls[3].body).toMatchObject({ agentId: "agent-2" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("normalizes queued and interrupted mobile chat responses", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/chat" && method === "POST") {
        if (body?.queueMode === "queue") {
          return Response.json({
            sessionId: "s1",
            queued: true,
            pendingMessage: {
              id: "pending-1",
              sessionId: "s1",
              clientPendingId: body.clientPendingId,
              content: body.message,
              createdAt: 1783015200000,
              updatedAt: 1783015200000,
              mode: "queued",
              sequence: 1,
            },
          });
        }

        return Response.json({
          sessionId: "s1",
          interrupted: true,
          message: {
            role: "assistant",
            content: "",
          },
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      const queued = await api.sendChat({
        sessionId: "s1",
        message: "queue this",
        queueMode: "queue",
        clientPendingId: "optimistic-mobile-1",
      });
      const interrupted = await api.sendChat({
        sessionId: "s1",
        message: "active turn",
      });

      expect(queued).toMatchObject({
        sessionId: "s1",
        queued: true,
        pendingMessage: {
          id: "pending-1",
          clientPendingId: "optimistic-mobile-1",
          content: "queue this",
          mode: "queued",
        },
      });
      expect(interrupted.interrupted).toBe(true);
      expect(interrupted.message.content).toBe("");
      expect(calls.map((call) => call.body)).toEqual([
        {
          sessionId: "s1",
          message: "queue this",
          queueMode: "queue",
          clientPendingId: "optimistic-mobile-1",
        },
        {
          sessionId: "s1",
          message: "active turn",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reorders pending mobile chat messages through the gateway endpoint", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/chat/sessions/s1/pending/reorder" && method === "POST") {
        return Response.json({
          success: true,
          pendingMessages: [
            {
              id: "pending-2",
              sessionId: "s1",
              content: "second",
              createdAt: 1783015200100,
              updatedAt: 1783015200200,
              mode: "queued",
              sequence: 1,
            },
            {
              id: "pending-1",
              sessionId: "s1",
              content: "first",
              createdAt: 1783015200000,
              updatedAt: 1783015200200,
              mode: "queued",
              sequence: 2,
            },
          ],
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await new CybaraMobileApi(profile).reorderPendingMessages("s1", [
        "pending-2",
        "pending-1",
      ]);

      expect(result.success).toBe(true);
      expect(result.pendingMessages?.map((entry) => entry.id)).toEqual(["pending-2", "pending-1"]);
      expect(calls).toEqual([
        {
          method: "POST",
          path: "/api/chat/sessions/s1/pending/reorder",
          body: { pendingMessageIds: ["pending-2", "pending-1"] },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetches pending mobile chat messages on session remount", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      calls.push({ method: init?.method || "GET", path: parsedUrl.pathname });

      if (parsedUrl.pathname === "/api/chat/sessions/s1/pending") {
        return Response.json({
          sessionId: "s1",
          pendingMessages: [
            {
              id: "pending-1",
              sessionId: "s1",
              content: "queued follow-up",
              createdAt: 1783015200000,
              updatedAt: 1783015200001,
              mode: "queued",
              sequence: 1,
            },
          ],
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await new CybaraMobileApi(profile).pendingChatMessages("s1");

      expect(result.sessionId).toBe("s1");
      expect(result.pendingMessages).toHaveLength(1);
      expect(result.pendingMessages[0]).toMatchObject({
        id: "pending-1",
        content: "queued follow-up",
        mode: "queued",
      });
      expect(calls).toEqual([{ method: "GET", path: "/api/chat/sessions/s1/pending" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("updates and deletes pending mobile chat messages through gateway endpoints", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/chat/sessions/s1/pending/pending-1" && method === "PATCH") {
        return Response.json({
          success: true,
          pendingMessage: {
            id: "pending-1",
            sessionId: "s1",
            content: "edited follow-up",
            createdAt: 1783015200000,
            updatedAt: 1783015200100,
            mode: "queued",
            sequence: 1,
          },
          pendingMessages: [
            {
              id: "pending-1",
              sessionId: "s1",
              content: "edited follow-up",
              createdAt: 1783015200000,
              updatedAt: 1783015200100,
              mode: "queued",
              sequence: 1,
            },
          ],
        });
      }

      if (parsedUrl.pathname === "/api/chat/sessions/s1/pending/pending-1" && method === "DELETE") {
        return Response.json({ success: true, pendingMessages: [] });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      const updated = await api.updatePendingMessage("s1", "pending-1", "edited follow-up");
      const deleted = await api.deletePendingMessage("s1", "pending-1");

      expect(updated.success).toBe(true);
      expect(updated.pendingMessage).toMatchObject({ content: "edited follow-up" });
      expect(deleted).toEqual({ success: true, pendingMessages: [], error: undefined });
      expect(calls).toEqual([
        {
          method: "PATCH",
          path: "/api/chat/sessions/s1/pending/pending-1",
          body: { content: "edited follow-up" },
        },
        {
          method: "DELETE",
          path: "/api/chat/sessions/s1/pending/pending-1",
          body: undefined,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("steers pending mobile messages with captured pre-steer activity", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (
        parsedUrl.pathname === "/api/chat/sessions/s1/pending/pending-1/steer" &&
        method === "POST"
      ) {
        const processActivities = (body as { processActivities?: unknown })?.processActivities;
        return Response.json({
          success: true,
          pendingMessages: [],
          interruptedMessage: {
            role: "assistant",
            content: "",
            timestamp: "2026-07-02T18:00:00.000Z",
            process_activities: processActivities,
          },
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await new CybaraMobileApi(profile).steerPendingMessage("s1", "pending-1", {
        processActivities: [
          {
            id: "activity-1",
            phase: "result",
            text: "Ran repo review before steering",
            timestamp: 1783015200000,
            toolName: "exec_command",
            toolCallId: "tool-1",
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.interruptedMessage?.processActivities?.[0]).toMatchObject({
        text: "Ran repo review before steering",
        toolCallId: "tool-1",
      });
      expect(calls).toEqual([
        {
          method: "POST",
          path: "/api/chat/sessions/s1/pending/pending-1/steer",
          body: {
            processActivities: [
              {
                id: "activity-1",
                phase: "result",
                text: "Ran repo review before steering",
                timestamp: 1783015200000,
                toolName: "exec_command",
                toolCallId: "tool-1",
              },
            ],
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("deletes sessions through the canonical gateway sessions route", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      calls.push({ method: init?.method || "GET", path: parsedUrl.pathname });
      if (parsedUrl.pathname === "/api/sessions/s-delete" && init?.method === "DELETE") {
        return Response.json({ success: true, message: "Session deleted" });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(new CybaraMobileApi(profile).deleteSession("s-delete")).resolves.toEqual({
        success: true,
        message: "Session deleted",
      });
      expect(calls).toEqual([{ method: "DELETE", path: "/api/sessions/s-delete" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps the mobile session list bounded while preserving the gateway total", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.pathname === "/api/sessions") {
        return Response.json({
          sessions: Array.from({ length: 100 }, (_, index) => ({
            id: `s${index + 1}`,
            title: `Session ${index + 1}`,
            message_count: index + 1,
            updated_at: `2026-06-30T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
          })),
          total: 3407,
          limit: 100,
          offset: 0,
          hasMore: true,
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      const page = await api.sessionList();
      const summary = await api.featureSummary();

      expect(page.sessions).toHaveLength(100);
      expect(page.total).toBe(3407);
      expect(page.hasMore).toBe(true);
      expect(summary.sessions).toHaveLength(100);
      expect(summary.sessionTotal).toBe(3407);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("orders mobile chats by pinned state and gateway updated timestamp", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/sessions") {
        return Response.json([
          {
            id: "recent",
            title: "Recent unpinned",
            message_count: 2,
            created_at: "2026-06-30T07:00:00.000Z",
            updated_at: "2026-06-30T09:00:00.000Z",
            pinned: false,
          },
          {
            id: "older-pinned",
            title: "Older pinned",
            message_count: 1,
            created_at: "2026-06-29T07:00:00.000Z",
            updated_at: "2026-06-29T09:00:00.000Z",
            pinned: true,
          },
          {
            id: "newer-pinned",
            title: "Newer pinned",
            message_count: 3,
            created_at: "2026-06-30T07:00:00.000Z",
            updated_at: "2026-06-30T08:00:00.000Z",
            pinned: true,
          },
        ]);
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const sessions = await new CybaraMobileApi(profile).sessions();
      expect(sessions.map((session) => session.id)).toEqual([
        "newer-pinned",
        "older-pinned",
        "recent",
      ]);
      expect(sessions[0].updated_at).toBe("2026-06-30T08:00:00.000Z");
      expect(sessions[0].pinned).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("pins a mobile chat through the gateway session endpoint", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });
      if (parsedUrl.pathname === "/api/sessions/s1/pin" && method === "PUT") {
        return Response.json({ success: true, sessionId: "s1", pinned: true });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(new CybaraMobileApi(profile).pinSession("s1", true)).resolves.toMatchObject({
        success: true,
        pinned: true,
      });
      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/sessions/s1/pin",
          body: { pinned: true },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("creates a new gateway chat without a preexisting session id", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/chat" && method === "POST") {
        return Response.json({
          sessionId: "new-session",
          message: {
            id: "assistant-1",
            role: "assistant",
            content: "Created",
          },
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const sent = await new CybaraMobileApi(profile).sendChat({
        agentId: "agent-1",
        message: "start new work",
        workspaceDir: "/repo",
      });

      expect(sent.sessionId).toBe("new-session");
      expect(calls).toEqual([
        {
          method: "POST",
          path: "/api/chat",
          body: {
            agentId: "agent-1",
            message: "start new work",
            workspaceDir: "/repo",
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads every web metrics feed into a mobile metrics snapshot", async () => {
    const paths: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/api/metrics/overview") {
        return Response.json({
          tokenUsage: { total: 10, input: 4, output: 6, cache: 0 },
          fileOperations: { filesRead: 1, filesWritten: 2, filesEdited: 3 },
          toolCalls: { totalCalls: 5 },
          apiCalls: { totalCalls: 5, successfulCalls: 4, failedCalls: 1 },
          agentActivity: { totalExecutions: 2, totalMessages: 3 },
        });
      }
      if (path === "/api/metrics/tokens") {
        return Response.json({ topModels: [], topProviders: [], recentUsage: [], totalTokens: 10 });
      }
      if (path === "/api/metrics/files") {
        return Response.json({
          mostRead: [],
          mostWritten: [],
          mostEdited: [],
          recentOperations: [],
        });
      }
      if (path === "/api/metrics/tools") {
        return Response.json({ mostUsed: [], mostErrors: [], recentCalls: [] });
      }
      if (path === "/api/metrics/providers") return Response.json({ providers: [] });
      if (path === "/api/metrics/time-series") return Response.json({ days: [] });
      if (path === "/api/metrics/models") return Response.json({ models: [] });
      if (path === "/api/metrics/insights") {
        return Response.json({
          tokenBreakdown: {
            total: 10,
            input: 4,
            output: 6,
            cache: 0,
            inputPct: 40,
            outputPct: 60,
            cachePct: 0,
          },
          tokenTrend24h: { current: 10, previous: 5, changePct: 100, direction: "up" },
          cacheEfficiency: { cacheTokens: 0, cacheSharePct: 0 },
          topModel: null,
          providerEfficiency: [],
          modelInsights: [],
          toolReliability: { totalCalls: 5, totalErrors: 0, successRatePct: 100 },
          toolUsage24h: [],
          contextHealth24h: { warnings: 0, criticalWarnings: 0 },
        });
      }
      if (path === "/api/metrics/token-analysis")
        return Response.json({ summary: { totalTokens: 10 } });
      if (path === "/api/metrics/storage") {
        return Response.json({
          totalBytes: 2048,
          directories: { cybaraDir: "/tmp" },
          components: {},
        });
      }
      if (path === "/api/provider-plans/status") {
        return Response.json({
          enabled: true,
          routerEnforcement: true,
          warningThresholdPct: 80,
          providers: [],
          summary: { total: 0, monitored: 0, configured: 0, warnings: 0, exhausted: 0 },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const snapshot = await new CybaraMobileApi(profile).metricsSnapshot();
      expect(snapshot.overview?.tokenUsage.total).toBe(10);
      expect(snapshot.storage?.totalBytes).toBe(2048);
      expect(snapshot.providerPlans?.enabled).toBe(true);
      expect(Object.values(snapshot.availability).every((endpoint) => endpoint.ok)).toBe(true);
      expect(paths.sort()).toEqual(
        [
          "/api/metrics/files",
          "/api/metrics/insights",
          "/api/metrics/models",
          "/api/metrics/overview",
          "/api/metrics/providers",
          "/api/metrics/storage",
          "/api/metrics/time-series",
          "/api/metrics/token-analysis",
          "/api/metrics/tokens",
          "/api/metrics/tools",
          "/api/provider-plans/status",
        ].sort()
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("normalizes wrapped gateway response shapes for mobile lists", () => {
    expect(
      normalizeRemoteItems(
        { tools: [{ name: "read_file", description: "Read workspace files" }] },
        ["tools"],
        "tool"
      )
    ).toEqual([
      {
        id: "read_file",
        title: "read_file",
        detail: "Read workspace files",
        status: undefined,
        type: undefined,
        fields: [
          { label: "name", value: "read_file" },
          { label: "description", value: "Read workspace files" },
        ],
      },
    ]);

    expect(
      normalizeMemoryItems({
        memories: [{ file: "project.md", entries: [{ content: "one" }, { content: "two" }] }],
      })
    ).toEqual([
      {
        id: "project.md",
        title: "project.md",
        detail: "2 entries",
        type: "memory",
        fields: [
          { label: "file", value: "project.md" },
          { label: "entries", value: "2" },
        ],
      },
    ]);

    expect(
      normalizeMemoryList({
        files: ["project.md"],
        memories: [
          {
            file: "project.md",
            entries: [{ timestamp: "2026-07-02T18:00:00.000Z", type: "note", content: "one" }],
          },
        ],
      })
    ).toEqual({
      files: ["project.md"],
      memories: [
        {
          file: "project.md",
          entries: [{ timestamp: "2026-07-02T18:00:00.000Z", type: "note", content: "one" }],
        },
      ],
    });

    expect(
      normalizeMemorySearchResults({
        results: [{ file: "project.md", entry: { content: "one" } }],
      })
    ).toEqual([{ file: "project.md", entry: { content: "one" } }]);

    expect(
      normalizeActivityLogs({
        system: [
          { id: "log-1", message: "Gateway started", created_at: "2026-06-30T08:00:00.000Z" },
        ],
      })
    ).toEqual([
      {
        id: "log-1",
        title: "Gateway started",
        detail: "system",
        source: "system",
        createdAt: "2026-06-30T08:00:00.000Z",
        fields: [
          { label: "id", value: "log-1" },
          { label: "message", value: "Gateway started" },
          { label: "created at", value: "2026-06-30T08:00:00.000Z" },
        ],
      },
    ]);
  });
});

describe("mobile session sorting", () => {
  test("falls back to created timestamps for deterministic recent-first ordering", () => {
    expect(
      sortSessionSummaries([
        {
          id: "old",
          title: "old",
          message_count: 1,
          created_at: "2026-06-29T08:00:00.000Z",
          updated_at: "",
        },
        {
          id: "new",
          title: "new",
          message_count: 1,
          created_at: "2026-06-30T08:00:00.000Z",
          updated_at: "",
        },
      ]).map((session) => session.id)
    ).toEqual(["new", "old"]);
  });
});
