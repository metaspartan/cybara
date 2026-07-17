import { afterAll, beforeAll } from "bun:test";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function buildCliCommandsFixture() {
  const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  let server: ReturnType<typeof Bun.serve>;
  let apiBase = "";
  let lastLogsLimit: string | null = null;
  const chatPendingRequests: Array<{
    method: string;
    path: string;
    body?: unknown;
  }> = [];
  const configState: Record<string, unknown> = {
    host: "127.0.0.1",
    port: 4269,
    theme: "indigo",
  };

  const walletState: {
    exists: boolean;
    unlocked: boolean;
    agentAccessEnabled: boolean;
    unlockExpiresAt?: string;
    primaryAddresses?: Record<string, string>;
  } = {
    exists: true,
    unlocked: true,
    agentAccessEnabled: false,
    unlockExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    primaryAddresses: {
      eth: "0x1111111111111111111111111111111111111111",
      btc: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
      sol: "3fM5V9iUGn2YvBG3VDBgaR7jWT8QdbdbfF7wq9fN4sJ5",
    },
  };

  const walletRpcState = {
    ethRpc: "https://ethereum-rpc.publicnode.com",
    solRpc: "https://api.mainnet-beta.solana.com",
    btcApi: "https://mempool.space/api",
  };

  const walletAgentPolicyState = {
    allowNativeSend: false,
    allowTokenSend: false,
    allowEthContractWrite: false,
    allowSolProgramInstruction: false,
    allowEthSwaps: false,
    allowDappInteraction: false,
    allowX402Payments: false,
    allowedEthContracts: [] as string[],
    allowedSolPrograms: [] as string[],
    allowedDappHosts: [] as string[],
    allowedX402Networks: [] as string[],
    x402MaxAmountAtomic: "1000000",
  };

  const loopRuns = new Map<
    string,
    {
      id: string;
      agentId: string;
      label: string;
      objective: string;
      status: string;
      stopReason?: string;
      createdAt: string;
      updatedAt: string;
      maxIterations: number;
      maxDurationSeconds: number;
      useTools: boolean;
      iterationsCompleted: number;
      steps: Array<{
        iteration: number;
        durationMs: number;
        toolCallCount: number;
        done: boolean;
      }>;
      finalResponse?: string;
    }
  >([
    [
      "loop-1",
      {
        id: "loop-1",
        agentId: "agent-1",
        label: "Initial loop",
        objective: "Summarize latest system status",
        status: "completed",
        stopReason: "done",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        maxIterations: 4,
        maxDurationSeconds: 120,
        useTools: true,
        iterationsCompleted: 2,
        steps: [{ iteration: 1, durationMs: 12, toolCallCount: 1, done: false }],
        finalResponse: "Status summarized.",
      },
    ],
  ]);

  const mobileDevice = {
    id: "mobile-1",
    name: "CLI Test Phone",
    baseUrl: "http://127.0.0.1:4269",
    status: "active" as const,
    createdAt: "2026-06-30T00:00:00.000Z",
  };

  function mobilePairing(baseUrl: string, gatewayName = "Cybara Gateway") {
    const payload = {
      protocol: "cybara-mobile-connect-v1",
      name: gatewayName,
      baseUrl,
      apiKey: "cybara_mobile_cli_test_token",
      deviceId: mobileDevice.id,
      createdAt: mobileDevice.createdAt,
    };
    return {
      success: true,
      device: { ...mobileDevice, baseUrl, status: "active" },
      payload,
      encoded: JSON.stringify(payload),
      qrDataUrl: "data:image/png;base64,cXItZGF0YQ==",
    };
  }

  function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function route(method: string, url: URL, body: string): Response {
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/api/health") {
      return json({
        status: "healthy",
        uptime: 321,
        timestamp: new Date().toISOString(),
        system: {
          cpu: { usagePct: 12.3, cores: 8, model: "Test CPU" },
          memory: {
            usedPct: 55.5,
            usedBytes: 1024 * 1024 * 512,
            totalBytes: 1024 * 1024 * 1024,
            freeBytes: 1024 * 1024 * 512,
            swap: {
              usedPct: 25,
              usedBytes: 1024 * 1024 * 256,
              totalBytes: 1024 * 1024 * 1024,
              freeBytes: 1024 * 1024 * 768,
            },
          },
          process: {
            pid: 123,
            cpuUsagePct: 1.2,
            memory: { rssBytes: 1024 * 1024 * 64 },
          },
          disk: {
            path: "/tmp",
            usedPct: 60,
            freeBytes: 1024 * 1024 * 1024,
            totalBytes: 2 * 1024 * 1024 * 1024,
            usedBytes: 1024 * 1024 * 1024,
          },
        },
        checks: {
          database: { status: "healthy", total: 1 },
          providers: { status: "healthy", total: 1 },
        },
      });
    }

    if (method === "GET" && pathname === "/api/metrics/overview") {
      return json({
        tokenUsage: { total: 42, input: 20, output: 22, cache: 0 },
        fileOperations: { filesRead: 3, filesWritten: 1, filesEdited: 1 },
        toolCalls: { totalCalls: 4 },
        apiCalls: { totalCalls: 8, successfulCalls: 8, failedCalls: 0 },
        agentExecutions: { totalExecutions: 2, totalMessages: 5 },
      });
    }

    if (method === "GET" && pathname === "/api/metrics/token-analysis") {
      return json({
        summary: {
          callCount: 5,
          totalTokens: 420,
          totalInputTokens: 260,
          totalOutputTokens: 160,
          averageTokensPerCall: 84,
          medianTokensPerCall: 80,
          inputToOutputRatio: 1.625,
          outputToInputRatio: 0.6154,
        },
        tokenHeatmap: {
          hottestHour: {
            date: "2026-02-19",
            dayLabel: "Thu",
            hour: 14,
            tokens: 120,
            calls: 2,
          },
        },
        promptOutputDistribution: {
          sampleCount: 5,
          bands: [
            { band: "input_heavy", calls: 2, sharePct: 40 },
            { band: "balanced", calls: 3, sharePct: 60 },
          ],
        },
        tokenCloud: [
          { token: "gpt-5.2", category: "model", weight: 220, sharePct: 22 },
          { token: "openai", category: "provider", weight: 180, sharePct: 18 },
          { token: "read_file", category: "tool", weight: 120, sharePct: 12 },
        ],
        modelThoughtProfiles: [
          {
            model: "gpt-5.2",
            provider: "openai",
            totalTokens: 320,
            calls: 3,
            promptSharePct: 62.5,
            responseSharePct: 37.5,
            avgTokensPerCall: 106.67,
            avgLatencyMs: 2200,
            avgTps: 36,
            behavior: "balanced",
          },
        ],
        topTokenBursts: [
          {
            timestamp: "2026-02-19T14:05:00.000Z",
            model: "gpt-5.2",
            provider: "openai",
            inputTokens: 70,
            outputTokens: 50,
            totalTokens: 120,
            durationMs: 1400,
            tokensPerSecond: 35.7,
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/agents") {
      return json([
        {
          id: "agent-1",
          name: "Primary Agent",
          type: "assistant",
          status: "running",
          model: "claude-sonnet",
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/agents/summary") {
      return json([
        {
          id: "agent-1",
          name: "Primary Agent",
          status: "running",
          model: "claude-sonnet",
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/providers") {
      return json([
        {
          id: "prov-1",
          provider: "anthropic",
          name: "Anthropic Main",
          is_default: true,
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/providers/available") {
      return json([
        {
          id: "anthropic",
          name: "Anthropic",
          description: "Claude models",
          baseUrl: "https://api.anthropic.com",
          authType: "apiKey",
          models: [{ id: "claude-sonnet", name: "Claude Sonnet", context: 200000 }],
        },
      ]);
    }

    if (method === "POST" && pathname === "/api/providers") {
      const parsed = body
        ? (JSON.parse(body) as {
            provider?: string;
            name?: string;
            api_key?: string;
          })
        : {};
      if (!parsed.provider) {
        return json({ error: "missing provider" }, 400);
      }
      return json({ id: "prov-created", name: parsed.name || parsed.provider });
    }

    if (method === "PUT" && pathname === "/api/providers/prov-1") {
      return json({ success: true });
    }

    if (method === "DELETE" && pathname === "/api/providers/prov-1") {
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/providers/prov-1/models") {
      return json([
        { id: "claude-sonnet", name: "Claude Sonnet", context: 200000 },
        { id: "claude-haiku", name: "Claude Haiku", context: 200000 },
      ]);
    }

    if (method === "POST" && pathname === "/api/providers/discover/ollama") {
      return json({
        models: [{ id: "llama3.1:8b" }, { id: "qwen2.5:14b" }],
      });
    }

    if (method === "GET" && pathname === "/api/channels") {
      return json([
        {
          id: "chan-1",
          name: "Discord Ops",
          type: "discord",
          enabled: true,
          dmPolicy: "pairing",
        },
        {
          id: "chan-2",
          name: "Telegram Support",
          type: "telegram",
          enabled: false,
          dmPolicy: "allowlist",
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/channels/chan-1/pairings") {
      return json({
        pairings: [
          {
            id: "pair-1",
            senderId: "user-777",
            code: "PAIR42",
            platform: "discord",
            displayName: "Alice",
            status: "pending",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          },
        ],
        pendingCount: 1,
      });
    }

    if (method === "GET" && pathname === "/api/channels/chan-2/pairings") {
      return json({ pairings: [], pendingCount: 0 });
    }

    if (method === "POST" && pathname === "/api/channels/chan-1/pairings/verify") {
      const parsed = body ? (JSON.parse(body) as { code?: string }) : {};
      if (parsed.code === "PAIR42") {
        return json({ success: true, senderId: "user-777" });
      }
      return json({ success: false, error: "invalid code" });
    }

    if (method === "POST" && pathname === "/api/channels/chan-2/pairings/verify") {
      return json({ success: false, error: "not found" });
    }

    if (method === "POST" && pathname === "/api/channels/chan-1/pairings/pair-1/reject") {
      return json({ success: true });
    }

    if (method === "PUT" && pathname === "/api/channels/chan-1/security") {
      const parsed = body ? (JSON.parse(body) as { dm_policy?: string }) : {};
      return json({
        success: true,
        config: { dm_policy: parsed.dm_policy || "pairing" },
      });
    }

    if (method === "GET" && pathname === "/api/tasks") {
      return json([
        {
          id: "task-1",
          name: "Nightly Check",
          status: "pending",
          schedule: "0 2 * * *",
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/skills/status") {
      return json({
        skills: [
          {
            name: "checks",
            description: "Checks",
            eligible: true,
            source: "system",
          },
          {
            name: "ops",
            description: "Ops",
            eligible: false,
            source: "workspace",
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/plugins") {
      return json({
        plugins: [
          {
            id: "acme-plugin",
            name: "Acme Plugin",
            version: "1.2.3",
            description: "Example plugin",
            source: "local",
            rootDir: "/tmp/acme-plugin",
            skillDirs: ["/tmp/acme-plugin/skills"],
            skillNames: ["acme-skill"],
            skillCount: 1,
            enabled: true,
            builtIn: false,
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/plugins/catalog") {
      return json({
        plugins: [
          {
            id: "developer-essentials",
            name: "Developer Essentials",
            description: "Development workflows",
            tags: ["Development"],
            skillNames: ["code-review", "testing"],
            installed: true,
            enabled: true,
          },
        ],
      });
    }

    if (method === "PUT" && pathname === "/api/plugins/acme-plugin") {
      const parsed = body ? (JSON.parse(body) as { enabled?: boolean }) : {};
      return json({
        success: true,
        plugin: {
          id: "acme-plugin",
          name: "Acme Plugin",
          version: "1.2.3",
          description: "Example plugin",
          source: "local",
          rootDir: "/tmp/acme-plugin",
          skillDirs: ["/tmp/acme-plugin/skills"],
          skillNames: ["acme-skill"],
          skillCount: 1,
          enabled: parsed.enabled === true,
          builtIn: false,
        },
      });
    }

    if ((method === "GET" || method === "POST") && pathname === "/api/plugins/validate") {
      return json({
        valid: true,
        errors: [],
        warnings: [],
        manifest: {
          id: "acme-plugin",
          name: "Acme Plugin",
          version: "1.2.3",
        },
      });
    }

    if (method === "POST" && pathname === "/api/plugins/install") {
      return json({
        success: true,
        plugin: {
          id: "acme-plugin",
          name: "Acme Plugin",
          version: "1.2.3",
          skillDirs: ["/tmp/acme-plugin/skills"],
        },
      });
    }

    if (method === "DELETE" && pathname === "/api/plugins/acme-plugin") {
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/connectors") {
      return json([
        {
          id: "google_workspace",
          label: "Google Workspace",
          services: ["Gmail", "Drive"],
          docsUrl: "https://example.com/setup",
          redirectUri: "http://127.0.0.1:4269/api/connectors/oauth/callback",
          configured: true,
          connected: false,
          access: "read",
        },
      ]);
    }

    if (method === "GET" && (pathname === "/api/chat/sessions" || pathname === "/api/sessions")) {
      return json([
        {
          id: "session-1",
          agent_id: "agent-1",
          message_count: 4,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    }

    if (method === "POST" && pathname === "/api/chat") {
      const parsed = body
        ? (JSON.parse(body) as {
            sessionId?: string;
            message?: string;
            queueMode?: string;
            modelOverride?: string;
            useModelRouter?: boolean;
            agentId?: string;
            workspaceDir?: string;
          })
        : {};
      chatPendingRequests.push({ method, path: pathname, body: parsed });
      if (parsed.queueMode === "queue") {
        return json({
          sessionId: parsed.sessionId || "session-1",
          queued: true,
          pendingMessage: {
            id: "pending-1",
            sessionId: parsed.sessionId || "session-1",
            content: parsed.message || "",
            createdAt: 1783015200000,
            updatedAt: 1783015200000,
            mode: "queued",
            sequence: 1,
          },
          pendingMessages: [
            {
              id: "pending-1",
              sessionId: parsed.sessionId || "session-1",
              content: parsed.message || "",
              createdAt: 1783015200000,
              updatedAt: 1783015200000,
              mode: "queued",
              sequence: 1,
            },
          ],
        });
      }
      return json({
        sessionId: parsed.sessionId || "session-1",
        message: { content: `reply to ${parsed.message || ""}` },
      });
    }

    if (method === "GET" && pathname === "/api/chat/sessions/session-1/pending") {
      chatPendingRequests.push({ method, path: pathname });
      return json({
        sessionId: "session-1",
        pendingMessages: [
          {
            id: "pending-1",
            sessionId: "session-1",
            content: "queued follow-up",
            createdAt: 1783015200000,
            updatedAt: 1783015200000,
            mode: "queued",
            sequence: 1,
          },
        ],
      });
    }

    if (method === "POST" && pathname === "/api/chat/sessions/session-1/pending/pending-1/steer") {
      const parsed = body ? (JSON.parse(body) as { processActivities?: unknown[] }) : {};
      chatPendingRequests.push({ method, path: pathname, body: parsed });
      return json({
        success: true,
        pendingMessages: [],
        interruptedMessage: {
          role: "assistant",
          content: "",
          process_activities: parsed.processActivities || [],
        },
      });
    }

    if (method === "PATCH" && pathname === "/api/chat/sessions/session-1/pending/pending-1") {
      const parsed = body ? (JSON.parse(body) as { content?: string }) : {};
      chatPendingRequests.push({ method, path: pathname, body: parsed });
      return json({
        success: true,
        pendingMessage: {
          id: "pending-1",
          sessionId: "session-1",
          content: parsed.content || "",
          createdAt: 1783015200000,
          updatedAt: 1783015200100,
          mode: "queued",
          sequence: 1,
        },
        pendingMessages: [
          {
            id: "pending-1",
            sessionId: "session-1",
            content: parsed.content || "",
            createdAt: 1783015200000,
            updatedAt: 1783015200100,
            mode: "queued",
            sequence: 1,
          },
        ],
      });
    }

    if (method === "DELETE" && pathname === "/api/chat/sessions/session-1/pending/pending-1") {
      chatPendingRequests.push({ method, path: pathname });
      return json({ success: true, pendingMessages: [] });
    }

    if (method === "POST" && pathname === "/api/chat/sessions/session-1/pending/reorder") {
      const parsed = body ? (JSON.parse(body) as { pendingMessageIds?: string[] }) : {};
      chatPendingRequests.push({ method, path: pathname, body: parsed });
      return json({
        success: true,
        pendingMessages: (parsed.pendingMessageIds || []).map((id, index) => ({
          id,
          sessionId: "session-1",
          content: `queued ${index + 1}`,
          createdAt: 1783015200000 + index,
          updatedAt: 1783015200100,
          mode: "queued",
          sequence: index + 1,
        })),
      });
    }

    if (method === "POST" && pathname === "/api/chat/sessions/session-1/stop") {
      chatPendingRequests.push({ method, path: pathname });
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/memory") {
      return json([
        {
          id: "m-1",
          content: "remember this",
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/memory/search") {
      const query = url.searchParams.get("query") || "";
      return json({
        results: [
          {
            file: "2026-01-01.md",
            entry: {
              timestamp: "12:00:00",
              date: "2026-01-01",
              type: "note",
              tags: ["manual"],
              content: `result for ${query}`,
              index: 0,
            },
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/logs/system") {
      lastLogsLimit = url.searchParams.get("limit");
      return json([
        {
          id: "log-1",
          created_at: new Date().toISOString(),
          level: "info",
          source: "channel",
          logType: "channel",
          message: "incoming discord event",
        },
      ]);
    }

    if (method === "POST" && pathname === "/api/system/restart") {
      return json({
        success: true,
        supervised: false,
        message: "Gateway restart requested.",
      });
    }

    if (method === "GET" && pathname === "/api/config") {
      return json(configState);
    }

    if (method === "PUT" && pathname === "/api/config") {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      Object.assign(configState, parsed);
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/subagents") {
      return json([
        {
          id: "sub-1",
          task: "Analyze logs",
          label: "Analyze logs for errors",
          status: "running",
          createdAt: new Date().toISOString(),
        },
        {
          id: "sub-2",
          task: "Write summary",
          label: "Write release summary",
          status: "completed",
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/subagents/sub-2") {
      return json({
        id: "sub-2",
        task: "Write summary",
        label: "Write release summary",
        status: "completed",
        activityCount: 1,
        toolCallCount: 1,
        activities: [{ text: "Read package", toolName: "read", phase: "result" }],
        toolCalls: [{ name: "read", status: "completed" }],
        result: "Release summary complete",
      });
    }

    if (method === "GET" && pathname === "/api/subagents/missing") {
      return json({ error: "Subagent not found" });
    }

    if (method === "POST" && pathname === "/api/subagents/spawn") {
      const parsed = body ? (JSON.parse(body) as { task?: string }) : {};
      if (!parsed.task) return json({ error: "missing task" }, 400);
      return json({ id: "sub-2" });
    }

    if (method === "POST" && pathname === "/api/subagents/sub-2/kill") {
      return json({ success: true });
    }

    if (method === "POST" && pathname === "/api/subagents/wait") {
      return json({
        status: "completed",
        runs: [
          {
            runId: "sub-2",
            status: "completed",
            label: "Write release summary",
            result: "Release summary complete",
            toolCallCount: 1,
          },
        ],
        pendingRunIds: [],
        elapsedMs: 25,
      });
    }

    if (method === "DELETE" && pathname === "/api/subagents/sub-2") {
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/loops") {
      return json({ runs: [...loopRuns.values()] });
    }

    if (method === "GET" && pathname === "/api/agents/agent-1/loops") {
      return json({
        runs: [...loopRuns.values()].filter((run) => run.agentId === "agent-1"),
      });
    }

    if (method === "POST" && pathname === "/api/agents/agent-1/loops") {
      const parsed = body
        ? (JSON.parse(body) as {
            objective?: string;
            maxIterations?: number;
            maxDurationSeconds?: number;
            model?: string;
            useTools?: boolean;
            label?: string;
          })
        : {};
      if (!parsed.objective || !parsed.objective.trim()) {
        return json({ success: false, error: "objective is required" }, 400);
      }
      const id = `loop-${loopRuns.size + 1}`;
      const now = new Date().toISOString();
      const run = {
        id,
        agentId: "agent-1",
        label: parsed.label || parsed.objective.slice(0, 80),
        objective: parsed.objective,
        status: "running",
        createdAt: now,
        updatedAt: now,
        maxIterations: parsed.maxIterations || 6,
        maxDurationSeconds: parsed.maxDurationSeconds || 300,
        modelOverride: parsed.model,
        useTools: parsed.useTools !== false,
        iterationsCompleted: 0,
        steps: [] as Array<{
          iteration: number;
          durationMs: number;
          toolCallCount: number;
          done: boolean;
        }>,
      };
      loopRuns.set(id, run);
      return json({ success: true, runId: id, run });
    }

    if (method === "GET" && pathname.startsWith("/api/loops/")) {
      const id = pathname.split("/")[3];
      const run = id ? loopRuns.get(id) : undefined;
      if (!run) return json({ success: false, error: "Loop run not found" }, 404);
      return json({ success: true, run });
    }

    if (method === "POST" && pathname.startsWith("/api/loops/") && pathname.endsWith("/cancel")) {
      const id = pathname.split("/")[3];
      const run = id ? loopRuns.get(id) : undefined;
      if (!run) return json({ success: false, error: "Loop run not found" }, 404);
      run.status = "cancelled";
      run.stopReason = "cancelled";
      run.updatedAt = new Date().toISOString();
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/mcp") {
      return json([
        {
          id: "mcp-1",
          name: "Filesystem MCP",
          command: "bunx @modelcontextprotocol/server-filesystem",
          status: "running",
          toolCount: 12,
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/mcp/registry/popular") {
      return json([
        {
          id: "filesystem",
          name: "Filesystem",
          description: "Read and write files",
          registry: "modelcontextprotocol",
          package: "@modelcontextprotocol/server-filesystem",
          command: "bunx",
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/mcp/registry/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      return json([
        {
          id: q || "filesystem",
          name: q ? `Result for ${q}` : "Filesystem",
          description: "Registry search result",
          registry: "modelcontextprotocol",
          package: "@modelcontextprotocol/server-git",
          command: "bunx",
        },
      ]);
    }

    if (method === "POST" && pathname === "/api/mcp/registry/install") {
      const parsed = body
        ? (JSON.parse(body) as { package?: string; trustedAction?: boolean })
        : {};
      if (!parsed.package) return json({ success: false, error: "missing package" }, 400);
      if (parsed.trustedAction !== true) return json({ success: false, error: "untrusted" }, 400);
      return json({ success: true, id: "mcp-installed-1" });
    }

    if (method === "GET" && pathname === "/api/lsp/install-status") {
      return json({
        status: [
          {
            language: "typescript",
            displayName: "TypeScript",
            description: "Bundled TS/JS server",
            type: "bundled",
            installed: true,
            available: true,
            path: null,
          },
          {
            language: "python",
            displayName: "Python",
            description: "Pyright",
            type: "binary",
            installed: false,
            available: true,
            path: "/usr/local/bin/pyright-langserver",
            requiresRuntime: "node",
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/artifacts") {
      return json({
        artifacts: [
          {
            sessionId: "session-1",
            name: "implementation",
            title: "Implementation Notes",
            kind: "implementation",
            size: 2048,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/journey") {
      return json({
        counts: { skills: 1, memories: 1, total: 2 },
        events: [
          {
            id: "skill:release",
            kind: "skill",
            title: "Release workflow",
            category: "delivery",
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }

    if (method === "POST" && pathname === "/api/lsp/install") {
      const parsed = body ? (JSON.parse(body) as { language?: string }) : {};
      if (!parsed.language) return json({ success: false, error: "language required" }, 400);
      return json({ success: true, path: `/mock/lsp/${parsed.language}` });
    }

    if (method === "POST" && pathname === "/api/lsp/uninstall") {
      const parsed = body ? (JSON.parse(body) as { language?: string }) : {};
      if (!parsed.language) return json({ success: false, error: "language required" }, 400);
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/browser/status") {
      return json({
        running: true,
        profile: "default",
        currentUrl: "https://example.com",
      });
    }

    if (method === "GET" && pathname === "/api/browser/tabs") {
      return json({
        tabs: [
          { id: "tab-1", url: "https://example.com", title: "Example Domain" },
          { id: "tab-2", url: "https://docs.cybara.dev", title: "Cybara Docs" },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/wallet/status") {
      return json({
        exists: walletState.exists,
        unlocked: walletState.unlocked,
        address: walletState.primaryAddresses?.eth,
        unlockExpiresAt: walletState.unlockExpiresAt,
        agentAccessEnabled: walletState.agentAccessEnabled,
        chains: ["eth", "btc", "sol"],
        primaryAddresses: walletState.primaryAddresses,
      });
    }

    if (method === "GET" && pathname === "/api/wallet/rpc") {
      return json(walletRpcState);
    }

    if (method === "GET" && pathname === "/api/wallet/rpc/status") {
      return json({
        checkedAt: new Date().toISOString(),
        services: [
          {
            chain: "eth",
            endpoint: walletRpcState.ethRpc,
            healthy: true,
            latencyMs: 21,
            latestHeight: "22000000",
          },
          {
            chain: "sol",
            endpoint: walletRpcState.solRpc,
            healthy: true,
            latencyMs: 44,
            latestHeight: "320000000",
          },
          {
            chain: "btc",
            endpoint: walletRpcState.btcApi,
            healthy: true,
            latencyMs: 18,
            latestHeight: "885000",
          },
        ],
      });
    }

    if (method === "GET" && pathname === "/api/wallet/agent-policy") {
      return json(walletAgentPolicyState);
    }

    if (method === "PUT" && pathname === "/api/wallet/rpc") {
      const parsed = body
        ? (JSON.parse(body) as {
            ethRpc?: string;
            solRpc?: string;
            btcApi?: string;
          })
        : {};
      if (parsed.ethRpc) walletRpcState.ethRpc = parsed.ethRpc;
      if (parsed.solRpc) walletRpcState.solRpc = parsed.solRpc;
      if (parsed.btcApi) walletRpcState.btcApi = parsed.btcApi;
      return json({ success: true, config: walletRpcState });
    }

    if (method === "PUT" && pathname === "/api/wallet/agent-policy") {
      const parsed = body ? (JSON.parse(body) as Partial<typeof walletAgentPolicyState>) : {};
      if (typeof parsed.allowNativeSend === "boolean")
        walletAgentPolicyState.allowNativeSend = parsed.allowNativeSend;
      if (typeof parsed.allowTokenSend === "boolean")
        walletAgentPolicyState.allowTokenSend = parsed.allowTokenSend;
      if (typeof parsed.allowEthContractWrite === "boolean")
        walletAgentPolicyState.allowEthContractWrite = parsed.allowEthContractWrite;
      if (typeof parsed.allowSolProgramInstruction === "boolean")
        walletAgentPolicyState.allowSolProgramInstruction = parsed.allowSolProgramInstruction;
      if (typeof parsed.allowEthSwaps === "boolean")
        walletAgentPolicyState.allowEthSwaps = parsed.allowEthSwaps;
      if (typeof parsed.allowDappInteraction === "boolean")
        walletAgentPolicyState.allowDappInteraction = parsed.allowDappInteraction;
      if (typeof parsed.allowX402Payments === "boolean")
        walletAgentPolicyState.allowX402Payments = parsed.allowX402Payments;
      if (Array.isArray(parsed.allowedEthContracts))
        walletAgentPolicyState.allowedEthContracts = parsed.allowedEthContracts.filter(
          (value): value is string => typeof value === "string"
        );
      if (Array.isArray(parsed.allowedSolPrograms))
        walletAgentPolicyState.allowedSolPrograms = parsed.allowedSolPrograms.filter(
          (value): value is string => typeof value === "string"
        );
      if (Array.isArray(parsed.allowedDappHosts))
        walletAgentPolicyState.allowedDappHosts = parsed.allowedDappHosts.filter(
          (value): value is string => typeof value === "string"
        );
      if (Array.isArray(parsed.allowedX402Networks))
        walletAgentPolicyState.allowedX402Networks = parsed.allowedX402Networks.filter(
          (value): value is string => typeof value === "string"
        );
      if (typeof parsed.x402MaxAmountAtomic === "string")
        walletAgentPolicyState.x402MaxAmountAtomic = parsed.x402MaxAmountAtomic;
      return json({ success: true, policy: walletAgentPolicyState });
    }

    if (method === "POST" && pathname === "/api/wallet/create") {
      const parsed = body ? (JSON.parse(body) as { password?: string }) : {};
      if (!parsed.password) return json({ error: "password required" }, 400);
      walletState.exists = true;
      walletState.unlocked = true;
      walletState.unlockExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return json({
        success: true,
        mnemonic:
          "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega",
        address: walletState.primaryAddresses?.eth,
        primaryAddresses: walletState.primaryAddresses,
      });
    }

    if (method === "POST" && pathname === "/api/wallet/import") {
      const parsed = body ? (JSON.parse(body) as { password?: string; mnemonic?: string }) : {};
      if (!parsed.password || !parsed.mnemonic)
        return json({ error: "password and mnemonic required" }, 400);
      walletState.exists = true;
      walletState.unlocked = true;
      walletState.unlockExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return json({
        success: true,
        mnemonic: parsed.mnemonic,
        address: walletState.primaryAddresses?.eth,
        primaryAddresses: walletState.primaryAddresses,
      });
    }

    if (method === "POST" && pathname === "/api/wallet/unlock") {
      const parsed = body ? (JSON.parse(body) as { password?: string }) : {};
      if (!parsed.password) return json({ error: "password required" }, 400);
      walletState.unlocked = true;
      walletState.unlockExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return json({
        success: true,
        address: walletState.primaryAddresses?.eth,
        unlockExpiresAt: walletState.unlockExpiresAt,
        primaryAddresses: walletState.primaryAddresses,
      });
    }

    if (method === "POST" && pathname === "/api/wallet/seed") {
      const parsed = body
        ? (JSON.parse(body) as { password?: string; acknowledgement?: string })
        : {};
      if (!parsed.password || parsed.acknowledgement !== "REVEAL") {
        return json({ error: "verification required" }, 400);
      }
      return json({
        mnemonic:
          "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega",
        wordCount: 24,
      });
    }

    if (method === "POST" && pathname === "/api/wallet/lock") {
      walletState.unlocked = false;
      return json({ success: true });
    }

    if (method === "GET" && pathname === "/api/wallet/accounts") {
      const count = Number(url.searchParams.get("count") || "1");
      const startIndex = Number(url.searchParams.get("startIndex") || "0");
      const chains = (url.searchParams.get("chains") || "eth,btc,sol").split(",");
      const accounts = chains.flatMap((chain) =>
        Array.from({ length: Math.max(1, count) }).map((_, offset) => ({
          chain,
          index: startIndex + offset,
          path: `m/mock/${chain}/${startIndex + offset}`,
          address: `${chain}-address-${startIndex + offset}`,
        }))
      );
      return json(accounts);
    }

    if (method === "GET" && pathname === "/api/wallet/receive") {
      const chain = url.searchParams.get("chain") || "eth";
      const index = Number(url.searchParams.get("index") || "0");
      return json({
        chain,
        index,
        path: `m/mock/${chain}/${index}`,
        address: `${chain}-address-${index}`,
      });
    }

    if (method === "GET" && pathname === "/api/wallet/balances") {
      const count = Number(url.searchParams.get("count") || "1");
      const startIndex = Number(url.searchParams.get("startIndex") || "0");
      const chains = (url.searchParams.get("chains") || "eth,btc,sol").split(",");
      const symbolByChain: Record<string, string> = {
        eth: "ETH",
        btc: "BTC",
        sol: "SOL",
      };
      const balances = chains.flatMap((chain) =>
        Array.from({ length: Math.max(1, count) }).map((_, offset) => ({
          chain,
          index: startIndex + offset,
          path: `m/mock/${chain}/${startIndex + offset}`,
          address: `${chain}-address-${startIndex + offset}`,
          symbol: symbolByChain[chain] || chain.toUpperCase(),
          amount: chain === "eth" ? "0.5" : chain === "btc" ? "0.01" : "2.3",
        }))
      );
      return json(balances);
    }

    if (method === "GET" && pathname === "/api/wallet/tokens") {
      const chain = (url.searchParams.get("chain") || "eth") as "eth" | "sol";
      const index = Number(url.searchParams.get("index") || "0");
      return json([
        {
          chain,
          index,
          address: `${chain}-address-${index}`,
          tokenAddress:
            chain === "eth"
              ? "0xToken000000000000000000000000000000000001"
              : "So11111111111111111111111111111111111111112",
          symbol: chain === "eth" ? "USDC" : "SPL",
          amount: "4.2",
          decimals: chain === "eth" ? 6 : 9,
          raw: chain === "eth" ? "4200000" : "4200000000",
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/wallet/transactions") {
      const chain = url.searchParams.get("chain") || "eth";
      return json([
        {
          txid: `${chain}-tx-1`,
          status: "confirmed",
          amount: "0.1",
          fee: "0.001",
          from: `${chain}-from`,
          to: `${chain}-to`,
          timestamp: new Date().toISOString(),
          explorerUrl: `https://explorer.example/${chain}/tx/${chain}-tx-1`,
        },
      ]);
    }

    if (method === "GET" && pathname === "/api/wallet/token-transactions") {
      const chain = (url.searchParams.get("chain") || "eth") as "eth" | "sol";
      const index = Number(url.searchParams.get("index") || "0");
      return json([
        {
          chain,
          index,
          address: `${chain}-address-${index}`,
          tokenAddress:
            chain === "eth"
              ? "0xToken000000000000000000000000000000000001"
              : "So11111111111111111111111111111111111111112",
          symbol: chain === "eth" ? "USDC" : "SPL",
          decimals: chain === "eth" ? 6 : 9,
          txid: `${chain}-token-tx-1`,
          status: "confirmed",
          direction: "in",
          amount: "1.25",
          raw: chain === "eth" ? "1250000" : "1250000000",
          explorerUrl: `https://explorer.example/${chain}/tx/${chain}-token-tx-1`,
        },
      ]);
    }

    if (method === "POST" && pathname === "/api/wallet/send") {
      const parsed = body
        ? (JSON.parse(body) as { chain?: string; to?: string; amount?: string })
        : {};
      if (!parsed.chain || !parsed.to || !parsed.amount)
        return json({ error: "invalid payload" }, 400);
      return json({
        chain: parsed.chain,
        txid: `${parsed.chain}-tx-sent-1`,
        explorerUrl: `https://explorer.example/${parsed.chain}/tx/${parsed.chain}-tx-sent-1`,
      });
    }

    if (method === "POST" && pathname === "/api/wallet/send-token") {
      const parsed = body
        ? (JSON.parse(body) as {
            chain?: "eth" | "sol";
            tokenAddress?: string;
            to?: string;
            amount?: string;
          })
        : {};
      if (!parsed.chain || !parsed.tokenAddress || !parsed.to || !parsed.amount) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        chain: parsed.chain,
        tokenAddress: parsed.tokenAddress,
        txid: `${parsed.chain}-token-tx-sent-1`,
        explorerUrl: `https://explorer.example/${parsed.chain}/tx/${parsed.chain}-token-tx-sent-1`,
      });
    }

    if (method === "POST" && pathname === "/api/wallet/eth-contract") {
      const parsed = body
        ? (JSON.parse(body) as {
            contractAddress?: string;
            abi?: string;
            method?: string;
            methodSignature?: string;
            gasLimit?: string;
            nonce?: number;
            readOnly?: boolean;
          })
        : {};
      if (!parsed.contractAddress || !parsed.method || (!parsed.abi && !parsed.methodSignature)) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        chain: "eth",
        readOnly: parsed.readOnly === true,
        contractAddress: parsed.contractAddress,
        method: parsed.method,
        methodSignature: parsed.methodSignature,
        nonce: parsed.nonce,
        gasLimit: parsed.gasLimit,
        result: "mock-result",
      });
    }

    if (method === "POST" && pathname === "/api/wallet/sol-instruction") {
      const parsed = body
        ? (JSON.parse(body) as {
            programId?: string;
            keys?: unknown[];
            accounts?: unknown[];
          })
        : {};
      if (!parsed.programId || (!Array.isArray(parsed.keys) && !Array.isArray(parsed.accounts))) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        chain: "sol",
        txid: "sol-inst-tx-1",
        explorerUrl: "https://explorer.example/sol/tx/sol-inst-tx-1",
      });
    }

    if (method === "POST" && pathname === "/api/wallet/swap-eth-uniswap") {
      const parsed = body
        ? (JSON.parse(body) as {
            tokenOut?: string;
            percent?: number;
            amountEth?: string;
            dryRun?: boolean;
          })
        : {};
      if (!parsed.tokenOut || (!parsed.percent && !parsed.amountEth)) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        chain: "eth",
        dex: "uniswap_v2",
        from: walletState.primaryAddresses?.eth,
        toTokenAddress: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        toTokenSymbol: parsed.tokenOut,
        amountInEth: parsed.amountEth || "0.5",
        amountInWei: "500000000000000000",
        quotedAmountOut: "100",
        quotedAmountOutRaw: "100000000000000000000",
        minAmountOut: "99",
        minAmountOutRaw: "99000000000000000000",
        slippageBps: 100,
        recipient: walletState.primaryAddresses?.eth,
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
        dryRun: parsed.dryRun === true,
        txid: parsed.dryRun ? undefined : "swap-tx-1",
        explorerUrl: parsed.dryRun ? undefined : "https://etherscan.io/tx/swap-tx-1",
      });
    }

    if (method === "POST" && pathname === "/api/wallet/price") {
      const parsed = body
        ? (JSON.parse(body) as {
            source?: string;
            symbol?: string;
            pair?: string;
            mint?: string;
          })
        : {};
      if (!parsed.symbol && !parsed.pair && !parsed.mint) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        source: parsed.source || "auto",
        base: parsed.symbol || "BTC",
        quote: "USD",
        price: "123.45",
        feedId: "0xfeed",
      });
    }

    if (method === "GET" && pathname === "/api/wallet/endpoints") {
      return json({
        ethereum: {
          wrappedNative: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
          dex: {
            uniswapV2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
            uniswapV3Router02: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
          },
          oracles: {
            chainlinkFeedRegistry: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf",
            usdDenomination: "0x0000000000000000000000000000000000000348",
            chainlinkUsdFeeds: {
              BTC: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
            },
          },
        },
        solana: {
          nativeMint: "So11111111111111111111111111111111111111112",
          commonMints: {
            SOL: "So11111111111111111111111111111111111111112",
            USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          },
          programs: {
            tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          },
        },
        services: {
          pythHermes: "https://hermes.pyth.network/v2",
          jupiterPriceApi: "https://lite-api.jup.ag/price/v3",
        },
      });
    }

    if (method === "GET" && pathname === "/api/wallet/dapps") {
      return json({
        adapters: [
          {
            adapter: "uniswap_v3",
            chain: "eth",
            write: true,
            description: "Uniswap V3 quote and swap router integration",
          },
          {
            adapter: "jupiter",
            chain: "sol",
            write: true,
            description: "Jupiter quote and swap integration",
          },
        ],
        notes: ["Enable agent wallet access and agent dapp policy before autonomous execution."],
      });
    }

    if (method === "POST" && pathname === "/api/wallet/rpc-call") {
      const parsed = body
        ? (JSON.parse(body) as {
            chain?: "eth" | "sol";
            method?: string;
            params?: unknown[];
            rpcUrl?: string;
            id?: string | number;
          })
        : {};
      if (!parsed.method || (parsed.chain !== "eth" && parsed.chain !== "sol")) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        chain: parsed.chain,
        rpcUrl:
          parsed.rpcUrl || (parsed.chain === "eth" ? walletRpcState.ethRpc : walletRpcState.solRpc),
        method: parsed.method,
        id: parsed.id ?? 1,
        result:
          parsed.method === "eth_blockNumber"
            ? "0x14fb90e"
            : {
                ok: true,
                params: Array.isArray(parsed.params) ? parsed.params : [],
              },
      });
    }

    if (method === "POST" && pathname === "/api/wallet/dapp") {
      const parsed = body
        ? (JSON.parse(body) as {
            adapter?: string;
            payload?: Record<string, unknown>;
          })
        : {};
      if (!parsed.adapter) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        adapter: parsed.adapter,
        ok: true,
        route: "mock-route",
        payload: parsed.payload || {},
      });
    }

    if (method === "POST" && pathname === "/api/wallet/x402") {
      const parsed = body
        ? (JSON.parse(body) as {
            url?: string;
            method?: string;
            network?: string;
            dryRun?: boolean;
            maxAmountAtomic?: string;
          })
        : {};
      if (!parsed.url) {
        return json({ error: "invalid payload" }, 400);
      }
      return json({
        url: parsed.url,
        method: (parsed.method || "GET").toUpperCase(),
        status: parsed.dryRun ? 402 : 200,
        paid: parsed.dryRun !== true,
        attemptedPayment: true,
        paymentHeaderUsed: parsed.dryRun ? undefined : "PAYMENT-SIGNATURE",
        paymentRequirement: {
          x402Version: 2,
          scheme: "exact",
          network: parsed.network || "eip155:1",
          amount: parsed.maxAmountAtomic || "10000",
          asset: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          payTo: "0x0000000000000000000000000000000000000001",
          maxTimeoutSeconds: 300,
        },
        settlement: parsed.dryRun
          ? undefined
          : {
              success: true,
              transaction: "0xsettled",
              network: parsed.network || "eip155:1",
              payer: walletState.primaryAddresses?.eth,
            },
        body: parsed.dryRun ? { message: "payment required" } : { message: "paid" },
      });
    }

    if (method === "POST" && pathname === "/api/wallet/swap") {
      const parsed = body
        ? (JSON.parse(body) as {
            venue?: string;
            tokenOut?: string;
            inputMint?: string;
            outputMint?: string;
            amountEth?: string;
            amount?: string;
            dryRun?: boolean;
          })
        : {};

      if (
        !parsed.venue ||
        (parsed.venue !== "jupiter" && !parsed.tokenOut) ||
        (parsed.venue === "jupiter" && (!parsed.inputMint || !parsed.outputMint))
      ) {
        return json({ error: "invalid payload" }, 400);
      }

      return json({
        venue: parsed.venue,
        chain: parsed.venue === "jupiter" ? "sol" : "eth",
        from:
          parsed.venue === "jupiter"
            ? walletState.primaryAddresses?.sol
            : walletState.primaryAddresses?.eth,
        inputToken: parsed.venue === "jupiter" ? parsed.inputMint : "ETH",
        outputToken: parsed.venue === "jupiter" ? parsed.outputMint : parsed.tokenOut,
        amountIn: parsed.venue === "jupiter" ? parsed.amount || "1" : parsed.amountEth || "0.5",
        amountInRaw: "1000000000",
        quotedAmountOut: "100",
        quotedAmountOutRaw: "100000000",
        minAmountOut: "99",
        minAmountOutRaw: "99000000",
        slippageBps: 100,
        dryRun: parsed.dryRun === true,
        route: parsed.venue === "jupiter" ? "Jupiter Router" : "uniswap",
        txid: parsed.dryRun ? undefined : "dynamic-swap-tx-1",
        explorerUrl: parsed.dryRun
          ? undefined
          : parsed.venue === "jupiter"
            ? "https://solscan.io/tx/dynamic-swap-tx-1"
            : "https://etherscan.io/tx/dynamic-swap-tx-1",
      });
    }

    if (method === "POST" && pathname === "/api/wallet/sign") {
      return json({
        address: walletState.primaryAddresses?.eth,
        signature: "0xsignature",
      });
    }

    if (method === "PUT" && pathname === "/api/wallet/agent-access") {
      const parsed = body ? (JSON.parse(body) as { enabled?: boolean }) : {};
      walletState.agentAccessEnabled = parsed.enabled === true;
      return json({ success: true, enabled: walletState.agentAccessEnabled });
    }

    if (method === "GET" && pathname === "/api/mobile/devices") {
      return json({ devices: [mobileDevice] });
    }

    if (method === "POST" && pathname === "/api/mobile/devices") {
      const parsed = body
        ? (JSON.parse(body) as {
            baseUrl?: string;
            gatewayName?: string;
            deviceName?: string;
          })
        : {};
      return json(
        mobilePairing(
          parsed.baseUrl || "http://127.0.0.1:4269",
          parsed.gatewayName || "Cybara Gateway"
        )
      );
    }

    if (method === "POST" && pathname === "/api/mobile/devices/mobile-1/revoke") {
      return json({
        success: true,
        device: {
          ...mobileDevice,
          status: "revoked",
          revokedAt: "2026-06-30T01:00:00.000Z",
        },
      });
    }

    if (method === "DELETE" && pathname === "/api/mobile/devices/mobile-1") {
      return json({ success: true });
    }

    return json({ error: `Unhandled route: ${method} ${pathname}` }, 404);
  }

  async function runCli(
    args: string[],
    envOverride?: Record<string, string>
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        CYBARA_API: apiBase,
        ...envOverride,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return {
      exitCode,
      stdout,
      stderr,
    };
  }

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        let body = "";
        if (req.method !== "GET" && req.method !== "HEAD") {
          try {
            body = await req.text();
          } catch {
            body = "";
          }
        }
        return route(req.method, url, body);
      },
    });
    apiBase = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  return {
    runCli,
    chatPendingRequests,
    get apiBase() {
      return apiBase;
    },
    get lastLogsLimit() {
      return lastLogsLimit;
    },
  };
}

export function createCliCommandsFixture(): ReturnType<typeof buildCliCommandsFixture> {
  return buildCliCommandsFixture();
}
