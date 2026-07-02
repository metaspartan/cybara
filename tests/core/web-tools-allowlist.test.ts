import { afterEach, describe, expect, test } from "bun:test";
import {
  handleBrowser,
  handleWebFetch,
  validateBrowserNavigationUrl,
} from "../../src/core/tools/handlers/browser";
import { handleWebSearch } from "../../src/core/tools/handlers/web-search";
import { config } from "../../src/core/config";

const originalFetch = globalThis.fetch;
const originalBraveApiKey = process.env.BRAVE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBraveApiKey === undefined) {
    delete process.env.BRAVE_API_KEY;
  } else {
    process.env.BRAVE_API_KEY = originalBraveApiKey;
  }
  config.setWebToolUrlPolicy({
    enabled: false,
    fetch_allowlist: [],
    search_result_allowlist: [],
  });
});

describe("Web tool URL allowlist policy", () => {
  test("blocks web_fetch for hosts outside fetch allowlist", async () => {
    config.setWebToolUrlPolicy({
      enabled: true,
      fetch_allowlist: ["allowed.example"],
      search_result_allowlist: [],
    });

    await expect(handleWebFetch({ url: "https://blocked.example/path" })).rejects.toThrow(
      "not allowlisted for web_fetch"
    );
  });

  test("blocks web_fetch before fetch for private hosts", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("unexpected");
    }) as typeof fetch;

    await expect(handleWebFetch({ url: "http://127.0.0.1:4269/api/config" })).rejects.toThrow(
      "Request blocked"
    );
    expect(called).toBe(false);
  });

  test("browser navigation uses the same private-host and allowlist policy", async () => {
    await expect(
      validateBrowserNavigationUrl("http://localhost:4269/api/config")
    ).rejects.toThrow("Navigation blocked");

    config.setWebToolUrlPolicy({
      enabled: true,
      fetch_allowlist: ["allowed.example"],
      search_result_allowlist: [],
    });

    await expect(validateBrowserNavigationUrl("https://blocked.example/path")).rejects.toThrow(
      "not allowlisted for web_fetch"
    );
    await expect(validateBrowserNavigationUrl("https://allowed.example/path")).resolves.toBeUndefined();
  });

  test("browser openProfileTab blocks private hosts before opening a profile page", async () => {
    await expect(
      handleBrowser({
        action: "openProfileTab",
        profile: "qa-profile",
        url: "http://127.0.0.1:4269/api/config",
      })
    ).rejects.toThrow("Navigation blocked");
  });

  test("allows web_fetch for allowlisted hosts", async () => {
    config.setWebToolUrlPolicy({
      enabled: true,
      fetch_allowlist: ["*.allowed.example"],
      search_result_allowlist: [],
    });

    globalThis.fetch = (async () =>
      new Response("<html><head><title>Allowed</title></head><body><p>Hello world</p></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })) as typeof fetch;

    const result = await handleWebFetch({ url: "https://docs.allowed.example/path" });
    expect(result.title).toBe("Allowed");
    expect(result.content).toContain("Hello world");
  });

  test("filters web_search results to search result allowlist hosts", async () => {
    process.env.BRAVE_API_KEY = "brave-test-key";
    config.setWebToolUrlPolicy({
      enabled: true,
      fetch_allowlist: [],
      search_result_allowlist: ["*.allowed.example"],
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Allowed",
                url: "https://news.allowed.example/article",
                description: "allowed result",
              },
              {
                title: "Blocked",
                url: "https://blocked.example/post",
                description: "blocked result",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    const query = `allowlist-test-${Date.now()}`;
    const result = await handleWebSearch({ query, count: 5 });
    expect(result.provider).toBe("brave");
    expect(result.count).toBe(1);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.url).toContain("allowed.example");
  });
});
