import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let baseUrl = "";
let homeDir = "";
let agentId = "";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }

      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 15000,
  intervalMs = 200
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition");
}

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    "sec-fetch-site": "same-origin",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    data,
  };
}

describe("Chat + Logs + Metrics e2e smoke", () => {
  beforeAll(async () => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-chat-logs-metrics-home-"));
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    serverProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        PORT: String(port),
      },
      stdout: "ignore",
      stderr: "ignore",
    });

    await waitForServerReady(baseUrl);

    const createAgent = await api("POST", "/api/agents", {
      name: `e2e-chat-agent-${Date.now()}`,
      type: "basic",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });

    expect(createAgent.status).toBe(200);
    expect(typeof createAgent.data?.id).toBe("string");
    agentId = createAgent.data.id as string;
  });

  afterAll(async () => {
    if (agentId) {
      await api("DELETE", `/api/agents/${agentId}`);
    }

    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {}
      await Promise.race([serverProc.exited, sleep(5000)]);
    }

    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("chat requests create sessions that are queryable across session and log APIs", async () => {
    const marker = `chat-log-marker-${Date.now()}`;

    const chatRes = await api("POST", "/api/chat", {
      agentId,
      message: `Please remember this marker for test visibility: ${marker}`,
    });

    expect(chatRes.status).toBe(200);
    expect(typeof chatRes.data?.sessionId).toBe("string");
    expect(typeof chatRes.data?.message?.content).toBe("string");

    const sessionId = chatRes.data.sessionId as string;

    const chatSessionsRes = await api("GET", "/api/chat/sessions");
    expect(chatSessionsRes.status).toBe(200);
    expect(Array.isArray(chatSessionsRes.data)).toBe(true);
    expect(chatSessionsRes.data.some((s: { id: string }) => s.id === sessionId)).toBe(true);

    const chatSessionRes = await api("GET", `/api/chat/sessions/${sessionId}`);
    expect(chatSessionRes.status).toBe(200);
    expect(chatSessionRes.data.id).toBe(sessionId);
    expect(Array.isArray(chatSessionRes.data.messages)).toBe(true);

    const chatMessagesRes = await api("GET", `/api/chat/sessions/${sessionId}/messages`);
    expect(chatMessagesRes.status).toBe(200);
    expect(Array.isArray(chatMessagesRes.data)).toBe(true);
    expect(
      chatMessagesRes.data.some(
        (m: { role: string; content: string }) => m.role === "user" && m.content.includes(marker)
      )
    ).toBe(true);

    const sessionsRes = await api("GET", "/api/sessions");
    expect(sessionsRes.status).toBe(200);
    expect(Array.isArray(sessionsRes.data)).toBe(true);

    const foundSession = sessionsRes.data.find((s: { id: string }) => s.id === sessionId);
    expect(foundSession).toBeDefined();
    expect(typeof foundSession?.message_count).toBe("number");
    expect(foundSession?.message_count).toBeGreaterThan(0);

    const sessionDetailRes = await api("GET", `/api/sessions/${sessionId}`);
    expect(sessionDetailRes.status).toBe(200);
    expect(sessionDetailRes.data.id).toBe(sessionId);
    expect(Array.isArray(sessionDetailRes.data.messagesList)).toBe(true);
    expect(sessionDetailRes.data.messagesList.length).toBeGreaterThan(0);

    await waitFor(async () => {
      const searchRes = await api("GET", `/api/logs/search?q=${encodeURIComponent(marker)}`);
      if (searchRes.status !== 200 || !searchRes.data) return false;
      const sessionMessages = (searchRes.data as { sessionMessages?: Array<{ content: string }> })
        .sessionMessages;
      return (
        Array.isArray(sessionMessages) &&
        sessionMessages.some((entry) => entry.content.includes(marker))
      );
    });

    const sessionLogsRes = await api("GET", `/api/logs/sessions/${sessionId}/messages`);
    expect(sessionLogsRes.status).toBe(200);
    expect(Array.isArray(sessionLogsRes.data)).toBe(true);
    expect(
      sessionLogsRes.data.some((entry: { content: string }) => entry.content.includes(marker))
    ).toBe(true);

    const activityRes = await api("GET", "/api/logs/activity?minutes=120");
    expect(activityRes.status).toBe(200);
    expect(Array.isArray(activityRes.data.system)).toBe(true);
    expect(Array.isArray(activityRes.data.messages)).toBe(true);
    expect(Array.isArray(activityRes.data.agent)).toBe(true);
    expect(Array.isArray(activityRes.data.channel)).toBe(true);

    const statsRes = await api("GET", "/api/logs/stats?hours=1");
    expect(statsRes.status).toBe(200);
    expect(typeof statsRes.data.counts.messages).toBe("number");
    expect(typeof statsRes.data.counts.system).toBe("number");
    expect(typeof statsRes.data.counts.agent).toBe("number");
    expect(typeof statsRes.data.counts.channel).toBe("number");

    const deleteRes = await api("DELETE", `/api/chat/sessions/${sessionId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.data.success).toBe(true);

    const deletedSessionRes = await api("GET", `/api/sessions/${sessionId}`);
    expect(deletedSessionRes.status).toBe(200);
    expect(deletedSessionRes.data.error).toBe("Session not found");
  });

  test("metrics tracking feeds overview, detail, and system status endpoints", async () => {
    const activityTimestamp = Date.now();

    const badTrack = await api("POST", "/api/metrics/track", {});
    expect(badTrack.status).toBe(400);
    expect(badTrack.data.code).toBe("VALIDATION_ERROR");

    const metricEvents = [
      { type: "token_usage", key: "input", value: 120 },
      { type: "token_usage", key: "output", value: 45 },
      {
        type: "token_usage",
        key: "all",
        value: 165,
        metadata: {
          inputTokens: 120,
          outputTokens: 45,
          model: "claude-sonnet-4-20250514",
          provider: "anthropic",
          durationMs: 2400,
        },
      },
      {
        type: "token_usage_by_model",
        key: "claude-sonnet-4-20250514",
        value: 165,
        metadata: { provider: "anthropic" },
      },
      {
        type: "token_usage_by_provider",
        key: "openai",
        value: 165,
        metadata: { url: "https://api.openai.com" },
      },
      {
        type: "api_call",
        key: "openai",
        value: 3,
        metadata: { url: "https://api.openai.com" },
      },
      { type: "file_operation", key: "read", value: 4 },
      { type: "tool_call", key: "read_file", value: 2, metadata: { durationMs: 12 } },
      { type: "system_status", key: "last_activity", value: activityTimestamp },
    ];

    for (const event of metricEvents) {
      const trackRes = await api("POST", "/api/metrics/track", event);
      expect(trackRes.status).toBe(200);
      expect(trackRes.data.success).toBe(true);
      expect(typeof trackRes.data.id).toBe("string");
    }

    const systemStatusRes = await api("GET", "/api/system/status");
    expect(systemStatusRes.status).toBe(200);
    expect(systemStatusRes.data.status).toBe("thinking");
    expect(systemStatusRes.data.lastActivity).toBe(activityTimestamp);
    expect(typeof systemStatusRes.data.agentCount).toBe("number");
    expect(typeof systemStatusRes.data.resources?.cpu?.usagePct).toBe("number");
    expect(typeof systemStatusRes.data.resources?.memory?.totalBytes).toBe("number");

    const systemMonitorRes = await api("GET", "/api/system/monitor");
    expect(systemMonitorRes.status).toBe(200);
    expect(systemMonitorRes.data.status).toBe("healthy");
    expect(typeof systemMonitorRes.data.cpu.usagePct).toBe("number");
    expect(typeof systemMonitorRes.data.cpu.cores).toBe("number");
    expect(systemMonitorRes.data.memory.totalBytes).toBeGreaterThan(0);
    expect(systemMonitorRes.data.memory.usedBytes).toBeGreaterThanOrEqual(0);
    expect(typeof systemMonitorRes.data.process.memory.rssBytes).toBe("number");

    const overviewRes = await api("GET", "/api/metrics/overview");
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.data.tokenUsage.total).toBeGreaterThanOrEqual(165);
    expect(overviewRes.data.tokenUsage.input).toBeGreaterThanOrEqual(120);
    expect(overviewRes.data.tokenUsage.output).toBeGreaterThanOrEqual(45);
    expect(overviewRes.data.fileOperations.filesRead).toBeGreaterThanOrEqual(4);
    expect(overviewRes.data.toolCalls.totalCalls).toBeGreaterThanOrEqual(2);

    const tokensRes = await api("GET", "/api/metrics/tokens");
    expect(tokensRes.status).toBe(200);
    expect(tokensRes.data.totalTokens).toBeGreaterThanOrEqual(165);
    expect(Array.isArray(tokensRes.data.topModels)).toBe(true);
    expect(Array.isArray(tokensRes.data.topProviders)).toBe(true);

    const filesRes = await api("GET", "/api/metrics/files");
    expect(filesRes.status).toBe(200);
    expect(Array.isArray(filesRes.data.mostRead)).toBe(true);
    expect(Array.isArray(filesRes.data.recentOperations)).toBe(true);

    const toolsRes = await api("GET", "/api/metrics/tools");
    expect(toolsRes.status).toBe(200);
    expect(Array.isArray(toolsRes.data.mostUsed)).toBe(true);
    expect(Array.isArray(toolsRes.data.recentCalls)).toBe(true);

    const providersRes = await api("GET", "/api/metrics/providers");
    expect(providersRes.status).toBe(200);
    expect(Array.isArray(providersRes.data.providers)).toBe(true);
    expect(
      providersRes.data.providers.some(
        (p: { provider: string; url: string; hits: number; tokens: number }) =>
          p.provider === "openai" &&
          p.url === "https://api.openai.com" &&
          p.hits >= 3 &&
          p.tokens >= 165
      )
    ).toBe(true);

    const timeSeriesRes = await api("GET", "/api/metrics/time-series");
    expect(timeSeriesRes.status).toBe(200);
    expect(Array.isArray(timeSeriesRes.data.days)).toBe(true);
    expect(timeSeriesRes.data.days.length).toBe(30);

    const modelsRes = await api("GET", "/api/metrics/models");
    expect(modelsRes.status).toBe(200);
    expect(Array.isArray(modelsRes.data.models)).toBe(true);

    const tokenAnalysisRes = await api("GET", "/api/metrics/token-analysis");
    expect(tokenAnalysisRes.status).toBe(200);
    expect(typeof tokenAnalysisRes.data.summary.callCount).toBe("number");
    expect(tokenAnalysisRes.data.summary.totalTokens).toBeGreaterThanOrEqual(165);
    expect(Array.isArray(tokenAnalysisRes.data.tokenHeatmap.days)).toBe(true);
    expect(tokenAnalysisRes.data.tokenHeatmap.days.length).toBe(7);
    expect(Array.isArray(tokenAnalysisRes.data.tokenCloud)).toBe(true);
    expect(Array.isArray(tokenAnalysisRes.data.modelThoughtProfiles)).toBe(true);
  });
});
