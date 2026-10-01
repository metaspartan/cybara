import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

test("agent settings save, reload and remove fused execution without weakening its tool policy", async () => {
  const home = mkdtempSync(join(tmpdir(), "cybara-agent-fusion-ui-"));
  const key = "fusion-ui-fixture-key";
  const slot = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const base = `http://127.0.0.1:${slot.port}`;
  slot.stop(true);
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      Response.json({ data: [{ id: "fixture-model", object: "model", owned_by: "fixture" }] }),
  });
  const gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      LOCALAPPDATA: join(home, "Local"),
      PORT: new URL(base).port,
      CYBARA_HOST: "127.0.0.1",
      CYBARA_API_KEY: key,
      NODE_ENV: "test",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const api = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok || result.error) throw new Error(`Fusion fixture ${path} failed`);
    return result;
  };
  const browser = await chromium.launch({
    executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
    headless: true,
  });
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    await api("/api/setup/complete", {});
    const p = await api("/api/providers", {
      name: "Fusion UI fixture",
      provider: "llamacpp",
      base_url: `http://127.0.0.1:${provider.port}/v1`,
    });
    const agent = await api("/api/agents", {
      name: "Fused mode settings fixture",
      model: "fixture-model",
      provider_id: p.id,
      memory_enabled: false,
      config: {
        tool_profile: "coding",
        tool_policy: { allow: ["read", "write", "execute_code"], deny: ["exec"] },
        model_params: { reasoning_effort: "high" },
      },
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((token) => sessionStorage.setItem("cybara_api_key", token), key);
    await page.goto(base + "/agents", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByLabel("Tool Execution").selectOption("fused");
    expect(await page.getByText(/not a security sandbox/).isVisible()).toBe(true);
    const update = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/agents/${String(agent.id)}`) &&
        response.request().method() === "PUT"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await update).ok()).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    expect(await page.getByLabel("Tool Execution").inputValue()).toBe("fused");
    const saved = await api(`/api/agents/${String(agent.id)}`);
    const config =
      typeof saved.config === "string"
        ? (JSON.parse(saved.config) as Record<string, unknown>)
        : (saved.config as Record<string, unknown>);
    expect(config.tool_policy).toEqual({
      allow: ["read", "write", "execute_code"],
      deny: ["exec"],
    });
    expect(config.model_params).toEqual({ reasoning_effort: "high" });
    await page.getByLabel("Tool Execution").selectOption("direct");
    const restore = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/agents/${String(agent.id)}`) &&
        response.request().method() === "PUT"
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await restore).ok()).toBe(true);
    const restored = await api(`/api/agents/${String(agent.id)}`);
    const restoredConfig =
      typeof restored.config === "string"
        ? (JSON.parse(restored.config) as Record<string, unknown>)
        : (restored.config as Record<string, unknown>);
    expect(restoredConfig.tool_execution_mode).toBeUndefined();
    expect(restoredConfig.tool_policy).toEqual(config.tool_policy);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    gateway.kill();
    await gateway.exited;
    provider.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}, 40_000);
