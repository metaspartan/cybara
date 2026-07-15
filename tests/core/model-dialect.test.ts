import { describe, expect, test } from "bun:test";
import {
  detectModelDialect,
  normalizeAnthropicModelToolUses,
  normalizeModelToolCalls,
} from "../../src/core/llm/model-dialect";

describe("model dialect normalization", () => {
  test("detects major provider and model families", () => {
    expect(detectModelDialect("z.ai", "glm-5.2")).toBe("glm");
    expect(detectModelDialect("moonshot", "kimi-k2")).toBe("kimi");
    expect(detectModelDialect("minimax", "MiniMax-M3")).toBe("minimax");
    expect(detectModelDialect("alibaba", "qwen3-coder")).toBe("qwen");
    expect(detectModelDialect("openai", "gpt-oss-harmony")).toBe("harmony");
    expect(detectModelDialect("anthropic", "claude-opus")).toBe("anthropic");
  });

  test("normalizes native aliases against allowed tool names", () => {
    const calls = normalizeModelToolCalls({
      provider: "z.ai",
      model: "glm-5.2",
      message: {
        tool_calls: [
          { id: "1", function: { name: "functions.file_search", arguments: '{"path":"."}' } },
        ],
      },
      iteration: 1,
      allowedToolNames: new Set(["file_search"]),
    });
    expect(calls).toEqual([
      { id: "1", name: "file_search", args: { path: "." }, source: "native" },
    ]);
  });

  test("normalizes XML and Harmony text calls without leaking markup", () => {
    const xml = normalizeModelToolCalls({
      provider: "minimax",
      model: "MiniMax-M3",
      message: {
        content:
          '<function_calls><invoke name="read"><parameter name="path">README.md</parameter></invoke></function_calls>',
      },
      iteration: 2,
      allowedToolNames: new Set(["read"]),
    });
    const harmony = normalizeModelToolCalls({
      provider: "openai",
      model: "gpt-oss-harmony",
      message: { content: 'commentary to=exec code<|message|>{"command":"pwd"}<|call|>' },
      iteration: 3,
      allowedToolNames: new Set(["exec"]),
    });
    expect(xml[0]).toMatchObject({ name: "read", args: { path: "README.md" }, source: "text" });
    expect(harmony[0]).toMatchObject({ name: "exec", args: { command: "pwd" }, source: "text" });
  });

  test("normalizes Anthropic tool aliases", () => {
    const calls = normalizeAnthropicModelToolUses({
      provider: "anthropic",
      model: "claude-opus",
      content: [{ type: "tool_use", id: "tool-1", name: "tools.read", input: { path: "a" } }],
      iteration: 1,
      allowedToolNames: new Set(["read"]),
    });
    expect(calls[0]).toMatchObject({ id: "tool-1", name: "read", args: { path: "a" } });
  });
});
