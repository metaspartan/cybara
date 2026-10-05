import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

test("real notice stays compact and clears on stop, null status, session changes and idle", async () => {
  const root = join(import.meta.dir, "../..");
  const temp = mkdtempSync(join(tmpdir(), "cybara-notice-ui-"));
  const entry = join(root, "ui", `.notice-fixture-${crypto.randomUUID()}.tsx`);
  let current: Record<string, unknown> | null = {
    sessionId: "one",
    app: "Fixture app",
    startedAt: 1,
    lastActionAt: Date.now(),
    yieldedToUser: false,
    reason: null,
  };
  let hold = false;
  let unavailable = false;
  let polls = 0;
  const delayed = Promise.withResolvers<void>();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/computer-use/active") {
        polls += 1;
        if (unavailable) return Response.json({ error: "fixture unavailable" }, { status: 500 });
        const snapshot = current;
        if (hold) await delayed.promise;
        return Response.json({ success: true, data: snapshot });
      }
      if (path === "/bundle.js")
        return new Response(Bun.file(join(temp, "bundle.js")), {
          headers: { "Content-Type": "text/javascript" },
        });
      if (path === "/styles.css") {
        const glob = new Bun.Glob("index-*.css");
        for await (const file of glob.scan({ cwd: join(root, "ui/dist/assets") }))
          return new Response(Bun.file(join(root, "ui/dist/assets", file)), {
            headers: { "Content-Type": "text/css" },
          });
        return new Response("");
      }
      return new Response(
        '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>',
        { headers: { "Content-Type": "text/html" } }
      );
    },
  });
  try {
    await Bun.write(
      entry,
      `import{createRoot}from"react-dom/client";import{useState}from"react";import{ComputerUseTakeoverOverlay}from"./src/pages/chat/ComputerUseTakeoverOverlay";function Fixture(){const[active,setActive]=useState(true);const[session,setSession]=useState("one");const[run,setRun]=useState(1);const[stops,setStops]=useState(0);const[stopping,setStopping]=useState(false);const[clicks,setClicks]=useState(0);return <><button onClick={()=>setActive(false)}>Set idle</button><button onClick={()=>{setActive(true);setRun(r=>r+1)}}>New run</button><button onClick={()=>setSession(s=>s==="one"?"two":"one")}>Switch session</button><button onClick={()=>setClicks(c=>c+1)}>Unrelated action</button><button onClick={()=>setStopping(true)}>External stop</button><button onClick={()=>setStopping(false)}>Stop acknowledged</button><input aria-label="Underlying input"/><p>stops:{stops} clicks:{clicks}</p><ComputerUseTakeoverOverlay sessionId={session} active={active} stopping={stopping} runId={String(run)} onStop={()=>setStops(s=>s+1)}/></>}const target=document.getElementById("root");if(target)createRoot(target).render(<Fixture/>);`
    );
    const build = await Bun.build({
      entrypoints: [entry],
      outdir: temp,
      naming: "bundle.js",
      target: "browser",
      tsconfig: join(root, "ui/tsconfig.json"),
    });
    if (!build.success) throw Error(build.logs.map((log) => log.message).join("\n"));
    browser = await chromium.launch({
      executablePath: process.env.CYBARA_BROWSER_PATH ?? (await getChromium()).executablePath(),
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem("cybara_api_key", "notice-fixture"));
    await page.goto(`http://127.0.0.1:${server.port}/`);
    const notice = page.getByTestId("computer-use-takeover-surface");
    await notice.waitFor();
    if (process.env.CYBARA_NOTICE_SCREENSHOT)
      await page.screenshot({ path: process.env.CYBARA_NOTICE_SCREENSHOT });
    expect(await notice.getAttribute("aria-modal")).toBeNull();
    expect(await page.getByRole("dialog").count()).toBe(0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await notice.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(384);
      expect(box?.height ?? 0).toBeLessThan(150);
      expect((box?.width ?? 0) * (box?.height ?? 0)).toBeLessThan((width * 900) / 3);
      await page.getByRole("button", { name: "Unrelated action", exact: true }).click();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const handle = page.getByTestId("computer-use-drag-handle");
    const initialBox = await notice.boundingBox();
    const handleBox = await handle.boundingBox();
    if (!initialBox || !handleBox) throw new Error("notice and handle must be visible");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 - 420, handleBox.y + 220, { steps: 8 });
    await page.mouse.up();
    const draggedBox = await notice.boundingBox();
    if (!draggedBox) throw new Error("dragged notice must remain visible");
    expect(draggedBox.x).toBeLessThan(initialBox.x - 200);
    expect(draggedBox.y).toBeGreaterThan(initialBox.y + 100);
    expect(draggedBox.x).toBeGreaterThanOrEqual(0);
    expect(draggedBox.y).toBeGreaterThanOrEqual(0);
    expect(draggedBox.x + draggedBox.width).toBeLessThanOrEqual(1280);
    expect(draggedBox.y + draggedBox.height).toBeLessThanOrEqual(900);
    const stored = await page.evaluate(() =>
      globalThis.localStorage.getItem("cybara:computer-use-notice-position")
    );
    expect(stored).toContain('"x"');
    const beforeKeyboard = (await notice.boundingBox())?.x ?? 0;
    await handle.focus();
    await handle.press("ArrowRight");
    await handle.press("ArrowRight");
    const afterKeyboard = (await notice.boundingBox())?.x ?? 0;
    expect(afterKeyboard).toBeGreaterThan(beforeKeyboard);
    await handle.dblclick();
    await page.waitForTimeout(60);
    const resetBox = await notice.boundingBox();
    expect(Math.abs((resetBox?.x ?? 0) - initialBox.x)).toBeLessThan(4);
    await page.setViewportSize({ width: 700, height: 420 });
    await page.waitForTimeout(80);
    const shrunkBox = await notice.boundingBox();
    expect((shrunkBox?.x ?? 0) + (shrunkBox?.width ?? 0)).toBeLessThanOrEqual(700);
    expect((shrunkBox?.y ?? 0) + (shrunkBox?.height ?? 0)).toBeLessThanOrEqual(420);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Underlying input").fill("usable");
    await page.getByLabel("Underlying input").press("Escape");
    expect(await notice.isVisible()).toBe(true);
    await page.getByRole("button", { name: "Dismiss computer use notice" }).click();
    expect(await notice.count()).toBe(0);
    expect(await page.getByText("stops:0 clicks:2", { exact: true }).count()).toBe(1);
    const dismissedPolls = polls;
    await page.waitForTimeout(1100);
    expect(polls).toBe(dismissedPolls);
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await notice.waitFor();
    hold = true;
    const beforeHeldPoll = polls;
    for (let attempt = 0; attempt < 60 && polls === beforeHeldPoll; attempt += 1)
      await page.waitForTimeout(25);
    expect(polls).toBe(beforeHeldPoll + 1);
    await page.waitForTimeout(1100);
    expect(polls).toBe(beforeHeldPoll + 1);
    await page.getByRole("button", { name: "Stop computer use", exact: true }).click();
    expect(await notice.count()).toBe(0);
    expect(await page.getByText("stops:1 clicks:2", { exact: true }).count()).toBe(1);
    delayed.resolve();
    hold = false;
    await page.waitForTimeout(1100);
    expect(await notice.count()).toBe(0);
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await notice.waitFor();
    unavailable = true;
    await notice.waitFor({ state: "detached", timeout: 2200 });
    unavailable = false;
    await notice.waitFor();
    current = null;
    await notice.waitFor({ state: "detached", timeout: 2200 });
    current = {
      sessionId: "one",
      app: "Fixture app",
      startedAt: 1,
      lastActionAt: Date.now(),
      yieldedToUser: false,
      reason: null,
    };
    await notice.waitFor();
    await page.getByRole("button", { name: "Switch session", exact: true }).click();
    await notice.waitFor({ state: "detached" });
    await page.waitForTimeout(1100);
    expect(await notice.count()).toBe(0);
    current = { ...current, sessionId: "two" };
    await notice.waitFor();
    await page.getByRole("button", { name: "Set idle", exact: true }).click();
    expect(await notice.count()).toBe(0);
    await page.waitForTimeout(1100);
    expect(await notice.count()).toBe(0);
    await page.getByRole("button", { name: "New run", exact: true }).click();
    await notice.waitFor();
    await page.getByRole("button", { name: "External stop", exact: true }).click();
    expect(await notice.count()).toBe(0);
    await page.getByRole("button", { name: "Stop acknowledged", exact: true }).click();
    await page.waitForTimeout(1100);
    expect(await notice.count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    delayed.resolve();
    await browser?.close();
    server.stop(true);
    rmSync(entry, { force: true });
    rmSync(temp, { recursive: true, force: true });
  }
}, 30000);
