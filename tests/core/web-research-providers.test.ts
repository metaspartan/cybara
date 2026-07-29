import { afterEach, describe, expect, test } from "bun:test";
import { handleWebFetch } from "../../src/core/tools/handlers/browser";
import { handleWebSearch } from "../../src/core/tools/handlers/web-search";
import {
  extractFirecrawl,
  extractParallel,
  searchFirecrawl,
  searchParallel,
} from "../../src/core/tools/handlers/web-research-providers";

const originalFetch = globalThis.fetch;
const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
const originalFirecrawlUrl = process.env.FIRECRAWL_API_URL;
const originalParallelKey = process.env.PARALLEL_API_KEY;
const originalBraveKey = process.env.BRAVE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  if (originalFirecrawlUrl === undefined) delete process.env.FIRECRAWL_API_URL;
  else process.env.FIRECRAWL_API_URL = originalFirecrawlUrl;
  if (originalParallelKey === undefined) delete process.env.PARALLEL_API_KEY;
  else process.env.PARALLEL_API_KEY = originalParallelKey;
  if (originalBraveKey === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = originalBraveKey;
});

describe("web research providers", () => {
  test("Firecrawl search sends v2 filters and normalizes current response shape", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let authorization = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      authorization = new Headers(init?.headers).get("authorization") || "";
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [
              {
                title: "Current result",
                url: "https://docs.example.com/current",
                description: "Fresh result",
                category: "research",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const results = await searchFirecrawl(
      "current research",
      4,
      { FIRECRAWL_API_KEY: "fc-key" },
      {
        categories: ["research"],
        includeDomains: ["docs.example.com"],
        timeRange: "qdr:w",
        country: "US",
      }
    );

    expect(requestUrl).toBe("https://api.firecrawl.dev/v2/search");
    expect(authorization).toBe("Bearer fc-key");
    expect(requestBody).toMatchObject({
      query: "current research",
      limit: 4,
      sources: ["web"],
      categories: ["research"],
      includeDomains: ["docs.example.com"],
      tbs: "qdr:w",
      country: "US",
    });
    expect(results).toEqual([
      {
        title: "Current result",
        url: "https://docs.example.com/current",
        description: "Fresh result",
        siteName: "docs.example.com",
        published: undefined,
      },
    ]);
  });

  test("self-hosted Firecrawl uses its configured endpoint without requiring a cloud key", async () => {
    let requestUrl = "";
    let authorization: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 });
    }) as typeof fetch;

    await searchFirecrawl("local", 2, { FIRECRAWL_API_URL: "http://127.0.0.1:3002/" });
    expect(requestUrl).toBe("http://127.0.0.1:3002/v2/search");
    expect(authorization).toBeNull();
  });

  test("Parallel search maps excerpts and publication metadata", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Parallel result",
              url: "https://example.com/a",
              publish_date: "2026-07-11",
              excerpts: ["First excerpt", "Second excerpt"],
            },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;

    expect(await searchParallel("query", 3, "parallel-key")).toEqual([
      {
        title: "Parallel result",
        url: "https://example.com/a",
        description: "First excerpt Second excerpt",
        siteName: "example.com",
        published: "2026-07-11",
      },
    ]);
  });

  test("web_search cache remains isolated by preferred backend", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    process.env.BRAVE_API_KEY = "brave-key";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("firecrawl")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { web: [{ title: "Firecrawl", url: "https://one.example", description: "one" }] },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          web: {
            results: [{ title: "Brave", url: "https://two.example", description: "two" }],
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const query = `provider-cache-${Date.now()}`;
    const firecrawl = await handleWebSearch({ query, provider: "firecrawl" });
    const brave = await handleWebSearch({ query, provider: "brave" });
    expect(firecrawl.provider).toBe("firecrawl");
    expect(brave.provider).toBe("brave");
  });

  test("web_search preserves requested domain filters when a backend falls through", async () => {
    process.env.BRAVE_API_KEY = "brave-key";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "Allowed", url: "https://docs.allowed.example/a", description: "yes" },
              { title: "Blocked", url: "https://blocked.example/b", description: "no" },
            ],
          },
        }),
        { status: 200 }
      )) as typeof fetch;

    const result = await handleWebSearch({
      query: `domain-filter-${Date.now()}`,
      provider: "brave",
      includeDomains: ["allowed.example"],
    });
    expect(result.results.map((item) => item.url)).toEqual(["https://docs.allowed.example/a"]);
  });

  test("web_search rejects conflicting domain filters before making a request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("unexpected");
    }) as typeof fetch;

    await expect(
      handleWebSearch({
        query: "conflicting filters",
        includeDomains: ["one.example"],
        excludeDomains: ["two.example"],
      })
    ).rejects.toThrow("cannot be used together");
    expect(called).toBe(false);
  });

  test("Firecrawl and Parallel extraction normalize readable content", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: "# Firecrawl\n\nReadable page",
            metadata: { title: "Firecrawl page", sourceURL: "https://example.com/final" },
          },
        }),
        { status: 200 }
      ),
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://example.com/file.pdf",
              title: "PDF",
              excerpts: ["Extracted PDF content"],
            },
          ],
          errors: [],
        }),
        { status: 200 }
      ),
    ];
    globalThis.fetch = (async () =>
      responses.shift() || new Response("missing", { status: 500 })) as typeof fetch;

    expect(
      await extractFirecrawl("https://example.com/start", "markdown", 50_000, {
        FIRECRAWL_API_KEY: "fc-key",
      })
    ).toEqual({
      content: "# Firecrawl\n\nReadable page",
      url: "https://example.com/final",
      title: "Firecrawl page",
      provider: "firecrawl",
    });
    expect(await extractParallel("https://example.com/file.pdf", 50_000, "parallel-key")).toEqual({
      content: "Extracted PDF content",
      url: "https://example.com/file.pdf",
      title: "PDF",
      provider: "parallel",
    });
  });

  test("web_fetch falls back from a blocked direct response to configured Firecrawl", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-key";
    delete process.env.PARALLEL_API_KEY;
    let externalCalls = 0;
    globalThis.fetch = (async () => {
      externalCalls += 1;
      return new Response(
        JSON.stringify({
          success: true,
          data: { markdown: "Recovered content", metadata: { title: "Recovered" } },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    let directCalls = 0;
    const fetchUrl = async (): Promise<Response> => {
      directCalls += 1;
      return new Response("blocked", { status: 403, statusText: "Forbidden" });
    };

    const result = await handleWebFetch(
      { url: "https://example.com/protected" },
      undefined,
      fetchUrl
    );
    expect(result.provider).toBe("firecrawl");
    expect(result.content).toBe("Recovered content");
    expect(directCalls).toBe(1);
    expect(externalCalls).toBe(1);
  });
});
