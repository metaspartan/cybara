import { describe, expect, test } from "bun:test";
import { resolveAgentToolSelection } from "../../src/core/agent";

// The core security property: a present-but-empty or corrupt `tools` restriction
// must NOT silently widen the agent to the full builtin tool set.
describe("resolveAgentToolSelection", () => {
  test("unset tools → use builtins", () => {
    expect(resolveAgentToolSelection(undefined)).toEqual({ kind: "builtins" });
    expect(resolveAgentToolSelection(null)).toEqual({ kind: "builtins" });
    expect(resolveAgentToolSelection("")).toEqual({ kind: "builtins" });
    expect(resolveAgentToolSelection("   ")).toEqual({ kind: "builtins" });
  });

  test("explicit array is honored verbatim", () => {
    const arr = [{ name: "read" }, { name: "grep" }];
    expect(resolveAgentToolSelection(arr)).toEqual({ kind: "explicit", tools: arr });
  });

  test("explicit EMPTY array means zero tools, NOT all tools (regression)", () => {
    expect(resolveAgentToolSelection([])).toEqual({ kind: "explicit", tools: [] });
    expect(resolveAgentToolSelection("[]")).toEqual({ kind: "explicit", tools: [] });
  });

  test("JSON string array is parsed and honored", () => {
    expect(resolveAgentToolSelection('[{"name":"read"}]')).toEqual({
      kind: "explicit",
      tools: [{ name: "read" }],
    });
  });

  test("nested serialized JSON arrays are parsed without widening permissions", () => {
    const nested = JSON.stringify(JSON.stringify([{ name: "read" }]));

    expect(resolveAgentToolSelection(nested)).toEqual({
      kind: "explicit",
      tools: [{ name: "read" }],
    });
  });

  test("corrupt/non-array config fails closed, never widens to all tools", () => {
    expect(resolveAgentToolSelection("{not json").kind).toBe("malformed");
    expect(resolveAgentToolSelection('{"tools":"read"}').kind).toBe("malformed");
    expect(resolveAgentToolSelection("null").kind).toBe("malformed");
    expect(resolveAgentToolSelection(42).kind).toBe("malformed");
  });
});
