import { describe, expect, test } from "bun:test";
import { buildJourneyEdges, journeyDisplayText } from "../../src/api/journey";

describe("journey display text", () => {
  test("removes markdown chrome without losing readable content", () => {
    expect(
      journeyDisplayText(
        "## 1. **Bounded search** uses `Bun.Glob` and [the index](https://example.com).",
        120
      )
    ).toBe("1. Bounded search uses Bun.Glob and the index.");
  });

  test("collapses multiline memory content and truncates at the display boundary", () => {
    expect(journeyDisplayText("- first\n- second\n- third", 18)).toBe("first second third");
    expect(journeyDisplayText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
  });
});

describe("journey edge graph", () => {
  const event = (id: string, title: string, detail: string, category: string) => ({
    id,
    kind: "skill" as const,
    title,
    detail,
    category,
    createdAt: "",
    createdAtMs: 1,
    source: id,
  });

  test("connects nodes sharing significant topic keywords", () => {
    const edges = buildJourneyEdges([
      event("a", "Build CSV spending report", "group transactions by month category", "learned"),
      event("b", "Parse CSV export", "read csv transactions and group by category", "learned"),
      event("c", "Unrelated weather lookup", "fetch forecast for a city", "reference"),
    ]);
    const ab = edges.find(
      (edge) =>
        (edge.source === "a" && edge.target === "b") || (edge.source === "b" && edge.target === "a")
    );
    expect(ab).toBeDefined();
    expect(ab?.kind).toBe("topic");
    expect(edges.some((edge) => edge.source === "c" || edge.target === "c")).toBe(false);
  });

  test("caps edges per node so the graph stays readable", () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      event(`n${i}`, `Report generator ${i}`, "csv month category totals savings report", "learned")
    );
    const edges = buildJourneyEdges(events);
    const degree = new Map<string, number>();
    for (const edge of edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    for (const count of degree.values()) {
      expect(count).toBeLessThanOrEqual(4);
    }
  });
});
