import { describe, expect, test } from "bun:test";
import {
  CybaraMobileApi,
  type SystemPromptConfig,
  normalizeActivityLogs,
  normalizeMemoryItems,
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

  test("updates wallet agent access and policy through gateway wallet routes", async () => {
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

      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/wallet/agent-access",
          body: { enabled: true },
        },
        {
          method: "PUT",
          path: "/api/wallet/agent-policy",
          body: { allowNativeSend: true },
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
          models: [],
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

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      const sessions = await api.sessions();
      const detail = await api.session("s1");
      const sent = await api.sendChat({ sessionId: "s1", message: "continue", agentId: "agent-1" });

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
      ]);
      expect(calls[2].body).toMatchObject({
        sessionId: "s1",
        agentId: "agent-1",
        message: "continue",
      });
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
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const snapshot = await new CybaraMobileApi(profile).metricsSnapshot();
      expect(snapshot.overview?.tokenUsage.total).toBe(10);
      expect(snapshot.storage?.totalBytes).toBe(2048);
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
