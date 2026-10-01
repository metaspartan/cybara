import { describe, expect, test } from "bun:test";
import { findBundledBrowserExecutable } from "../../src/core/browser/browser-executable";
import { getChromium } from "../../src/core/browser/playwright-loader";
import { launchPuppeteerBrowser } from "../../src/core/browser/automation-driver";
import { fillImportedLoginOnPage } from "../../src/core/browser/import-service";
import { parseBrowserImportFile } from "../../src/core/browser/import-parsers";

const LOGIN_PAGE =
  '<form method="post"><input autocomplete="username" name="username"><input type="password" name="password"><button>Sign in</button></form>';

describe("imported credentials in a real embedded browser transport", () => {
  test("applies cookies to requests and fills only an exact-origin visible form", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/cookie")
          return new Response(request.headers.get("cookie") ?? "none");
        return new Response(LOGIN_PAGE, { headers: { "Content-Type": "text/html" } });
      },
    });
    const browser = await launchPuppeteerBrowser({
      executablePath:
        process.env.CYBARA_BROWSER_PATH ??
        findBundledBrowserExecutable() ??
        (await getChromium()).executablePath(),
      headless: true,
      args: ["--no-sandbox"],
      timeout: 20_000,
    });
    const origin = `http://127.0.0.1:${server.port}`;
    try {
      const context = await browser.newContext({
        viewport: { width: 800, height: 600 },
        acceptDownloads: false,
      });
      const page = await context.newPage();
      const cookies = parseBrowserImportFile(
        "cookies",
        JSON.stringify([
          {
            name: "imported",
            value: "session-fixture",
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
          },
        ])
      ).cookies;
      await context.addCookies(cookies);
      await page.goto(`${origin}/cookie`, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForSelector("body", { timeout: 5000 });
      expect(await page.textContent("body")).toBe("imported=session-fixture");
      await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForSelector("input[type=password]", { timeout: 5000, state: "visible" });
      const data = parseBrowserImportFile(
        "passwords",
        `url,username,password\n${origin}/login,alice,password-fixture\n`
      );
      const login = data.passwords[0];
      if (!login) throw new Error("Missing login fixture");
      await fillImportedLoginOnPage(page, login);
      expect(
        await page.evaluate<string>('document.querySelector("input[name=username]").value')
      ).toBe("alice");
      expect(
        await page.evaluate<string>('document.querySelector("input[type=password]").value')
      ).toBe("password-fixture");
      expect(page.url()).toBe(`${origin}/login`);
      await page.evaluate<void>(
        'document.querySelector("form").action = "https://other.test/login"; document.querySelector("input[type=password]").value = ""'
      );
      await expect(fillImportedLoginOnPage(page, login)).rejects.toThrow("Nothing was filled");
      expect(
        await page.evaluate<string>('document.querySelector("input[type=password]").value')
      ).toBe("");
      await context.close();
      const second = await browser.newContext({
        viewport: { width: 800, height: 600 },
        acceptDownloads: false,
      });
      const secondPage = await second.newPage();
      await second.addCookies(cookies);
      await secondPage.goto(`${origin}/cookie`, { waitUntil: "domcontentloaded", timeout: 5000 });
      await secondPage.waitForSelector("body", { timeout: 5000 });
      expect(await secondPage.textContent("body")).toBe("imported=session-fixture");
      await second.close();
    } finally {
      await browser.close();
      server.stop(true);
    }
  }, 30_000);
});
