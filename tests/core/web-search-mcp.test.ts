import { describe, expect, test } from "bun:test";
import {
  buildMcpSearchArguments,
  normalizeMcpSearchResults,
} from "../../src/core/tools/handlers/web-search-mcp";
import { providerEndpoint } from "../../src/core/tools/handlers/web-research-providers";

describe("MCP web search backend", () => {
  test("maps the query and optional count onto configured argument names", () => {
    expect(buildMcpSearchArguments("bun sqlite", 4, {})).toEqual({ query: "bun sqlite" });
    expect(
      buildMcpSearchArguments("bun sqlite", 4, {
        WEB_SEARCH_MCP_QUERY_ARG: "q",
        WEB_SEARCH_MCP_COUNT_ARG: "max_results",
      })
    ).toEqual({ q: "bun sqlite", max_results: 4 });
  });

  test("reads structured content rows", () => {
    const results = normalizeMcpSearchResults(
      {
        content: [],
        structuredContent: {
          results: [
            { title: "Bun", url: "https://bun.sh/docs", snippet: "Fast   runtime" },
            { title: "No link" },
          ],
        },
      },
      5
    );
    expect(results).toEqual([
      {
        title: "Bun",
        url: "https://bun.sh/docs",
        description: "Fast runtime",
        siteName: "bun.sh",
      },
    ]);
  });

  test("parses JSON returned as text content, including nested web results", () => {
    const payload = {
      web: {
        results: [
          { name: "One", link: "https://one.example/a", description: "first" },
          { name: "Two", link: "https://two.example/b", description: "second" },
          { name: "Dup", link: "https://one.example/a", description: "again" },
        ],
      },
    };
    const results = normalizeMcpSearchResults(
      { content: [{ type: "text", text: JSON.stringify(payload) }] },
      5
    );
    expect(results.map((result) => result.url)).toEqual([
      "https://one.example/a",
      "https://two.example/b",
    ]);
    expect(results[0].title).toBe("One");
  });

  test("falls back to markdown links and bare URLs in plain text", () => {
    const text = [
      "Search results:",
      "1. [Bun docs](https://bun.sh/docs) - official documentation",
      "2. https://example.com/page plain url result",
      "3. javascript:alert(1)",
    ].join("\n");
    const results = normalizeMcpSearchResults({ content: [{ type: "text", text }] }, 1);
    expect(results).toEqual([
      {
        title: "Bun docs",
        url: "https://bun.sh/docs",
        description: "official documentation",
        siteName: "bun.sh",
      },
    ]);
    expect(normalizeMcpSearchResults({ content: [{ type: "text", text }] }, 5)).toHaveLength(2);
  });

  test("uses resource links when a tool returns them", () => {
    const results = normalizeMcpSearchResults(
      {
        content: [
          { type: "resource_link", uri: "https://docs.example/x", name: "X", description: "d" },
          { type: "resource_link", uri: "file:///etc/passwd", name: "local" },
        ],
      },
      5
    );
    expect(results).toEqual([
      { title: "X", url: "https://docs.example/x", description: "d", siteName: "docs.example" },
    ]);
  });

  test("surfaces tool errors so the chain can fall back", () => {
    expect(() =>
      normalizeMcpSearchResults(
        { isError: true, content: [{ type: "text", text: "rate limited" }] },
        5
      )
    ).toThrow("rate limited");
  });
});

describe("provider base URL overrides", () => {
  test("appends the provider path to a base URL unless it is already present", () => {
    expect(providerEndpoint(undefined, "https://api.tavily.com", "/search")).toBe(
      "https://api.tavily.com/search"
    );
    expect(
      providerEndpoint("https://proxy.test/tavily/", "https://api.tavily.com", "/search")
    ).toBe("https://proxy.test/tavily/search");
    expect(
      providerEndpoint(
        "https://proxy.test/brave/res/v1/web/search?x=1",
        "https://b",
        "/res/v1/web/search"
      )
    ).toBe("https://proxy.test/brave/res/v1/web/search");
  });

  test("rejects non-HTTP and credential-bearing base URLs", () => {
    expect(() => providerEndpoint("ftp://proxy.test", "https://a", "/search")).toThrow(
      "must use HTTP or HTTPS"
    );
    expect(() => providerEndpoint("https://u:p@proxy.test", "https://a", "/search")).toThrow(
      "cannot contain credentials"
    );
  });
});
