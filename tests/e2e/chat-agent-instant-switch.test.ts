import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

interface WireRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

test("selecting another agent during a live turn updates the selection immediately and runs the next message on it", async () => {
  const home = mkdtempSync(join(tmpdir(), "cybara-instant-switch-"));
  const key = "instant-switch-fixture";
  const session = `instant-switch-ui-${crypto.randomUUID()}`;
  const parentGate = Promise.withResolvers<void>(),
    parentStarted = Promise.withResolvers<void>();
  const models: string[] = [];
  let aborted = 0;
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST")
        return Response.json({ data: [{ id: "switch-agent-a" }, { id: "switch-agent-b" }] });
      const body = (await request.json()) as WireRequest;
      models.push(body.model);
      if (models.length === 1) {
        request.signal.addEventListener(
          "abort",
          () => {
            aborted += 1;
          },
          { once: true }
        );
        parentStarted.resolve();
        await parentGate.promise;
      }
      return Response.json({
        id: crypto.randomUUID(),
        object: "chat.completion",
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: `REPLY_FROM_${body.model}` },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
  });
  const slot = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const base = `http://127.0.0.1:${slot.port}`;
  slot.stop(true);
  const gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      LOCALAPPDATA: join(home, "Local"),
      CYBARA_HOST: "127.0.0.1",
      PORT: new URL(base).port,
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const api = async (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST"
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = (await response.json()) as Record<string, unknown>;
    if (!response.ok || value.error || value.failure) throw Error(`Fixture ${path} failed`);
    return value;
  };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let active: Promise<Record<string, unknown>> | undefined;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
      headless: true,
    });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    await api("/api/setup/complete", {});
    const p = await api("/api/providers", {
      provider: "llamacpp",
      name: "Instant switch fixture",
      base_url: `http://127.0.0.1:${provider.port}/v1`,
    });
    const first = await api("/api/agents", {
      name: "Running agent",
      model: "switch-agent-a",
      provider_id: p.id,
      memory_enabled: false,
      config: { tool_policy: { allow: ["read"] } },
    });
    const second = await api("/api/agents", {
      name: "Selected agent",
      model: "switch-agent-b",
      provider_id: p.id,
      memory_enabled: false,
      config: { tool_policy: { allow: ["read"] } },
    });
    active = api("/api/chat", {
      agentId: first.id,
      sessionId: session,
      message: "Start the long turn",
      tools: true,
      stream: false,
    });
    await parentStarted.promise;

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
    await page.goto(`${base}/chat?session=${session}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Stop/ }).first().waitFor();

    const selector = page.getByLabel("Chat agent", { exact: true });
    expect(await selector.inputValue()).toBe(String(first.id));

    await selector.selectOption(String(second.id));

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await selector.inputValue()) === String(second.id)) break;
      await Bun.sleep(25);
    }
    expect(await selector.inputValue()).toBe(String(second.id));
    expect(await selector.isDisabled()).toBe(false);
    expect(aborted).toBe(0);
    expect(models).toEqual(["switch-agent-a"]);

    const pending = await api(`/api/sessions/${session}`);
    expect(pending.agent_id).toBe(String(second.id));
    expect(pending.agent_switch_pending).toBe(true);
    expect(pending.use_model_router).toBe(false);

    parentGate.resolve();
    const completed = await active;
    expect(completed.interrupted).not.toBe(true);
    expect(completed.stopped).not.toBe(true);
    expect((completed.agent as { id: string }).id).toBe(String(first.id));
    expect(completed.session_agent_id).toBe(String(second.id));
    expect(aborted).toBe(0);

    for (let attempt = 0; attempt < 200 && (await selector.isDisabled()); attempt += 1)
      await Bun.sleep(25);
    expect(await selector.inputValue()).toBe(String(second.id));
    expect(await selector.isDisabled()).toBe(false);

    const next = await api("/api/chat", {
      sessionId: session,
      message: "Now run on the selected agent",
      tools: true,
      stream: false,
    });
    expect((next.agent as { id: string }).id).toBe(String(second.id));
    for (let attempt = 0; attempt < 200 && models.length < 2; attempt += 1) await Bun.sleep(25);
    expect(models).toEqual(["switch-agent-a", "switch-agent-b"]);

    const settled = await api(`/api/sessions/${session}`);
    expect(settled.agent_id).toBe(String(second.id));
    expect(settled.agent_switch_pending).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    parentGate.resolve();
    await active?.catch(() => undefined);
    await browser?.close();
    gateway.kill();
    await gateway.exited;
    provider.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 60000);
