import { describe, expect, test } from "bun:test";
import {
  selectMoaAgents,
  buildMoaSynthesisPrompt,
} from "../../src/core/tools/handlers/mixture-of-agents";

describe("selectMoaAgents", () => {
  const all = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
    { id: "d", name: "Delta" },
    { id: "e", name: "Epsilon" },
  ];

  test("filters by requested ids", () => {
    expect(selectMoaAgents(all, ["b", "d"], 4).map((a) => a.id)).toEqual(["b", "d"]);
  });

  test("defaults to first `max` when no ids given", () => {
    expect(selectMoaAgents(all, undefined, 3).map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(selectMoaAgents(all, [], 2).map((a) => a.id)).toEqual(["a", "b"]);
  });

  test("never returns zero via max clamp", () => {
    expect(selectMoaAgents(all, undefined, 0)).toHaveLength(1);
  });
});

describe("buildMoaSynthesisPrompt", () => {
  test("includes the original prompt and every candidate", () => {
    const out = buildMoaSynthesisPrompt("What is 2+2?", [
      { agent: "Alpha", text: "4" },
      { agent: "Beta", text: "The answer is four." },
    ]);
    expect(out).toContain("What is 2+2?");
    expect(out).toContain("Candidate 1 (from Alpha)");
    expect(out).toContain("Candidate 2 (from Beta)");
    expect(out).toContain("The answer is four.");
    expect(out).toContain("synthesized response");
  });
});
