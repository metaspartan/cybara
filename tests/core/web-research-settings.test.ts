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
        firecrawlApiUrl: "https://crawl.example.test/",
        searxngUrl: "https://search.example.test/",
      },
      {}
    );

    expect(status.credentials.find((item) => item.id === "firecrawl")).toMatchObject({
      configured: true,
      source: "stored",
    });
    expect(status.firecrawlApiUrl.value).toBe("https://crawl.example.test");
    expect(status.searxngUrl.value).toBe("https://search.example.test");

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
    expect(() => updateWebResearchSettings({ firecrawlApiUrl: "file:///tmp/crawl" }, {})).toThrow(
      "must use HTTP or HTTPS"
    );
    expect(() =>
      updateWebResearchSettings({ searxngUrl: "https://user:pass@example.test" }, {})
    ).toThrow("cannot contain credentials");
    expect(() =>
      updateWebResearchSettings(
        { credentials: { unknown: "secret" } as Record<string, string> },
        {}
      )
    ).toThrow("Unsupported web research credential");
  });
});
