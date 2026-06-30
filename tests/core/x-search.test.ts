import { describe, expect, test } from "bun:test";
import { buildXSearchBody, extractCitations } from "../../src/core/tools/handlers/x-search";

describe("x_search request body", () => {
  test("forces live search scoped to the x source", () => {
    const body = buildXSearchBody({ query: "ai news" }) as Record<string, unknown>;
    const sp = body.search_parameters as Record<string, unknown>;
    expect(sp.mode).toBe("on");
    expect(sp.sources).toEqual([{ type: "x" }]);
    expect(sp.return_citations).toBe(true);
    expect(sp.max_search_results).toBe(15);
  });

  test("clamps max results to 1..30", () => {
    expect(
      ((buildXSearchBody({ query: "q", maxResults: 999 }).search_parameters as Record<string, unknown>)
        .max_search_results)
    ).toBe(30);
    expect(
      ((buildXSearchBody({ query: "q", maxResults: 0 }).search_parameters as Record<string, unknown>)
        .max_search_results)
    ).toBe(1);
  });

  test("strips @ from handles and applies include/exclude", () => {
    const body = buildXSearchBody({
      query: "q",
      fromHandles: ["@elonmusk", "sama"],
      excludeHandles: ["@spam"],
    });
    const source = (body.search_parameters as { sources: Record<string, unknown>[] }).sources[0];
    expect(source.included_x_handles).toEqual(["elonmusk", "sama"]);
    expect(source.excluded_x_handles).toEqual(["spam"]);
  });

  test("passes date bounds through when provided", () => {
    const sp = buildXSearchBody({ query: "q", fromDate: "2026-01-01", toDate: "2026-02-01" })
      .search_parameters as Record<string, unknown>;
    expect(sp.from_date).toBe("2026-01-01");
    expect(sp.to_date).toBe("2026-02-01");
  });

  test("defaults to grok-4-fast, overridable", () => {
    expect(buildXSearchBody({ query: "q" }).model).toBe("grok-4-fast");
    expect(buildXSearchBody({ query: "q", model: "grok-4" }).model).toBe("grok-4");
  });
});

describe("x_search citation extraction", () => {
  test("reads top-level citations", () => {
    expect(extractCitations({ citations: ["https://x.com/a/1", "https://x.com/b/2"] })).toEqual([
      "https://x.com/a/1",
      "https://x.com/b/2",
    ]);
  });

  test("reads message-level citations", () => {
    expect(
      extractCitations({ choices: [{ message: { citations: ["https://x.com/c/3"] } }] })
    ).toEqual(["https://x.com/c/3"]);
  });

  test("returns empty for missing/garbage", () => {
    expect(extractCitations({})).toEqual([]);
    expect(extractCitations(null)).toEqual([]);
    expect(extractCitations({ citations: "nope" })).toEqual([]);
  });
});
