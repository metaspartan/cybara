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

test("rendered steering and agent selection leave an active chat and independent child alive", async () => {
  const home = mkdtempSync(join(tmpdir(), "cybara-live-controls-"));
  const key = "chat-controls-fixture";
  const session = `controls-ui-${crypto.randomUUID()}`;
  const parentGate = Promise.withResolvers<void>(),
    parentStarted = Promise.withResolvers<void>(),
    childGate = Promise.withResolvers<void>(),
    childStarted = Promise.withResolvers<void>();
  let aborted = 0;
  const models: string[] = [];
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST")
        return Response.json({ data: [{ id: "ui-agent-a" }, { id: "ui-agent-b" }] });
      const body = (await request.json()) as WireRequest;
      const users = body.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n");
      if (users.includes("CHILD_MARKER")) {
        request.signal.addEventListener(
          "abort",
          () => {
            aborted += 1;
          },
          { once: true }
        );
        childStarted.resolve();
        await childGate.promise;
      } else {
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
      }
      return Response.json({
        id: crypto.randomUUID(),
        object: "chat.completion",
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: users.includes("CHILD_MARKER") ? "CHILD_DONE" : "NORMAL_COMPLETION",
            },
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
      name: "Live control fixture",
      base_url: `http://127.0.0.1:${provider.port}/v1`,
    });
    const first = await api("/api/agents", {
      name: "Original live fixture",
      model: "ui-agent-a",
      provider_id: p.id,
      memory_enabled: false,
      config: { tool_policy: { allow: ["read"] } },
    });
    const second = await api("/api/agents", {
      name: "Next live fixture",
      model: "ui-agent-b",
      provider_id: p.id,
      memory_enabled: false,
      config: { tool_policy: { allow: ["read"] } },
    });
    active = api("/api/chat", {
      agentId: first.id,
      sessionId: session,
      message: "Discuss the proposal",
      tools: true,
      stream: false,
    });
    await parentStarted.promise;
    const child = await api("/api/subagents/spawn", {
      agentId: first.id,
      requesterSessionId: session,
      task: "Explain CHILD_MARKER",
      runTimeoutSeconds: 30,
    });
    await childStarted.promise;
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
    await page.goto(`${base}/chat?session=${session}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Stop/ }).first().waitFor();
    const queued = await api("/api/chat", {
      agentId: first.id,
      sessionId: session,
      message: "Explain the follow-up",
      tools: true,
      queueMode: "queue",
    });
    expect(queued.queued).toBe(true);
    await page.getByRole("button", { name: "Steer", exact: true }).click();
    await page.getByText("Steering queued", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: /Stop/ }).first().isVisible()).toBe(true);
    const selector = page.getByLabel("Chat agent", { exact: true });
    await selector.selectOption(String(second.id));
    expect(await selector.isDisabled()).toBe(true);
    expect(aborted).toBe(0);
    expect(models).toEqual(["ui-agent-a"]);
    expect(await page.getByRole("button", { name: /Stop/ }).first().isVisible()).toBe(true);
    const running = await api(`/api/subagents/${String(child.subagentId)}`);
    expect(JSON.stringify(running)).not.toContain('"status":"killed"');
    parentGate.resolve();
    const completed = await active;
    expect(completed.interrupted).not.toBe(true);
    expect(completed.stopped).not.toBe(true);
    for (let attempt = 0; attempt < 200 && (await selector.isDisabled()); attempt += 1)
      await Bun.sleep(25);
    expect(await selector.inputValue()).toBe(String(second.id));
    expect(await selector.isDisabled()).toBe(false);
    expect(aborted).toBe(0);
    childGate.resolve();
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const childState = await api(`/api/subagents/${String(child.subagentId)}`);
      if (JSON.stringify(childState).includes("CHILD_DONE")) break;
      await Bun.sleep(25);
    }
    const finalChild = await api(`/api/subagents/${String(child.subagentId)}`);
    expect(JSON.stringify(finalChild)).toContain("CHILD_DONE");
    expect(aborted).toBe(0);
    for (let attempt = 0; attempt < 150 && models.length < 2; attempt += 1) await Bun.sleep(25);
    expect(models.at(-1)).toBe("ui-agent-b");
    expect(errors).toEqual([]);
  } finally {
    parentGate.resolve();
    childGate.resolve();
    await active?.catch(() => undefined);
    await browser?.close();
    gateway.kill();
    await gateway.exited;
    provider.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 45000);
