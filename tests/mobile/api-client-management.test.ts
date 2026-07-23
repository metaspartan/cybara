import { describe, expect, test } from "bun:test";
import {
  CybaraMobileApi,
  normalizeActivityLogs,
  normalizeMemoryItems,
  normalizeMemoryList,
  normalizeMemorySearchResults,
  normalizeRemoteItems,
  sortSessionSummaries,
} from "../../apps/mobile/src/lib/api";
import { profile, systemPromptFixture } from "./api-client.fixture";

describe("mobile API client", () => {
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
      await expect(api.startAgent("agent-1")).resolves.toEqual({
        success: true,
      });
      await expect(api.stopAgent("agent-1")).resolves.toEqual({
        success: true,
      });
      await expect(api.deleteAgent("agent-1")).resolves.toEqual({
        success: true,
      });

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

  test("updates an agent reasoning override through the dedicated route", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });
      return Response.json({ success: true, reasoning_effort: "high" });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.updateAgentReasoning("agent-1", "high")).resolves.toEqual({
        success: true,
        reasoning_effort: "high",
      });
      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/agents/agent-1/reasoning",
          body: { reasoning_effort: "high" },
        },
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
      await expect(api.deleteProvider("provider-1")).resolves.toEqual({
        success: true,
      });

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
        {
          method: "POST",
          path: "/api/providers/provider-1/test",
          body: undefined,
        },
        {
          method: "DELETE",
          path: "/api/providers/provider-1",
          body: undefined,
        },
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
        return Response.json({
          auth_url: "https://auth.example/start",
          state: "oauth-state",
          poll_token: "oauth-poll-token",
        });
      }
      if (parsedUrl.pathname === "/api/providers/oauth/callback-status") {
        return Response.json({
          status: "success",
          access_token: "oauth-token",
        });
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
        poll_token: "oauth-poll-token",
      });
      await expect(
        api.providerOAuthCallbackStatus("oauth-state", "oauth-poll-token")
      ).resolves.toEqual({
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
          body: { state: "oauth-state", poll_token: "oauth-poll-token" },
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
      await expect(api.deleteChannel("channel-1")).resolves.toEqual({
        success: true,
      });
      await expect(api.startTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.stopTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.runTask("task-1")).resolves.toEqual({ success: true });
      await expect(api.deleteTask("task-1")).resolves.toEqual({
        success: true,
      });
      await expect(api.resolveToolApproval("approval-1", "approve_once")).resolves.toEqual({
        success: true,
      });

      expect(calls).toEqual([
        {
          method: "PUT",
          path: "/api/channels/channel-1",
          body: { name: "Telegram", enabled: false },
        },
        {
          method: "POST",
          path: "/api/channels/channel-1/test",
          body: undefined,
        },
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
        return Response.json({
          status: "healthy",
          uptime: 12,
          timestamp: "now",
        });
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
      if (path === "/api/agents/summary") {
        return Response.json([{ id: "a1", name: "Main", reasoning_effort: "high" }]);
      }
      if (path === "/api/providers")
        return Response.json([{ id: "p1", name: "Anthropic", provider: "anthropic" }]);
      if (path === "/api/skills")
        return Response.json({
          skills: [{ name: "code-review", description: "Review changes" }],
        });
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
            swap: {
              totalBytes: 500,
              freeBytes: 250,
              usedBytes: 250,
              usedPct: 50,
            },
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
          disk: {
            path: "/tmp",
            totalBytes: 1000,
            freeBytes: 250,
            usedBytes: 750,
            usedPct: 75,
          },
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
      expect(summary.agents[0]?.reasoning_effort).toBe("high");
      expect(summary.providers).toHaveLength(1);
      expect(summary.skills).toEqual([
        expect.objectContaining({ id: "code-review", title: "code-review" }),
      ]);
      expect(summary.availability.skills.ok).toBe(true);
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

  test("loads lightweight agent summaries before one editable agent detail", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/api/agents/summary") {
        return Response.json([
          {
            id: "agent-1",
            name: "Primary",
            model: "model-1",
            reasoning_effort: "high",
            supports_images: true,
          },
        ]);
      }
      if (path === "/api/agents/agent-1") {
        return Response.json({
          id: "agent-1",
          name: "Primary",
          model: "model-1",
          system_prompt: "Complete the task.",
          config: { tool_profile: "coding" },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.agents()).resolves.toEqual([
        expect.objectContaining({
          id: "agent-1",
          reasoning_effort: "high",
          supports_images: true,
        }),
      ]);
      await expect(api.agent("agent-1")).resolves.toEqual(
        expect.objectContaining({
          id: "agent-1",
          system_prompt: "Complete the task.",
          config: { tool_profile: "coding" },
        })
      );
      expect(calls).toEqual(["/api/agents/summary", "/api/agents/agent-1"]);
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
    const calls: Array<{
      method: string;
      path: string;
      search: string;
      body?: unknown;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({
        method,
        path: parsedUrl.pathname,
        search: parsedUrl.search,
        body,
      });

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
              agent_transfers: [
                {
                  from_agent_id: "agent-1",
                  from_agent_name: "Builder",
                  to_agent_id: "agent-2",
                  to_agent_name: "Reviewer",
                  reason: "Review the completed implementation",
                  context_mode: "recent",
                  context_summary: "The implementation and tests are complete",
                  requested_at: "2026-06-30T08:00:30.000Z",
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
      const sent = await api.sendChat({
        sessionId: "s1",
        message: "continue",
        agentId: "agent-1",
      });
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
      expect(detail.messages[0].agentTransfers?.[0]).toMatchObject({
        fromAgentName: "Builder",
        toAgentName: "Reviewer",
        contextMode: "recent",
      });
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
      expect(updated.pendingMessage).toMatchObject({
        content: "edited follow-up",
      });
      expect(deleted).toEqual({
        success: true,
        pendingMessages: [],
        error: undefined,
      });
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

  test("stops an active mobile chat through the canonical session route", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      calls.push({ method: init?.method || "GET", path: parsedUrl.pathname });
      if (parsedUrl.pathname === "/api/chat/sessions/s-stop/stop" && init?.method === "POST") {
        return Response.json({
          success: true,
          stopped: true,
          sessionId: "s-stop",
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      await expect(new CybaraMobileApi(profile).stopChatSession("s-stop")).resolves.toEqual({
        success: true,
        stopped: true,
        error: undefined,
      });
      expect(calls).toEqual([{ method: "POST", path: "/api/chat/sessions/s-stop/stop" }]);
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

  test("uses the gateway metrics snapshot endpoint when available", async () => {
    const paths: string[] = [];
    const searches: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      paths.push(path);
      searches.push(parsedUrl.search);
      if (path === "/api/metrics/snapshot") {
        return Response.json({
          overview: {
            tokenUsage: { total: 10, input: 4, output: 6, cache: 0 },
            fileOperations: { filesRead: 1, filesWritten: 2, filesEdited: 3 },
            toolCalls: { totalCalls: 5 },
            apiCalls: { totalCalls: 5, successfulCalls: 4, failedCalls: 1 },
            agentActivity: { totalExecutions: 2, totalMessages: 3 },
          },
          storage: {
            totalBytes: 2048,
            directories: { cybaraDir: "/tmp" },
            components: {},
          },
          providerPlans: {
            enabled: true,
            routerEnforcement: true,
            warningThresholdPct: 80,
            providers: [],
            summary: {
              total: 0,
              monitored: 0,
              configured: 0,
              warnings: 0,
              exhausted: 0,
            },
          },
          availability: {
            overview: { ok: true },
            storage: { ok: true },
            providerPlans: { ok: true },
          },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const snapshot = await new CybaraMobileApi(profile).metricsSnapshot();
      expect(snapshot.overview?.tokenUsage.total).toBe(10);
      expect(snapshot.storage?.totalBytes).toBe(2048);
      expect(snapshot.providerPlans?.enabled).toBe(true);
      expect(snapshot.availability.overview.ok).toBe(true);
      expect(snapshot.availability.tokens.ok).toBe(false);
      expect(paths).toEqual(["/api/metrics/snapshot"]);
      expect(searches).toEqual(["?compact=1"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loads the lightweight metrics overview independently", async () => {
    const paths: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      return Response.json({
        tokenUsage: { total: 10, input: 4, output: 6, cache: 0 },
        fileOperations: { filesRead: 1, filesWritten: 2, filesEdited: 3 },
        toolCalls: { totalCalls: 5 },
        apiCalls: { totalCalls: 5, successfulCalls: 4, failedCalls: 1 },
        agentActivity: { totalExecutions: 2, totalMessages: 3 },
      });
    }) as typeof fetch;

    try {
      const overview = await new CybaraMobileApi(profile).metricsOverview();
      expect(overview.tokenUsage.total).toBe(10);
      expect(paths).toEqual(["/api/metrics/overview"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not fan out legacy metrics requests after authorization failures", async () => {
    const paths: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      paths.push(new URL(String(url)).pathname);
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }) as typeof fetch;

    try {
      await expect(new CybaraMobileApi(profile).metricsSnapshot()).rejects.toMatchObject({
        status: 401,
      });
      expect(paths).toEqual(["/api/metrics/snapshot"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to every web metrics feed on older gateways", async () => {
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
        return Response.json({
          topModels: [],
          topProviders: [],
          recentUsage: [],
          totalTokens: 10,
        });
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
          tokenTrend24h: {
            current: 10,
            previous: 5,
            changePct: 100,
            direction: "up",
          },
          cacheEfficiency: { cacheTokens: 0, cacheSharePct: 0 },
          topModel: null,
          providerEfficiency: [],
          modelInsights: [],
          toolReliability: {
            totalCalls: 5,
            totalErrors: 0,
            successRatePct: 100,
          },
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
      if (path === "/api/metrics/sessions") {
        return Response.json({
          totals: {
            sessions: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            callCount: 0,
            durationMs: 0,
            tokensPerSecond: null,
            firstTokenMs: null,
            compactionCount: 0,
            compactedTokens: 0,
          },
          sessions: [],
        });
      }
      if (path === "/api/provider-plans/status") {
        return Response.json({
          enabled: true,
          routerEnforcement: true,
          warningThresholdPct: 80,
          providers: [],
          summary: {
            total: 0,
            monitored: 0,
            configured: 0,
            warnings: 0,
            exhausted: 0,
          },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const snapshot = await new CybaraMobileApi(profile).metricsSnapshot();
      expect(snapshot.overview?.tokenUsage.total).toBe(10);
      expect(snapshot.storage?.totalBytes).toBe(2048);
      expect(snapshot.providerPlans?.enabled).toBe(true);
      expect(snapshot.sessions?.totals.sessions).toBe(0);
      expect(Object.values(snapshot.availability).every((endpoint) => endpoint.ok)).toBe(true);
      expect(paths.sort()).toEqual(
        [
          "/api/metrics/snapshot",
          "/api/metrics/files",
          "/api/metrics/insights",
          "/api/metrics/models",
          "/api/metrics/overview",
          "/api/metrics/providers",
          "/api/metrics/sessions",
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
        memories: [
          {
            file: "project.md",
            entries: [{ content: "one" }, { content: "two" }],
          },
        ],
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
            entries: [
              {
                timestamp: "2026-07-02T18:00:00.000Z",
                type: "note",
                content: "one",
              },
            ],
          },
        ],
      })
    ).toEqual({
      files: ["project.md"],
      memories: [
        {
          file: "project.md",
          entries: [
            {
              timestamp: "2026-07-02T18:00:00.000Z",
              type: "note",
              content: "one",
            },
          ],
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
          {
            id: "log-1",
            message: "Gateway started",
            created_at: "2026-06-30T08:00:00.000Z",
          },
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
