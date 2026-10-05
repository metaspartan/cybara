import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { getChromium } from "../../src/core/browser/playwright-loader";

interface Patch {
  id: string;
  content: string;
  images?: unknown[];
}

test("queue shows attachment counts and edit mode accepts pasted images", async () => {
  const root = join(import.meta.dir, "../..");
  const temp = mkdtempSync(join(tmpdir(), "cybara-queue-images-"));
  const entry = join(root, "ui", `.queue-image-fixture-${crypto.randomUUID()}.tsx`);
  const patches: Patch[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/patch") {
        patches.push((await request.json()) as Patch);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json" },
        });
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

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await Bun.write(
      entry,
      `import{createRoot}from"react-dom/client";import{useState}from"react";import{PendingChatQueue}from"./src/pages/chat/ChatFollowUpControls";function Fixture(){const[messages,setMessages]=useState([{id:"p1",sessionId:"s1",content:"plain follow-up",createdAt:1,updatedAt:1,mode:"queued",sequence:1},{id:"p2",sessionId:"s1",content:"follow-up with a picture",createdAt:2,updatedAt:2,mode:"queued",sequence:2,imageCount:2}]);return <><PendingChatQueue messages={messages} onSteer={()=>undefined} onReorder={()=>undefined} onDelete={()=>undefined} onUpdate={async(id,content,images)=>{await fetch("/patch",{method:"POST",body:JSON.stringify({id,content,...(images?{images}:{})})});setMessages(current=>current.map(m=>m.id===id?{...m,content,...(images?{imageCount:images.length}:{})}:m));}} steeringMessageId={null} mutatingMessageId={null}/></>}const target=document.getElementById("root");if(target)createRoot(target).render(<Fixture/>);`
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
    await page.goto(`http://127.0.0.1:${server.port}/`);

    const rows = page.getByTestId("pending-chat-message");
    await rows.first().waitFor();
    expect(await rows.count()).toBe(2);

    const chip = page.getByTestId("pending-chat-attachments");
    expect(await chip.count()).toBe(1);
    const visibleCount = await chip.evaluate((node) =>
      Array.from(node.childNodes)
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent?.trim() ?? "")
        .filter(Boolean)
        .join("")
    );
    expect(visibleCount).toBe("2");
    expect(await chip.getAttribute("title")).toBe(
      "2 image attachments will be sent with this message"
    );

    await rows.first().getByRole("button", { name: "Edit queued message" }).click();
    const editor = page.getByLabel("Edit queued message text");
    await editor.fill("edited follow-up");
    await editor.press("Enter");
    await page.waitForFunction(
      () => (window as { __patches?: number }).__patches !== undefined || true
    );
    for (let attempt = 0; attempt < 200 && patches.length < 1; attempt += 1) await Bun.sleep(10);
    expect(patches.at(-1)).toMatchObject({ id: "p1", content: "edited follow-up" });
    expect(patches.at(-1)?.images).toBeUndefined();

    await rows.nth(1).getByRole("button", { name: "Edit queued message" }).click();
    const imageEditor = page.getByLabel("Edit queued message text");
    await imageEditor.focus();
    await imageEditor.evaluate((node) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        (character) => character.charCodeAt(0)
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      node.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
      );
    });
    await page.getByTestId("pending-edit-attachments").waitFor({ timeout: 10_000 });
    expect(await page.getByTestId("pending-edit-attachments").locator("button").count()).toBe(1);

    await page.getByRole("button", { name: "Remove attachment 1" }).click();
    expect(await page.getByText("Attachments removed").count()).toBe(1);
    await imageEditor.press("Enter");
    for (let attempt = 0; attempt < 200 && patches.length < 2; attempt += 1) await Bun.sleep(10);
    expect(patches.at(-1)).toMatchObject({ id: "p2", images: [] });

    await rows.nth(1).getByRole("button", { name: "Edit queued message" }).click();
    const again = page.getByLabel("Edit queued message text");
    await again.focus();
    await again.evaluate((node) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        ),
        (character) => character.charCodeAt(0)
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "second.png", { type: "image/png" }));
      node.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
      );
    });
    await page.getByTestId("pending-edit-attachments").waitFor({ timeout: 10_000 });
    await again.press("Enter");
    for (let attempt = 0; attempt < 200 && patches.length < 3; attempt += 1) await Bun.sleep(10);
    expect(patches.at(-1)?.images).toHaveLength(1);

    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.stop(true);
    rmSync(entry, { force: true });
    rmSync(temp, { recursive: true, force: true });
  }
}, 45_000);
