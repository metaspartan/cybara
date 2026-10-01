import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

const key = "context-compaction-fixture-key";
const sessionId = `compaction-meter-${crypto.randomUUID()}`;
let home = "";
let url = "";
let gateway: ReturnType<typeof Bun.spawn> | undefined;
let provider: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let agentId = "";
const events: Array<{
  sessionId?: string;
  contextUsage?: { usedTokens: number; limitTokens: number };
  status?: string;
}> = [];
let socket: WebSocket | undefined;

interface Detail {
  contextUsage: {
    usedTokens: number;
    limitTokens: number;
    usedPercent: number;
    compactionCount: number;
    source: string;
  };
  tokenUsage?: { totalTokens: number };
  messagesList?: Array<{ role: string; content: string }>;
}
async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.error || data.failure)
    throw new Error(`Compaction fixture ${path} failed`);
  return data;
}
async function start(): Promise<void> {
  gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: join(home, "Local"),
      PORT: new URL(url).port,
      CYBARA_HOST: "127.0.0.1",
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Compaction fixture gateway did not start");
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-context-meter-"));
  const allocation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  url = `http://127.0.0.1:${allocation.port}`;
  allocation.stop(true);
  provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST")
        return Response.json({ data: [{ id: "fixture-context-model" }] });
      await request.json();
      return Response.json({
        id: crypto.randomUUID(),
        model: "fixture-context-model",
        object: "chat.completion",
        created: 1,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "The exact project code is ORCHID-742. Earlier diagnostics are archived; no actions are pending.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 31000, completion_tokens: 1000, total_tokens: 32000 },
      });
    },
  });
  await start();
  await api("/api/setup/complete", {});
  const p = await api("/api/providers", {
    provider: "llamacpp",
    name: "Context fixture",
    base_url: `http://127.0.0.1:${provider.port}/v1`,
  });
  const a = await api("/api/agents", {
    name: "Context fixture",
    model: "fixture-context-model",
    provider_id: p.id,
    memory_enabled: false,
    config: { max_context_tokens: 1_000_000 },
  });
  if (typeof a.id !== "string") throw new Error("Missing fixture agent");
  agentId = a.id;
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `ORCHID-742 diagnostic ${index}. ` + "Benign archived diagnostic. ".repeat(11000),
    timestamp: new Date(1750000000000 + index * 1000).toISOString(),
  }));
  const db = new Database(join(home, ".cybara", "data", "platform.db"));
  db.query("INSERT INTO chat_sessions(id,agent_id,title,messages) VALUES(?,?,?,?)").run(
    sessionId,
    agentId,
    "Context compaction regression",
    JSON.stringify(messages)
  );
  for (const message of messages)
    db.query(
      "INSERT INTO session_messages(id,session_id,agent_id,role,content,created_at) VALUES(?,?,?,?,?,?)"
    ).run(
      crypto.randomUUID(),
      sessionId,
      agentId,
      message.role,
      message.content,
      message.timestamp
    );
  db.close();
  browser = await chromium.launch({
    executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
    headless: true,
  });
  page = await browser.newPage();
  await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
  socket = new WebSocket(`${url.replace("http:", "ws:")}/api/ws/status`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(String(event.data)) as (typeof events)[number];
      if (data.sessionId === sessionId) events.push(data);
    } catch {}
  });
  await new Promise<void>((resolve, reject) => {
    socket?.addEventListener("open", () => resolve(), { once: true });
    socket?.addEventListener("error", () => reject(new Error("Status websocket unavailable")), {
      once: true,
    });
  });
}, 45_000);

afterAll(async () => {
  socket?.close();
  await browser?.close();
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  provider?.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("context compaction through real gateway and rendered meter", () => {
  test("1M context drops to 32k live and survives reload, restart and the next turn while preserving canonical history", async () => {
    if (!page) throw new Error("Fixture UI missing");
    const before = (await api(`/api/sessions/${sessionId}`)) as unknown as Detail;
    expect(before.contextUsage.usedTokens).toBeGreaterThan(1_000_000);
    await page.goto(`${url}/chat?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    const meter = page.locator('button[aria-label^="Active context:"]');
    await meter.waitFor();
    expect(await meter.getAttribute("aria-label")).toContain("100%");
    const result = (await api("/api/chat", {
      agentId,
      sessionId,
      tools: false,
      stream: false,
      message: "State the project code in the previous diagnostics.",
    })) as unknown as Detail;
    expect(result.contextUsage.usedTokens).toBe(32000);
    expect(result.contextUsage.limitTokens).toBe(1_000_000);
    await page.waitForFunction(() =>
      document
        .querySelector('button[aria-label^="Active context:"]')
        ?.getAttribute("aria-label")
        ?.includes("32k")
    );
    const after = (await api(`/api/sessions/${sessionId}`)) as unknown as Detail;
    expect(after.contextUsage.usedTokens).toBe(32000);
    expect(after.contextUsage.compactionCount).toBeGreaterThan(0);
    expect(
      after.messagesList?.filter((message) =>
        message.content.includes("Benign archived diagnostic.")
      ).length
    ).toBe(16);
    expect(events.some((event) => event.status === "compacting")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.contextUsage?.usedTokens === 32000 && event.contextUsage.limitTokens === 1_000_000
      )
    ).toBe(true);
    expect(after.tokenUsage?.totalTokens).toBeGreaterThanOrEqual(32000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await meter.waitFor();
    expect(await meter.getAttribute("aria-label")).toContain("32k");
    if (!gateway) throw new Error("Gateway missing");
    socket?.close();
    gateway.kill();
    await gateway.exited;
    await start();
    const restarted = (await api(`/api/sessions/${sessionId}`)) as unknown as Detail;
    expect(restarted.contextUsage.usedTokens).toBe(32000);
    const next = (await api("/api/chat", {
      agentId,
      sessionId,
      tools: false,
      stream: false,
      message: "Again state the project code.",
    })) as unknown as Detail;
    expect(next.contextUsage.usedTokens).toBe(32000);
    expect(next.contextUsage.source).toBe("provider");
  }, 60_000);
});
