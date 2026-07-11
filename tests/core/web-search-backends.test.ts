import { describe, expect, test } from "bun:test";
import {
  parseDuckDuckGoSearchResults,
  resolveSearchBackends,
  selectSearchBackends,
} from "../../src/core/tools/handlers/web-search";

describe("web search backend selection", () => {
  test("DuckDuckGo is always the final fallback with no keys", () => {
    expect(selectSearchBackends({})).toEqual(["duckduckgo"]);
  });

  test("quality backends precede brave, then searxng, then ddg", () => {
    const order = selectSearchBackends({
      FIRECRAWL_API_KEY: "f",
      PARALLEL_API_KEY: "p",
      TAVILY_API_KEY: "t",
      EXA_API_KEY: "e",
      BRAVE_API_KEY: "b",
      SEARXNG_URL: "http://localhost:8080",
    });
    expect(order).toEqual([
      "firecrawl",
      "parallel",
      "tavily",
      "exa",
      "brave",
      "searxng",
      "duckduckgo",
    ]);
  });

  test("Firecrawl supports cloud keys and self-hosted endpoints", () => {
    expect(selectSearchBackends({ FIRECRAWL_API_KEY: "f" })).toEqual(["firecrawl", "duckduckgo"]);
    expect(selectSearchBackends({ FIRECRAWL_API_URL: "http://localhost:3002" })).toEqual([
      "firecrawl",
      "duckduckgo",
    ]);
  });

  test("Parallel is selected when configured", () => {
    expect(selectSearchBackends({ PARALLEL_API_KEY: "p" })).toEqual(["parallel", "duckduckgo"]);
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

  test("ignores an explicitly requested backend when it is not configured", () => {
    expect(resolveSearchBackends("searxng", { BRAVE_API_KEY: "b" })).toEqual([
      "brave",
      "duckduckgo",
    ]);
  });

  test("falls through after an explicitly requested configured backend", () => {
    expect(
      resolveSearchBackends("exa", {
        TAVILY_API_KEY: "t",
        EXA_API_KEY: "e",
        BRAVE_API_KEY: "b",
      })
    ).toEqual(["exa", "tavily", "brave", "duckduckgo"]);
  });

  test("parses nested title and snippet markup from DuckDuckGo HTML", async () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://example.com/spec.pdf">
          <span class="result__type">PDF</span> NVMe <b>thermal</b> specification
        </a>
        <a class="result__snippet" href="https://example.com/spec.pdf">
          The controller throttles at <b>85 C</b> under sustained load.
        </a>
      </div>
    `;

    expect(await parseDuckDuckGoSearchResults(html, 5)).toEqual([
      {
        title: "PDF NVMe thermal specification",
        url: "https://example.com/spec.pdf",
        description: "The controller throttles at 85 C under sustained load.",
        siteName: "example.com",
      },
    ]);
  });

  test("decodes redirect URLs and respects the requested result count", async () => {
    const html = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.example%2Fa">One</a>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.example%2Fa">First</a>
      <a class="result__a" href="https://two.example/b">Two</a>
      <a class="result__snippet" href="https://two.example/b">Second</a>
    `;

    expect(await parseDuckDuckGoSearchResults(html, 1)).toEqual([
      {
        title: "One",
        url: "https://one.example/a",
        description: "First",
        siteName: "one.example",
      },
    ]);
  });
});
