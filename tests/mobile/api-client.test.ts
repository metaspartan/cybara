import { describe, expect, test } from "bun:test";
import {
  buildMobileStatusStreamUrl,
  CybaraMobileApi,
  normalizeMobileSessionStatusResponse,
  normalizeMobileStatusStreamEvent,
} from "../../apps/mobile/src/lib/api";
import { profile, systemPromptFixture } from "./api-client.fixture";

describe("mobile API client", () => {
  test("preserves every persisted tool call in a long chat response", async () => {
    const originalFetch = globalThis.fetch;
    const toolCalls = Array.from({ length: 32 }, (_, index) => ({
      id: `tool-${index + 1}`,
      name: "read",
      status: "completed",
      args: { path: `file-${index + 1}.ts` },
    }));
    globalThis.fetch = (async () =>
      Response.json({
        id: "long-session",
        messagesList: [
          {
            id: "assistant-long",
            role: "assistant",
            content: "Done",
            tool_calls: toolCalls,
          },
        ],
      })) as typeof fetch;

    try {
      const detail = await new CybaraMobileApi(profile).session("long-session");
      expect(detail.messages[0].toolCalls).toHaveLength(32);
      expect(detail.messages[0].toolCalls?.at(-1)?.id).toBe("tool-32");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("manages MCP servers through scoped gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method || "GET",
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if ((init?.method || "GET") === "GET") {
        return Response.json([
          {
            id: "remote-one",
            name: "Remote One",
            command: "",
            url: "https://mcp.example.com",
            enabled: true,
            status: "running",
            toolCount: 3,
          },
        ]);
      }
      if (url.pathname === "/api/mcp" && init?.method === "POST") {
        return Response.json({
          id: "remote-two",
          name: "Remote Two",
          command: "",
          url: "https://mcp-two.example.com",
          enabled: true,
          status: "stopped",
          toolCount: 0,
        });
      }
      return Response.json({ success: true });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.listMcpServers()).resolves.toHaveLength(1);
      await api.createMcpServer({
        name: "Remote Two",
        url: "https://mcp-two.example.com",
        authorization: "Bearer secret",
      });
      await api.startMcpServer("remote/two");
      await api.stopMcpServer("remote/two");
      await api.deleteMcpServer("remote/two");

      expect(calls).toEqual([
        { method: "GET", path: "/api/mcp", body: null },
        {
          method: "POST",
          path: "/api/mcp",
          body: {
            name: "Remote Two",
            url: "https://mcp-two.example.com",
            authorization: "Bearer secret",
            enabled: true,
          },
        },
        { method: "POST", path: "/api/mcp/remote%2Ftwo/start", body: null },
        { method: "POST", path: "/api/mcp/remote%2Ftwo/stop", body: null },
        { method: "DELETE", path: "/api/mcp/remote%2Ftwo", body: null },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("scopes subagent details and history to the active chat", async () => {
    const calls: Array<{
      method: string;
      path: string;
      sessionId: string | null;
    }> = [];
    let spawnPayload: Record<string, unknown> | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      calls.push({
        method: init?.method || "GET",
        path: url.pathname,
        sessionId: url.searchParams.get("sessionId"),
      });
      if (url.pathname === "/api/subagents/spawn") {
        spawnPayload = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
        return Response.json({
          success: true,
          subagentId: "sub/new",
          status: "accepted",
        });
      }
      if (url.pathname === "/api/subagents/sub%2Fone" && (init?.method || "GET") === "GET") {
        return Response.json({
          id: "sub/one",
          label: "Review",
          status: "completed",
        });
      }
      if (url.pathname === "/api/subagents/sub%2Fone/kill") {
        return Response.json({ success: true, message: "Subagent killed" });
      }
      if (init?.method === "DELETE" && url.pathname === "/api/subagents") {
        return Response.json({ success: true, cleared: 1 });
      }
      if (init?.method === "DELETE") return Response.json({ success: true });
      return Response.json([{ id: "sub/one", label: "Review", status: "completed" }]);
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.subagents("chat/one")).resolves.toHaveLength(1);
      await expect(api.subagent("sub/one")).resolves.toMatchObject({
        id: "sub/one",
      });
      await expect(
        api.spawnSubagent({
          task: "Review mobile chat",
          agentId: "mini",
          workspaceDir: "/repo",
          requesterSessionId: "chat/one",
        })
      ).resolves.toMatchObject({ success: true, subagentId: "sub/new" });
      await expect(api.stopSubagent("sub/one")).resolves.toMatchObject({
        success: true,
      });
      await expect(api.clearSubagent("sub/one")).resolves.toMatchObject({
        success: true,
      });
      await expect(api.clearSubagentHistory("chat/one")).resolves.toEqual({
        success: true,
        cleared: 1,
      });
      expect(calls).toEqual([
        { method: "GET", path: "/api/subagents", sessionId: "chat/one" },
        { method: "GET", path: "/api/subagents/sub%2Fone", sessionId: null },
        { method: "POST", path: "/api/subagents/spawn", sessionId: null },
        {
          method: "POST",
          path: "/api/subagents/sub%2Fone/kill",
          sessionId: null,
        },
        { method: "DELETE", path: "/api/subagents/sub%2Fone", sessionId: null },
        { method: "DELETE", path: "/api/subagents", sessionId: "chat/one" },
      ]);
      expect(spawnPayload).toEqual({
        task: "Review mobile chat",
        agentId: "mini",
        workspaceDir: "/repo",
        requesterSessionId: "chat/one",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
            runId: "run-1",
            sequence: 4,
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
          runId: "run-1",
          sequence: 4,
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
      { closeGraceMs: 0, WebSocketImpl: FakeWebSocket as never }
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

  test("loads git branch details for the active mobile chat workspace", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization") });
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/git/branches") {
        return Response.json({
          success: true,
          current: "main",
          branches: [
            { name: "main", current: true },
            { name: "feature/mobile", current: false },
          ],
        });
      }
      if (parsed.pathname === "/api/git/branch" && init?.method === "POST") {
        return Response.json({ success: true, branch: "feature/mobile" });
      }
      return Response.json({ branch: "main" });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.gitBranch("/Users/carsen/Documents/GitHub/cybara repo")).resolves.toBe(
        "main"
      );
      await expect(api.gitBranches("/Users/carsen/Documents/GitHub/cybara repo")).resolves.toEqual({
        success: true,
        current: "main",
        branches: [
          { name: "main", current: true },
          { name: "feature/mobile", current: false },
        ],
        error: undefined,
      });
      await expect(
        api.checkoutGitBranch("/Users/carsen/Documents/GitHub/cybara repo", "feature/mobile")
      ).resolves.toEqual({ success: true, branch: "feature/mobile" });
      expect(calls).toEqual([
        {
          url: "http://127.0.0.1:4269/api/git/branch?path=%2FUsers%2Fcarsen%2FDocuments%2FGitHub%2Fcybara%20repo",
          auth: "Bearer cybara_mobile_test",
        },
        {
          url: "http://127.0.0.1:4269/api/git/branches?path=%2FUsers%2Fcarsen%2FDocuments%2FGitHub%2Fcybara%20repo",
          auth: "Bearer cybara_mobile_test",
        },
        {
          url: "http://127.0.0.1:4269/api/git/branch",
          auth: "Bearer cybara_mobile_test",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("normalizes session plan snapshots for mobile chat detail", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const headers = new Headers(init?.headers);
      expect(parsedUrl.pathname).toBe("/api/sessions/s-plan");
      expect(headers.get("authorization")).toBe("Bearer cybara_mobile_test");
      return Response.json({
        id: "s-plan",
        title: "Plan test",
        plan: {
          sessionId: "s-plan",
          source: "todo_tool",
          items: [
            {
              content: "Read repository layout",
              status: "completed",
              priority: "high",
            },
            {
              content: "Review security gates",
              status: "active",
              priority: "medium",
            },
            {
              content: "Write focused tests",
              status: "pending",
              priority: "low",
            },
            { content: "", status: "completed", priority: "high" },
            null,
          ],
          summary: { total: 3, completed: 1, in_progress: 1, pending: 1 },
          updatedAt: "2026-07-08T14:00:00.000Z",
        },
        messages: [{ id: "m1", role: "assistant", content: "Done" }],
      });
    }) as typeof fetch;

    try {
      const detail = await new CybaraMobileApi(profile).session("s-plan");
      expect(detail.plan).toMatchObject({
        sessionId: "s-plan",
        source: "todo_tool",
        summary: { total: 3, completed: 1, inProgress: 1, pending: 1 },
      });
      expect(detail.plan?.items).toEqual([
        {
          content: "Read repository layout",
          status: "completed",
          priority: "high",
        },
        {
          content: "Review security gates",
          status: "in_progress",
          priority: "medium",
        },
        { content: "Write focused tests", status: "pending", priority: "low" },
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
        return Response.json({
          success: true,
          apiKey: "root-key",
          source: "file",
        });
      }
      if (parsedUrl.pathname === "/api/auth/rotate-key" && method === "POST") {
        return Response.json({ success: true, apiKey: "rotated-key" });
      }
      if (parsedUrl.pathname === "/api/system/restart" && method === "POST") {
        return Response.json({
          success: true,
          supervised: false,
          message: "Gateway restarting",
        });
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
        api.updateGatewayAuthSettings({
          gatewayPassword: "correct horse battery staple",
        })
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
    const calls: Array<{
      method: string;
      path: string;
      auth: string | null;
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
        body,
      });
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
              preferences: body?.preferences ?? {
                chatCompletions: true,
                taskCompletions: true,
              },
            },
          },
        });
      }
      if (parsedUrl.pathname === "/api/mobile/device" && method === "GET") {
        return Response.json({
          device: {
            id: "mobile-1",
            name: "iPhone",
            push: {
              configured: true,
              provider: "expo",
              platform: "ios",
              preferences: { chatCompletions: true, taskCompletions: true },
            },
          },
        });
      }
      if (parsedUrl.pathname === "/api/mobile/push-preferences" && method === "PUT") {
        return Response.json({
          success: true,
          device: {
            id: "mobile-1",
            name: "iPhone",
            push: {
              configured: true,
              provider: "expo",
              platform: "ios",
              preferences: body,
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
          preferences: { chatCompletions: true, taskCompletions: false },
        })
      ).resolves.toMatchObject({
        success: true,
        device: {
          push: {
            configured: true,
            provider: "expo",
            platform: "ios",
            preferences: { chatCompletions: true, taskCompletions: false },
          },
        },
      });
      await expect(api.currentMobileDevice()).resolves.toMatchObject({
        device: {
          push: {
            configured: true,
            preferences: { chatCompletions: true, taskCompletions: true },
          },
        },
      });
      await expect(
        api.updatePushPreferences({
          chatCompletions: false,
          taskCompletions: true,
        })
      ).resolves.toMatchObject({
        success: true,
        device: {
          push: {
            configured: true,
            preferences: { chatCompletions: false, taskCompletions: true },
          },
        },
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
            preferences: { chatCompletions: true, taskCompletions: false },
            enabled: true,
          },
        },
        {
          method: "GET",
          path: "/api/mobile/device",
          auth: "Bearer cybara_mobile_test",
          body: undefined,
        },
        {
          method: "PUT",
          path: "/api/mobile/push-preferences",
          auth: "Bearer cybara_mobile_test",
          body: { chatCompletions: false, taskCompletions: true },
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

  test("previews and runs source migrations through gateway routes", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const parsedUrl = new URL(String(url));
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: parsedUrl.pathname, body });

      if (parsedUrl.pathname === "/api/migrations/sources" && method === "GET") {
        return Response.json({
          sources: [
            {
              kind: "hermes",
              path: "/Users/carsen/.hermes",
              exists: true,
              label: "Hermes",
              confidence: "high",
              detected: {
                persona: true,
                memoryFiles: 2,
                skillCount: 4,
                configFiles: 1,
                envFiles: 1,
              },
            },
          ],
        });
      }
      if (
        (parsedUrl.pathname === "/api/migrations/preview" ||
          parsedUrl.pathname === "/api/migrations/run") &&
        method === "POST"
      ) {
        return Response.json({
          success: true,
          dryRun: parsedUrl.pathname.endsWith("/preview"),
          sourceKind: "hermes",
          sourceRoot: "/Users/carsen/.hermes",
          targetRoot: "/Users/carsen/.cybara",
          preset: "full",
          migrateSecrets: true,
          overwrite: false,
          skillConflict: "rename",
          createdAt: "2026-07-08T00:00:00.000Z",
          summary: {
            total: 1,
            planned: 1,
            migrated: 0,
            archived: 0,
            skipped: 0,
            conflict: 0,
            error: 0,
          },
          warnings: [],
          items: [
            {
              id: "memory-1",
              category: "memory",
              name: "MEMORY.md",
              status: "planned",
            },
          ],
          nextSteps: ["Run migration"],
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    try {
      const api = new CybaraMobileApi(profile);
      await expect(api.migrationSources()).resolves.toEqual({
        sources: [
          {
            kind: "hermes",
            path: "/Users/carsen/.hermes",
            exists: true,
            label: "Hermes",
            confidence: "high",
            detected: {
              persona: true,
              memoryFiles: 2,
              skillCount: 4,
              configFiles: 1,
              envFiles: 1,
            },
          },
        ],
      });
      await expect(
        api.previewMigration({
          sourceKind: "hermes",
          sourcePath: "/Users/carsen/.hermes",
          preset: "full",
          migrateSecrets: true,
          skillConflict: "rename",
        })
      ).resolves.toMatchObject({ dryRun: true, sourceKind: "hermes" });
      await expect(
        api.runMigration({
          sourceKind: "hermes",
          sourcePath: "/Users/carsen/.hermes",
          preset: "full",
          migrateSecrets: true,
          skillConflict: "rename",
        })
      ).resolves.toMatchObject({ dryRun: false, sourceKind: "hermes" });

      expect(calls).toEqual([
        { method: "GET", path: "/api/migrations/sources", body: undefined },
        {
          method: "POST",
          path: "/api/migrations/preview",
          body: {
            sourceKind: "hermes",
            sourcePath: "/Users/carsen/.hermes",
            preset: "full",
            migrateSecrets: true,
            skillConflict: "rename",
            dryRun: true,
          },
        },
        {
          method: "POST",
          path: "/api/migrations/run",
          body: {
            sourceKind: "hermes",
            sourcePath: "/Users/carsen/.hermes",
            preset: "full",
            migrateSecrets: true,
            skillConflict: "rename",
            dryRun: false,
          },
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
          summary: {
            total: 1,
            monitored: 1,
            configured: 1,
            warnings: 1,
            exhausted: 0,
          },
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
        return Response.json({
          success: true,
          file: body?.file,
          appended: false,
        });
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
      await expect(api.deleteMemory("project notes.md", 0)).resolves.toEqual({
        success: true,
      });

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
      calls.push({
        method: init?.method || "GET",
        path: parsedUrl.pathname,
        body,
      });
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
        api.sendWallet({
          chain: "eth",
          to: "0xrecipient",
          amount: "0.01",
          memo: "mobile",
        })
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
          body: {
            chain: "eth",
            to: "0xrecipient",
            amount: "0.01",
            memo: "mobile",
          },
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
});
