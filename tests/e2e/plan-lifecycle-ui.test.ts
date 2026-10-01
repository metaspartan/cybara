import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

interface Plan {
  revision: number;
  lifecycle: string;
  items: Array<{ content: string; status: string; priority: string }>;
}
interface WireRequest {
  messages: Array<{ role: string; content: string }>;
}
let home = "";
let base = "";
let gateway: ReturnType<typeof Bun.spawn> | undefined;
let provider: ReturnType<typeof Bun.serve> | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let agentId = "";
const key = "plan-ui-fixture-key";
const sessionId = `plan-ui-${crypto.randomUUID()}`;
const calls = new Map<string, number>();
const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const errors: string[] = [];
const initial = [
  { content: "Inspect fixture", status: "in_progress", priority: "high" },
  { content: "Verify output", status: "pending", priority: "high" },
];

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok || value.error || value.failure) throw new Error(`Plan fixture ${path} failed`);
  return value;
}
async function plan(): Promise<Plan> {
  return (await api(`/api/sessions/${sessionId}/plan`)).plan as Plan;
}
async function startGateway(): Promise<void> {
  gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CONFIG_DIR: join(home, ".cybara"),
      CYBARA_HOME: join(home, ".cybara"),
      LOCALAPPDATA: join(home, "Local"),
      CYBARA_HOST: "127.0.0.1",
      PORT: new URL(base).port,
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Plan fixture gateway unavailable");
}
function completion(items?: unknown): Response {
  const message =
    items === undefined
      ? { role: "assistant", content: "Fixture turn ended." }
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: crypto.randomUUID(),
              type: "function",
              function: { name: "todo", arguments: JSON.stringify({ items }) },
            },
          ],
        };
  return Response.json({
    id: crypto.randomUUID(),
    object: "chat.completion",
    model: "plan-fixture",
    choices: [{ index: 0, message, finish_reason: items === undefined ? "stop" : "tool_calls" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  });
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "cybara-plan-ui-"));
  const port = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  base = `http://127.0.0.1:${port.port}`;
  port.stop(true);
  provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return Response.json({ data: [{ id: "plan-fixture" }] });
      const body = (await request.json()) as WireRequest;
      const marker =
        [...body.messages]
          .reverse()
          .find(
            (message) =>
              message.role === "user" &&
              /PLAN_(SUCCESS|UNFINISHED|STOP|CLEAR|RECOVER|FAIL)/.test(message.content)
          )
          ?.content.match(/PLAN_(SUCCESS|UNFINISHED|STOP|CLEAR|RECOVER|FAIL)/)?.[0] ?? "unknown";
      const call = (calls.get(marker) ?? 0) + 1;
      calls.set(marker, call);
      if (call === 1)
        return completion(
          marker === "PLAN_CLEAR"
            ? initial.map((item) => ({ ...item, status: "cancelled" }))
            : initial
        );
      if (
        (marker === "PLAN_SUCCESS" || marker === "PLAN_STOP" || marker === "PLAN_RECOVER") &&
        call === 2
      ) {
        const gate = gates.get(marker) ?? Promise.withResolvers<void>();
        gates.set(marker, gate);
        await gate.promise;
      }
      if (marker === "PLAN_SUCCESS" && call === 2)
        return completion(
          initial.map((item, index) => ({
            ...item,
            status: index === 0 ? "completed" : "cancelled",
          }))
        );
      if (marker === "PLAN_CLEAR" && call === 2) return completion([]);
      if (marker === "PLAN_FAIL")
        return Response.json(
          {
            error: { message: "Fixture provider rejected the turn", type: "invalid_request_error" },
          },
          { status: 400 }
        );
      return completion();
    },
  });
  await startGateway();
  await api("/api/setup/complete", {});
  const providerRecord = await api("/api/providers", {
    name: "Plan UI fixture",
    provider: "llamacpp",
    base_url: `http://127.0.0.1:${provider.port}/v1`,
  });
  const agent = await api("/api/agents", {
    name: "Plan UI fixture",
    model: "plan-fixture",
    provider_id: providerRecord.id,
    memory_enabled: false,
    config: { tool_policy: { allow: ["todo"] } },
  });
  agentId = String(agent.id);
  browser = await chromium.launch({
    executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
  page.on("pageerror", (error) => errors.push(error.message));
}, 35_000);

afterAll(async () => {
  for (const gate of gates.values()) gate.resolve();
  await browser?.close();
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  provider?.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

async function ensureOverview(target: Page): Promise<void> {
  await target.getByRole("button", { name: "Environment overview", exact: true }).waitFor();
  if (!(await target.getByText("Session overview", { exact: true }).isVisible()))
    await target.getByRole("button", { name: "Environment overview", exact: true }).click();
}

async function overview(): Promise<Page> {
  if (!page) throw new Error("UI unavailable");
  await page.goto(`${base}/chat?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await ensureOverview(page);
  await page
    .getByTestId("chat-plan-card")
    .getByText("Latest plan update", { exact: true })
    .waitFor({ timeout: 7000 });
  return page;
}

async function waitPlan(lifecycle: string): Promise<Plan> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const value = await plan();
      if (value?.lifecycle === lifecycle) return value;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Plan never reached ${lifecycle}`);
}

test("live authoritative updates settle cancelled tasks and survive reload without waiting for transcript finalization", async () => {
  const turn = api("/api/chat", {
    agentId,
    sessionId,
    message: "PLAN_SUCCESS create and execute this plan",
    tools: true,
    stream: false,
  });
  try {
    const active = await waitPlan("active");
    const target = await overview();
    await target.locator('[data-testid="chat-plan-card"][data-plan-lifecycle="active"]').waitFor();
    expect(
      await target.locator('[data-testid="chat-plan-card"]').getAttribute("data-plan-revision")
    ).toBe(String(active.revision));
    expect(await target.getByText("0/2 complete", { exact: true }).count()).toBeGreaterThan(0);
    for (let attempt = 0; attempt < 100 && !gates.has("PLAN_SUCCESS"); attempt += 1)
      await Bun.sleep(20);
    gates.get("PLAN_SUCCESS")?.resolve();
    await turn;
    await target
      .locator('[data-testid="chat-plan-card"][data-plan-lifecycle="completed"]')
      .waitFor();
    expect(await target.locator('[data-testid="chat-plan-card"]').innerText()).toContain(
      "1/1 complete"
    );
    expect((await plan()).items.map((item) => item.status)).toEqual(["completed", "cancelled"]);
    await target.reload();
    await ensureOverview(target);
    await target
      .locator('[data-testid="chat-plan-card"][data-plan-lifecycle="completed"]')
      .waitFor();
  } finally {
    gates.get("PLAN_SUCCESS")?.resolve();
    await turn.catch(() => undefined);
  }
}, 30_000);

test("unfinished final responses are labeled needs-update rather than left apparently active after reload and restart", async () => {
  await api("/api/chat", {
    agentId,
    sessionId,
    message: "PLAN_UNFINISHED create the plan then end",
    tools: true,
    stream: false,
  });
  const snapshot = await waitPlan("needs_update");
  const target = await overview();
  await target
    .locator('[data-testid="chat-plan-card"][data-plan-lifecycle="needs_update"]')
    .waitFor({ timeout: 7000 });
  expect(await target.locator('[data-testid="chat-plan-card"]').innerText()).toContain(
    "Turn ended"
  );
  expect(snapshot.items.some((item) => item.status === "in_progress")).toBe(true);
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  await startGateway();
  const recovered = await plan();
  expect(recovered.revision).toBe(snapshot.revision);
  await target.reload();
  await ensureOverview(target);
  await target
    .locator('[data-testid="chat-plan-card"][data-plan-lifecycle="needs_update"]')
    .waitFor({ timeout: 7000 });
}, 30_000);

test("provider failures leave unfinished plans paused rather than apparently working", async () => {
  await api("/api/chat", {
    agentId,
    sessionId,
    message: "PLAN_FAIL create the plan then fail",
    tools: true,
    stream: false,
  }).catch(() => undefined);
  const failed = await waitPlan("paused");
  const target = await overview();
  await target.locator('[data-testid="chat-plan-card"][data-plan-lifecycle="paused"]').waitFor();
  expect(failed.items.some((item) => item.status === "in_progress")).toBe(true);
  expect(await target.getByTestId("chat-plan-outcome").innerText()).toContain("Paused");
}, 20000);
test("a mounted plan reconciles an interrupted gateway restart without a browser reload", async () => {
  const turn = api("/api/chat", {
    agentId,
    sessionId,
    message: "PLAN_RECOVER start the plan",
    tools: true,
    stream: false,
  }).catch(() => undefined);
  const active = await waitPlan("active");
  const target = await overview();
  await target.locator('[data-testid="chat-plan-card"][data-plan-lifecycle="active"]').waitFor();
  if (gateway) {
    gateway.kill();
    await gateway.exited;
  }
  gates.get("PLAN_RECOVER")?.resolve();
  await turn;
  await startGateway();
  const recovered = await waitPlan("paused");
  expect(recovered.revision).toBe(active.revision + 1);
  await target
    .locator('[data-testid="chat-plan-card"][data-plan-lifecycle="paused"]')
    .waitFor({ timeout: 20000 });
  expect(await target.getByTestId("chat-plan-card").getAttribute("data-plan-revision")).toBe(
    String(recovered.revision)
  );
  expect(recovered.items.map((item) => item.status)).toEqual(
    active.items.map((item) => item.status)
  );
}, 35000);
test("stopping a chat labels the retained plan paused and explicit clearing never resurrects old work", async () => {
  const turn = api("/api/chat", {
    agentId,
    sessionId,
    message: "PLAN_STOP start the plan",
    tools: true,
    stream: false,
  });
  try {
    await waitPlan("active");
    const target = await overview();
    await target.getByRole("button", { name: /Stop/ }).first().click();
    await waitPlan("paused");
    gates.get("PLAN_STOP")?.resolve();
    await turn;
    await target.locator('[data-testid="chat-plan-card"][data-plan-lifecycle="paused"]').waitFor();
    expect(await target.locator('[data-testid="chat-plan-card"]').innerText()).toContain("Paused");
    for (const width of [1280, 390]) {
      await target.setViewportSize({ width, height: 900 });
      const dimensions = await target.getByTestId("chat-plan-card").evaluate((card) => ({
        width: card.clientWidth,
        scroll: card.scrollWidth,
        title: (card.querySelector('[data-testid="chat-plan-title"]') as HTMLElement)?.scrollWidth,
        titleWidth: (card.querySelector('[data-testid="chat-plan-title"]') as HTMLElement)
          ?.clientWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
      expect(dimensions.title).toBeLessThanOrEqual(dimensions.titleWidth);
      expect(await target.getByTestId("chat-plan-outcome").innerText()).toContain("Paused");
    }
    await target.setViewportSize({ width: 1280, height: 900 });
    await api("/api/chat", {
      agentId,
      sessionId,
      message: "PLAN_CLEAR cancel then clear this plan",
      tools: true,
      stream: false,
    });
    expect((await waitPlan("cleared")).items).toEqual([]);
    await target.locator('[data-testid="chat-plan-card"][data-plan-lifecycle="cleared"]').waitFor();
    expect(await target.locator('[data-testid="chat-plan-card"]').innerText()).toContain(
      "Plan cleared"
    );
    expect(errors).toEqual([]);
  } finally {
    gates.get("PLAN_STOP")?.resolve();
    await turn.catch(() => undefined);
  }
}, 30_000);
