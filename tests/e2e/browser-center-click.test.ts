import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = "browser-center-click-e2e-key";
let home = "";
let baseUrl = "";
let gateway: ReturnType<typeof Bun.spawn> | undefined;

async function api(
  path: string,
  body?: unknown,
  timeoutMs = 30_000
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await response.json()) as Record<string, unknown>;
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error("gateway did not become ready");
}

let started = false;

async function ensureStarted(): Promise<void> {
  if (started) return;
  started = true;
  home = mkdtempSync(join(tmpdir(), "cybara-center-click-"));
  const probe = join(home, "probe.html");
  await Bun.write(
    probe,
    `<!DOCTYPE html><title>Button probe</title>
<body style="margin:0">
<div id="log" style="white-space:pre">none</div>
<script>
window.__events = [];
const record = (name) => { window.__events.push(name); document.getElementById("log").textContent = window.__events.join(","); };
for (const type of ["mousedown","mouseup","click","auxclick","contextmenu"]) {
  document.addEventListener(type, (event) => record(type + ":" + event.button), true);
}
</script>
</body>`
  );
  const html = await Bun.file(probe).text();
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  const fixtureUrl = `http://127.0.0.1:${fixture.port}`;
  const allocation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  baseUrl = `http://127.0.0.1:${allocation.port}`;
  allocation.stop(true);
  gateway = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      CYBARA_API_KEY: key,
      HOME: home,
      USERPROFILE: home,
      CYBARA_HOME: join(home, ".cybara"),
      CONFIG_DIR: join(home, ".cybara"),
      PORT: String(new URL(baseUrl).port),
      BROWSER_HEADLESS: "true",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForReady();
  const open = await api("/api/browser/tabs", {}, 180_000);
  const data = (open.data ?? {}) as { id?: string };
  if (!data.id) throw new Error(`no tab: ${JSON.stringify(open)}`);
  tabId = data.id;
  await api(`/api/browser/tabs/${tabId}/navigate`, { url: `${fixtureUrl}/` }, 60_000);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = JSON.stringify(await api(`/api/browser/tabs/${tabId}/state`));
    if (state.includes(fixtureUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("fixture page never loaded");
}

afterAll(() => {
  if (gateway) {
    try {
      gateway.kill("SIGTERM");
    } catch {
      void 0;
    }
  }
  rmSync(home, { recursive: true, force: true });
});

let tabId = "";

describe("center click reaches the real embedded page", () => {
  test("a middle click is delivered as a middle button, not a left click", async () => {
    await ensureStarted();
    const before = await api(`/api/browser/tabs/${tabId}/snapshot`);
    expect(JSON.stringify(before)).toContain("none");

    await api(`/api/browser/tabs/${tabId}/pointer/down`, { x: 40, y: 40, button: 1 });
    await api(`/api/browser/tabs/${tabId}/pointer/up`, { x: 40, y: 40, button: 1 });

    const snapshot = JSON.stringify(await api(`/api/browser/tabs/${tabId}/snapshot`));
    expect(snapshot).toContain("mousedown:1");
    expect(snapshot).toContain("mouseup:1");
    expect(snapshot).not.toContain("mousedown:0");
    if (process.env.CYBARA_CENTER_CLICK_SCREENSHOT) {
      const shot = await api(`/api/browser/tabs/${tabId}/screenshot`);
      const encoded = (shot.data as { screenshot?: string } | undefined)?.screenshot ?? "";
      expect(encoded.length).toBeGreaterThan(0);
      await Bun.write(process.env.CYBARA_CENTER_CLICK_SCREENSHOT, Buffer.from(encoded, "base64"));
    }
  }, 90_000);

  test("a right click is delivered as a right button", async () => {
    await ensureStarted();
    await api(`/api/browser/tabs/${tabId}/pointer/click`, { x: 60, y: 40, button: 2 });
    const snapshot = JSON.stringify(await api(`/api/browser/tabs/${tabId}/snapshot`));
    expect(snapshot).toContain("click:2");
  }, 60_000);

  test("a left click still works and the route defaults to left when omitted", async () => {
    await ensureStarted();
    await api(`/api/browser/tabs/${tabId}/pointer/click`, { x: 80, y: 40 });
    const snapshot = JSON.stringify(await api(`/api/browser/tabs/${tabId}/snapshot`));
    expect(snapshot).toContain("click:0");
  }, 60_000);

  test("local Chrome is reported as not reachable when no debugger listens", async () => {
    await ensureStarted();
    const status = await api("/api/browser/local-chrome");
    expect(status.success).toBe(true);
    const state = status.status as { reachable: boolean; attached: boolean; port: number };
    expect(state.attached).toBe(false);
    expect(state.reachable).toBe(false);
    expect(state.port).toBe(9222);
  }, 90_000);

  test("attaching without a debugger fails closed instead of pretending", async () => {
    await ensureStarted();
    const result = await api("/api/browser/local-chrome/attach", { port: 1 });
    expect(result.success).toBe(false);
    const message = String(result.error);
    expect(
      message.includes("--remote-debugging-port") || message.includes("not owned locally")
    ).toBe(true);
    const after = (await api("/api/browser/local-chrome")).status as { attached: boolean };
    expect(after.attached).toBe(false);
  }, 90_000);
});
