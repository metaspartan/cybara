import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import { isSealedSecret } from "../../src/core/secret-storage";
import {
  getWebResearchRuntimeEnv,
  getWebResearchSettingsStatus,
  updateWebResearchSettings,
} from "../../src/core/web-research-settings";

afterEach(() => {
  config.set("web_research_credentials", null);
});

describe("web research settings", () => {
  test("seals stored API keys and resolves them for tool runtimes", () => {
    const status = updateWebResearchSettings(
      {
        credentials: { firecrawl: "fc-secret", tavily: "tv-secret" },
        urls: {
          firecrawl: "https://crawl.example.test/",
          searxng: "https://search.example.test/",
        },
      },
      {}
    );

    expect(status.credentials.find((item) => item.id === "firecrawl")).toMatchObject({
      configured: true,
      source: "stored",
    });
    expect(status.urls.find((item) => item.id === "firecrawl")?.value).toBe(
      "https://crawl.example.test"
    );
    expect(status.urls.find((item) => item.id === "searxng")?.value).toBe(
      "https://search.example.test"
    );

    const stored = config.get<{
      credentials: Record<string, string>;
    }>("web_research_credentials");
    expect(stored?.credentials.firecrawl).not.toContain("fc-secret");
    expect(isSealedSecret(stored?.credentials.firecrawl)).toBe(true);

    const runtime = getWebResearchRuntimeEnv({});
    expect(runtime.FIRECRAWL_API_KEY).toBe("fc-secret");
    expect(runtime.TAVILY_API_KEY).toBe("tv-secret");
    expect(runtime.FIRECRAWL_API_URL).toBe("https://crawl.example.test");
    expect(runtime.SEARXNG_URL).toBe("https://search.example.test");
  });

  test("keeps environment credentials authoritative and immutable from settings", () => {
    updateWebResearchSettings({ credentials: { exa: "stored-exa" } }, {});
    const env = { EXA_API_KEY: "environment-exa" };

    expect(getWebResearchRuntimeEnv(env).EXA_API_KEY).toBe("environment-exa");
    expect(
      getWebResearchSettingsStatus(env).credentials.find((item) => item.id === "exa")
    ).toMatchObject({
      configured: true,
      source: "env",
    });
    expect(() => updateWebResearchSettings({ credentials: { exa: "replacement" } }, env)).toThrow(
      "EXA_API_KEY is set in the gateway environment"
    );
  });

  test("clears stored credentials without exposing them", () => {
    updateWebResearchSettings({ credentials: { brave: "brave-secret" } }, {});
    const status = updateWebResearchSettings({ credentials: { brave: null } }, {});

    expect(status.credentials.find((item) => item.id === "brave")).toMatchObject({
      configured: false,
      source: "none",
    });
    expect(getWebResearchRuntimeEnv({}).BRAVE_API_KEY).toBeUndefined();
  });

  test("rejects unsafe service URLs and unknown credential names", () => {
    expect(() =>
      updateWebResearchSettings({ urls: { firecrawl: "file:///tmp/crawl" } }, {})
    ).toThrow("must use HTTP or HTTPS");
    expect(() =>
      updateWebResearchSettings({ urls: { tavily: "https://user:pass@example.test" } }, {})
    ).toThrow("cannot contain credentials");
    expect(() =>
      updateWebResearchSettings(
        { credentials: { unknown: "secret" } as Record<string, string> },
        {}
      )
    ).toThrow("Unsupported web research credential");
  });

  test("reads URLs saved by earlier versions", () => {
    config.set("web_research_credentials", {
      credentials: {},
      firecrawlApiUrl: "https://crawl.legacy.test",
      searxngUrl: "https://search.legacy.test",
    });

    const runtime = getWebResearchRuntimeEnv({});
    expect(runtime.FIRECRAWL_API_URL).toBe("https://crawl.legacy.test");
    expect(runtime.SEARXNG_URL).toBe("https://search.legacy.test");
  });

  test("stores base URL overrides for every hosted search provider", () => {
    updateWebResearchSettings(
      {
        urls: {
          parallel: "https://parallel.proxy.test/",
          tavily: "https://tavily.proxy.test",
          exa: "https://exa.proxy.test/api",
          brave: "http://localhost:9000",
        },
      },
      {}
    );

    const runtime = getWebResearchRuntimeEnv({});
    expect(runtime.PARALLEL_API_URL).toBe("https://parallel.proxy.test");
    expect(runtime.TAVILY_API_URL).toBe("https://tavily.proxy.test");
    expect(runtime.EXA_API_URL).toBe("https://exa.proxy.test/api");
    expect(runtime.BRAVE_API_URL).toBe("http://localhost:9000");

    const env = { TAVILY_API_URL: "https://env.tavily.test" };
    expect(getWebResearchRuntimeEnv(env).TAVILY_API_URL).toBe("https://env.tavily.test");
    expect(
      getWebResearchSettingsStatus(env).urls.find((item) => item.id === "tavily")
    ).toMatchObject({ source: "env", value: "https://env.tavily.test" });
    expect(() =>
      updateWebResearchSettings({ urls: { tavily: "https://other.test" } }, env)
    ).toThrow("is set in the gateway environment");

    updateWebResearchSettings({ urls: { tavily: null } }, {});
    expect(getWebResearchRuntimeEnv({}).TAVILY_API_URL).toBeUndefined();
    expect(getWebResearchRuntimeEnv({}).EXA_API_URL).toBe("https://exa.proxy.test/api");
  });

  test("stores a custom backend order and disabled providers without dropping keys", () => {
    const status = updateWebResearchSettings(
      {
        credentials: { brave: "brave-secret", tavily: "tavily-secret" },
        backendOrder: ["brave", "duckduckgo", "tavily"],
        disabledBackends: ["tavily"],
      },
      {}
    );

    expect(status.backends.slice(0, 3).map((backend) => backend.id)).toEqual([
      "brave",
      "duckduckgo",
      "tavily",
    ]);
    expect(status.backends.map((backend) => backend.id)).toHaveLength(8);
    expect(status.backends.find((backend) => backend.id === "tavily")).toMatchObject({
      configured: true,
      enabled: false,
    });
    expect(status.backendOrderSource).toBe("stored");

    const runtime = getWebResearchRuntimeEnv({});
    expect(runtime.WEB_SEARCH_ORDER).toBe("brave,duckduckgo,tavily");
    expect(runtime.WEB_SEARCH_DISABLED).toBe("tavily");
    expect(runtime.TAVILY_API_KEY).toBe("tavily-secret");

    expect(() => updateWebResearchSettings({ backendOrder: ["google"] }, {})).toThrow(
      "Unsupported web search backend"
    );
    expect(() =>
      updateWebResearchSettings({ disabledBackends: ["brave"] }, { WEB_SEARCH_DISABLED: "exa" })
    ).toThrow("is set in the gateway environment");

    updateWebResearchSettings({ backendOrder: null, disabledBackends: null }, {});
    expect(getWebResearchRuntimeEnv({}).WEB_SEARCH_ORDER).toBeUndefined();
    expect(getWebResearchSettingsStatus({}).backendOrderSource).toBe("none");
  });

  test("stores an MCP search tool and exposes it to the runtime", () => {
    const status = updateWebResearchSettings(
      { mcpBackend: { server: "search-server", tool: "search", countArg: "limit" } },
      {}
    );

    expect(status.mcpBackend).toMatchObject({
      server: "search-server",
      tool: "search",
      countArg: "limit",
      source: "stored",
    });
    expect(status.backends.find((backend) => backend.id === "mcp")?.configured).toBe(true);
    expect(getWebResearchRuntimeEnv({})).toMatchObject({
      WEB_SEARCH_MCP_SERVER: "search-server",
      WEB_SEARCH_MCP_TOOL: "search",
      WEB_SEARCH_MCP_COUNT_ARG: "limit",
    });

    expect(() => updateWebResearchSettings({ mcpBackend: { server: "only-server" } }, {})).toThrow(
      "needs both a server and a tool"
    );

    updateWebResearchSettings({ mcpBackend: null }, {});
    expect(getWebResearchRuntimeEnv({}).WEB_SEARCH_MCP_SERVER).toBeUndefined();
  });
});
