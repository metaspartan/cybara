import { describe, expect, test } from "bun:test";
import {
  formatStructuredDataForModel,
  formatToolResultForModel,
} from "../../src/core/llm/model-visible-format";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";

describe("model-visible structured data formatting", () => {
  test("uses TOON for uniform structured records when it is smaller than JSON", () => {
    const value = {
      rows: [
        { path: "src/a.ts", added: 14, removed: 0, status: "modified" },
        { path: "src/b.ts", added: 3, removed: 7, status: "modified" },
        { path: "tests/a.test.ts", added: 22, removed: 1, status: "added" },
      ],
    };

    const result = formatStructuredDataForModel(value, { toonEnabled: true, minSavingsRatio: 0.1 });

    expect(result.format).toBe("toon");
    expect(result.content).toContain("rows[3]{path,added,removed,status}:");
    expect(result.content.length).toBeLessThan(JSON.stringify(value).length);
  });

  test("keeps compact JSON when TOON would not save enough tokens", () => {
    const value = { a: "b", c: "d" };

    const result = formatStructuredDataForModel(value, { toonEnabled: true });

    expect(result.format).toBe("json");
    expect(result.content).toBe(JSON.stringify(value));
  });

  test("respects disabled TOON setting", () => {
    const value = {
      rows: [
        { id: 1, value: "one" },
        { id: 2, value: "two" },
      ],
    };

    expect(formatToolResultForModel(value, { toonEnabled: false })).toBe(JSON.stringify(value));
  });

  test("agent tool-result context formatter uses token optimization config", () => {
    const value = {
      files: [
        { path: "src/a.ts", lines: 80, language: "ts" },
        { path: "src/b.ts", lines: 120, language: "ts" },
        { path: "src/c.ts", lines: 60, language: "ts" },
      ],
    };
    const formatter = (
      agentManager as unknown as {
        truncateToolResultContentForContext: (payload: unknown, maxChars: number) => string;
      }
    ).truncateToolResultContentForContext.bind(agentManager);

    config.setTokenOptimizationSettings({ toonStructuredDataEnabled: true });
    const toon = formatter(value, 10_000);
    expect(toon).toContain("files[3]{path,lines,language}:");

    config.setTokenOptimizationSettings({ toonStructuredDataEnabled: false });
    const json = formatter(value, 10_000);
    expect(json).toBe(JSON.stringify(value));

    config.setTokenOptimizationSettings({ toonStructuredDataEnabled: true });
  });
});
