import { describe, expect, test } from "bun:test";
import {
  CybaraMobileApi,
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

  test("loads a broad feature summary without failing when optional surfaces are unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") {
        return Response.json({ status: "healthy", uptime: 12, timestamp: "now" });
      }
      if (path === "/api/chat/sessions") {
        return Response.json([{ id: "s1", title: "Build", message_count: 3, updated_at: "now" }]);
      }
      if (path === "/api/agents") return Response.json([{ id: "a1", name: "Main" }]);
      if (path === "/api/providers")
        return Response.json([{ id: "p1", name: "Anthropic", provider: "anthropic" }]);
      if (path === "/api/config") return Response.json({ tool_approval_mode: "ask" });
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const summary = await new CybaraMobileApi(profile).featureSummary();
      expect(summary.health?.status).toBe("healthy");
      expect(summary.sessions).toHaveLength(1);
      expect(summary.agents).toHaveLength(1);
      expect(summary.providers).toHaveLength(1);
      expect(summary.channels).toEqual([]);
      expect(summary.availability.channels.ok).toBe(false);
      expect(summary.availability.channels.status).toBe(404);
      expect(summary.config.tool_approval_mode).toBe("ask");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses chat session endpoints and posts into an existing mobile chat", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/chat/sessions") {
        return Response.json([
          {
            id: "s1",
            title: "Build mobile",
            agentId: "agent-1",
            messageCount: 2,
            updatedAt: "2026-06-30T08:00:00.000Z",
          },
        ]);
      }

      if (parsedUrl.pathname === "/api/chat/sessions/s1") {
        return Response.json({
          id: "s1",
          title: "Build mobile",
          agent_id: "agent-1",
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
            tool_calls: [{ id: "tool-2", name: "shell", status: "completed" }],
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
        message_count: 2,
      });
      expect(detail.messages[0].toolCalls?.[0].name).toBe("read_file");
      expect(detail.messages[0].processActivities?.[0].text).toBe("Read DashboardScreen");
      expect(sent.message.thinking).toBe("top-level thought");
      expect(sent.message.toolCalls?.[0].name).toBe("shell");
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "GET /api/chat/sessions",
        "GET /api/chat/sessions/s1",
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

  test("orders mobile chats by pinned state and gateway updated timestamp", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/chat/sessions") {
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
