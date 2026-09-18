import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { config } from "../../src/core/config";
import { mcpManager } from "../../src/core/mcp";
import { handleWebSearch } from "../../src/core/tools/handlers/web-search";
import { updateWebResearchSettings } from "../../src/core/web-research-settings";

const originalFetch = globalThis.fetch;
const isolatedEnvVars = [
  "FIRECRAWL_API_KEY",
  "FIRECRAWL_API_URL",
  "PARALLEL_API_KEY",
  "TAVILY_API_KEY",
  "TAVILY_API_URL",
  "EXA_API_KEY",
  "BRAVE_API_KEY",
  "SEARXNG_URL",
  "SEARXNG_BASE_URL",
  "WEB_SEARCH_ORDER",
  "WEB_SEARCH_DISABLED",
  "WEB_SEARCH_MCP_SERVER",
  "WEB_SEARCH_MCP_TOOL",
  "WEB_SEARCH_MCP_QUERY_ARG",
  "WEB_SEARCH_MCP_COUNT_ARG",
];
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of isolatedEnvVars) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
  config.set("web_research_credentials", null);
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("web_search customization", () => {
  test("sends hosted provider requests to a configured base URL", async () => {
    updateWebResearchSettings(
      {
        credentials: { tavily: "tv-key" },
        urls: { tavily: "https://tavily.proxy.test/v1" },
        disabledBackends: ["duckduckgo"],
      },
      {}
    );
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return Response.json({
        results: [{ title: "Hit", url: "https://hit.example/a", content: "found" }],
      });
    }) as typeof fetch;

    const result = await handleWebSearch({ query: "base url override probe" });

    expect(requested).toEqual(["https://tavily.proxy.test/v1/search"]);
    expect(result.provider).toBe("tavily");
    expect(result.results[0]?.url).toBe("https://hit.example/a");
  });

  test("falls back from a failing provider to a configured MCP search tool", async () => {
    updateWebResearchSettings(
      {
        credentials: { tavily: "tv-key" },
        backendOrder: ["tavily", "mcp"],
        disabledBackends: ["duckduckgo"],
        mcpBackend: {
          server: "Search Server",
          tool: "web_lookup",
          queryArg: "q",
          countArg: "limit",
        },
      },
      {}
    );
    globalThis.fetch = (async () =>
      new Response("unavailable", { status: 503, statusText: "Unavailable" })) as typeof fetch;
    spyOn(mcpManager, "getAllTools").mockReturnValue([
      {
        name: "web_lookup",
        description: "search",
        inputSchema: {},
        serverId: "server-1",
        serverName: "Search Server",
      },
    ]);
    const callTool = spyOn(mcpManager, "callTool").mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({ results: [{ title: "Via MCP", url: "https://mcp.example/r" }] }),
        },
      ],
    });

    const result = await handleWebSearch({ query: "mcp fallback probe", count: 3 });

    expect(callTool).toHaveBeenCalledWith("server-1", "web_lookup", {
      q: "mcp fallback probe",
      limit: 3,
    });
    expect(result.provider).toBe("mcp");
    expect(result.results).toEqual([
      { title: "Via MCP", url: "https://mcp.example/r", description: "", siteName: "mcp.example" },
    ]);
  });

  test("reports a stopped MCP server as a provider failure", async () => {
    updateWebResearchSettings(
      {
        disabledBackends: ["duckduckgo"],
        mcpBackend: { server: "missing", tool: "search" },
      },
      {}
    );
    spyOn(mcpManager, "getAllTools").mockReturnValue([]);

    await expect(handleWebSearch({ query: "stopped mcp probe" })).rejects.toThrow(
      'mcp: MCP server "missing" is not running or does not expose "search"'
    );
  });

  test("explains when every provider is disabled", async () => {
    updateWebResearchSettings({ disabledBackends: ["duckduckgo"] }, {});
    await expect(handleWebSearch({ query: "nothing enabled probe" })).rejects.toThrow(
      "No web search providers are enabled"
    );
  });
});
