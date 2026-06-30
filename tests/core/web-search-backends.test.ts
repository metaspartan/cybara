import { describe, expect, test } from "bun:test";
import { selectSearchBackends } from "../../src/core/tools/handlers/web-search";

describe("web search backend selection", () => {
  test("DuckDuckGo is always the final fallback with no keys", () => {
    expect(selectSearchBackends({})).toEqual(["duckduckgo"]);
  });

  test("quality backends precede brave, then searxng, then ddg", () => {
    const order = selectSearchBackends({
      TAVILY_API_KEY: "t",
      EXA_API_KEY: "e",
      BRAVE_API_KEY: "b",
      SEARXNG_URL: "http://localhost:8080",
    });
    expect(order).toEqual(["tavily", "exa", "brave", "searxng", "duckduckgo"]);
  });

  test("Tavily wins when set", () => {
    expect(selectSearchBackends({ TAVILY_API_KEY: "t" })).toEqual(["tavily", "duckduckgo"]);
  });

  test("Exa is used when only Exa is set", () => {
    expect(selectSearchBackends({ EXA_API_KEY: "e" })).toEqual(["exa", "duckduckgo"]);
  });

  test("Brave preserved as before when only Brave is set", () => {
    expect(selectSearchBackends({ BRAVE_API_KEY: "b" })).toEqual(["brave", "duckduckgo"]);
  });

  test("SearXNG via either env var name", () => {
    expect(selectSearchBackends({ SEARXNG_URL: "http://x" })).toEqual(["searxng", "duckduckgo"]);
    expect(selectSearchBackends({ SEARXNG_BASE_URL: "http://x" })).toEqual([
      "searxng",
      "duckduckgo",
    ]);
  });

  test("empty-string keys are treated as unset", () => {
    expect(selectSearchBackends({ TAVILY_API_KEY: "", BRAVE_API_KEY: "" })).toEqual(["duckduckgo"]);
  });
});
