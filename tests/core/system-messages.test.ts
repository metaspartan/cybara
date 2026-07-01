import { describe, expect, test } from "bun:test";
import { coalesceSystemMessages } from "../../src/core/llm/system-messages";

describe("coalesceSystemMessages", () => {
  test("merges multiple system messages into one leading system message", () => {
    const out = coalesceSystemMessages([
      { role: "system", content: "base prompt" },
      { role: "system", content: "## Relevant memory\n- fact" },
      { role: "system", content: "Session workspace directory: /tmp" },
      { role: "user", content: "hi" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe("system");
    expect(out[0].content).toBe(
      "base prompt\n\n## Relevant memory\n- fact\n\nSession workspace directory: /tmp"
    );
    expect(out[1]).toEqual({ role: "user", content: "hi" });
  });

  test("leaves a single system message untouched", () => {
    const msgs = [
      { role: "system", content: "base" },
      { role: "user", content: "q" },
    ];
    expect(coalesceSystemMessages(msgs)).toBe(msgs);
  });

  test("no system messages -> unchanged", () => {
    const msgs = [{ role: "user", content: "q" }];
    expect(coalesceSystemMessages(msgs)).toBe(msgs);
  });

  test("preserves non-system order and ignores blank system content", () => {
    const out = coalesceSystemMessages([
      { role: "system", content: "a" },
      { role: "user", content: "1" },
      { role: "system", content: "   " },
      { role: "assistant", content: "2" },
      { role: "system", content: "b" },
    ]);
    expect(out[0].content).toBe("a\n\nb");
    expect(out.slice(1).map((m) => m.content)).toEqual(["1", "2"]);
  });
});
