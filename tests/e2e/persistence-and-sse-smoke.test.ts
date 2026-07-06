import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API_KEY = "persist-sse-e2e-key";

let homeDir = "";

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

function startServer(port: number): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      PORT: String(port),
      CYBARA_API_KEY: API_KEY,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function stopServer(proc: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!proc) return;
  try {
    proc.kill("SIGTERM");
  } catch {}
  await Promise.race([proc.exited, sleep(5000)]);
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

async function api(baseUrl: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return { status: response.status, data };
}

function corruptSessionMetadata(sessionId: string): void {
  const dbPath = join(homeDir, ".cybara", "data", "platform.db");
  const db = new Database(dbPath);
  try {
    db.query("UPDATE session_messages SET metadata = ? WHERE session_id = ?").run(
      "{bad-json",
      sessionId
    );
  } finally {
    db.close();
  }
}

describe("Persistence + SSE e2e", () => {
  beforeAll(() => {
    homeDir = mkdtempSync(join(tmpdir(), "cybara-persist-sse-e2e-home-"));
  });

  afterAll(() => {
    if (homeDir) {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("config/memory/channel/task state persists across restart", async () => {
    let proc: ReturnType<typeof Bun.spawn> | null = null;

    const configKey = `e2e_persist_key_${Date.now()}`;
    const configValue = `persist-value-${Date.now()}`;
    const memoryFile = `persist-memory-${Date.now()}.md`;
    const channelName = `persist-channel-${Date.now()}`;
    const taskName = `persist-task-${Date.now()}`;
    const chatMarker = `persist-chat-marker-${Date.now()}`;

    let channelId = "";
    let taskId = "";
    let agentId = "";
    let sessionId = "";
    let secondBaseUrl = "";

    try {
      const firstPort = await getFreePort();
      const firstBaseUrl = `http://127.0.0.1:${firstPort}`;
      proc = startServer(firstPort);
      await waitForServerReady(firstBaseUrl);

      const setup = await api(firstBaseUrl, "POST", "/api/setup/complete");
      expect(setup.status).toBe(200);

      const setConfig = await api(firstBaseUrl, "PUT", "/api/config", { [configKey]: configValue });
      expect(setConfig.status).toBe(200);
      expect(setConfig.data.success).toBe(true);

      const createMemory = await api(firstBaseUrl, "POST", "/api/memory", {
        file: memoryFile,
        content: "persistence smoke test memory content",
      });
      expect(createMemory.status).toBe(200);
      expect(createMemory.data.success).toBe(true);

      const createChannel = await api(firstBaseUrl, "POST", "/api/channels", {
        name: channelName,
        type: "web",
        config: {},
      });
      expect(createChannel.status).toBe(200);
      expect(typeof createChannel.data.id).toBe("string");
      channelId = createChannel.data.id as string;

      const createTask = await api(firstBaseUrl, "POST", "/api/tasks", {
        name: taskName,
        description: "persistence e2e task",
        action: "persist me",
        schedule: "0 * * * *",
        enabled: false,
      });
      expect(createTask.status).toBe(200);
      expect(typeof createTask.data.id).toBe("string");
      taskId = createTask.data.id as string;

      const createAgent = await api(firstBaseUrl, "POST", "/api/agents", {
        name: `persist-agent-${Date.now()}`,
        type: "basic",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });
      expect(createAgent.status).toBe(200);
      expect(typeof createAgent.data.id).toBe("string");
      agentId = createAgent.data.id as string;

      const chatRes = await api(firstBaseUrl, "POST", "/api/chat", {
        agentId,
        message: `Persistence contract marker: ${chatMarker}`,
      });
      expect(chatRes.status).toBe(200);
      expect(typeof chatRes.data.sessionId).toBe("string");
      sessionId = chatRes.data.sessionId as string;
      corruptSessionMetadata(sessionId);

      await stopServer(proc);
      proc = null;

      const secondPort = await getFreePort();
      secondBaseUrl = `http://127.0.0.1:${secondPort}`;
      proc = startServer(secondPort);
      await waitForServerReady(secondBaseUrl);

      const configRes = await api(secondBaseUrl, "GET", "/api/config");
      expect(configRes.status).toBe(200);
      expect(configRes.data[configKey]).toBe(configValue);

      const memoryRes = await api(secondBaseUrl, "GET", "/api/memory");
      expect(memoryRes.status).toBe(200);
      expect(Array.isArray(memoryRes.data.files)).toBe(true);
      expect(memoryRes.data.files).toContain(memoryFile);

      const channelsRes = await api(secondBaseUrl, "GET", "/api/channels");
      expect(channelsRes.status).toBe(200);
      expect(
        channelsRes.data.some((entry: { id: string; name: string }) => entry.id === channelId)
      ).toBe(true);
      expect(
        channelsRes.data.some((entry: { id: string; name: string }) => entry.name === channelName)
      ).toBe(true);

      const tasksRes = await api(secondBaseUrl, "GET", "/api/tasks");
      expect(tasksRes.status).toBe(200);
      expect(tasksRes.data.some((entry: { id: string; name: string }) => entry.id === taskId)).toBe(
        true
      );
      expect(
        tasksRes.data.some((entry: { id: string; name: string }) => entry.name === taskName)
      ).toBe(true);

      const sessionsRes = await api(secondBaseUrl, "GET", "/api/sessions");
      expect(sessionsRes.status).toBe(200);
      expect(Array.isArray(sessionsRes.data)).toBe(true);
      const sessionEntry = sessionsRes.data.find((entry: { id: string }) => entry.id === sessionId);
      expect(sessionEntry).toBeDefined();
      expect((sessionEntry?.message_count || 0) > 0).toBe(true);

      const sessionDetailRes = await api(secondBaseUrl, "GET", `/api/sessions/${sessionId}`);
      expect(sessionDetailRes.status).toBe(200);
      expect(sessionDetailRes.data.id).toBe(sessionId);
      expect(Array.isArray(sessionDetailRes.data.messagesList)).toBe(true);
      expect(
        sessionDetailRes.data.messagesList.some(
          (msg: { role: string; content: string }) =>
            msg.role === "user" && msg.content.includes(chatMarker)
        )
      ).toBe(true);

      await api(secondBaseUrl, "DELETE", `/api/tasks/${taskId}`);
      await api(secondBaseUrl, "DELETE", `/api/channels/${channelId}`);
      await api(secondBaseUrl, "DELETE", `/api/memory/${memoryFile}`);
      await api(secondBaseUrl, "DELETE", `/api/chat/sessions/${sessionId}`);
      await api(secondBaseUrl, "DELETE", `/api/agents/${agentId}`);
    } finally {
      await stopServer(proc);
    }
  });

  test("status SSE endpoint streams an initial event", async () => {
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      proc = startServer(port);
      await waitForServerReady(baseUrl);

      const response = await fetch(`${baseUrl}/api/sse/status`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      reader = response.body?.getReader() || null;
      expect(reader).toBeTruthy();
      if (!reader) return;

      const firstChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for SSE event")), 5000)
        ),
      ]);

      expect(firstChunk.done).toBe(false);
      const text = new TextDecoder().decode(firstChunk.value);
      expect(text).toContain("data:");
      const dataLine = text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      expect(dataLine).toBeTruthy();
      const payload = JSON.parse(dataLine || "{}");
      expect(payload.type).toBe("snapshot");
      expect(Array.isArray(payload.activeSessions)).toBe(true);
      expect(payload.count).toBe(payload.activeSessions.length);
    } finally {
      try {
        await reader?.cancel();
      } catch {}
      await stopServer(proc);
    }
  });
});
