import { afterAll, describe, expect, test } from "bun:test";
import {
  automationDriverForPlatform,
  launchPuppeteerBrowser,
  type AutomationBrowser,
} from "../../src/core/browser/automation-driver";
import { findBundledBrowserExecutable } from "../../src/core/browser/browser-executable";
import { getChromium } from "../../src/core/browser/playwright-loader";

let browser: AutomationBrowser | null = null;

afterAll(async () => {
  await browser?.close();
});

describe("browser automation driver", () => {
  test("uses Puppeteer only on Windows", () => {
    expect(automationDriverForPlatform("win32")).toBe("puppeteer");
    expect(automationDriverForPlatform("darwin")).toBe("playwright");
    expect(automationDriverForPlatform("linux")).toBe("playwright");
  });

  test("Puppeteer transport preserves the browser preview contract", async () => {
    const chromium = await getChromium();
    const executablePath = findBundledBrowserExecutable(chromium);
    if (!executablePath) return;

    browser = await launchPuppeteerBrowser({
      executablePath,
      headless: true,
      args: [],
      timeout: 15_000,
    });
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const html =
      "<title>Cybara</title><input id='name' value='replace me'><button id='save'>Save</button><output id='result'></output><script>document.querySelector('#save').onclick=()=>document.querySelector('#result').textContent=document.querySelector('#name').value</script>";
    await page.goto(`data:text/html,${encodeURIComponent(html)}`, {
      waitUntil: "load",
      timeout: 10_000,
    });

    await page.locator("#name").fill("browser preview");
    await page.locator("#save").click();
    expect(
      await page.evaluate<string>(
        "document.querySelector('#name') instanceof HTMLInputElement ? document.querySelector('#name').value : ''"
      )
    ).toBe("browser preview");
    expect(await page.locator("#result").innerText()).toBe("browser preview");
    expect(await page.locator("button").filter({ hasText: "Save" }).count()).toBe(1);
    expect(await page.title()).toBe("Cybara");
    await page.setViewportSize({ width: 1024, height: 700 });
    expect(page.viewportSize()).toEqual({ width: 1024, height: 700 });
    await page.waitForSelector("#result", { timeout: 1000, state: "visible" });
    expect((await page.screenshot({ fullPage: false, type: "png" })).length).toBeGreaterThan(100);

    await context.close();
  }, 30_000);
});
