import { describe, expect, test } from "bun:test";
import { resolveAgentToolSelection } from "../../src/core/agent";
import { normalizeExplicitAgentTools } from "../../src/core/agent-tool-normalization";
import { getToolSchemasForLLM } from "../../src/core/tools/index";

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

describe("normalizeExplicitAgentTools", () => {
  test("refreshes broad legacy builtin snapshots to current enabled builtin tools", () => {
    const legacy = [
      "read",
      "write",
      "edit",
      "grep",
      "exec",
      "browser",
      "web_search",
      "web_fetch",
      "memory_search",
      "memory_get",
      "sessions_spawn",
      "sessions_send",
      "sessions_history",
      "sessions_list",
      "message",
      "canvas",
      "image",
      "tts",
      "cron",
      "gateway",
    ];

    const names = normalizeExplicitAgentTools(legacy).map((tool) => tool.name);
    const currentEnabledNames = getToolSchemasForLLM().map((tool) => tool.name);

    expect(names).toEqual(currentEnabledNames);
    expect(names).toContain("calc");
  });

  test("keeps narrow intentional allowlists narrow", () => {
    expect(normalizeExplicitAgentTools([{ name: "read" }]).map((tool) => tool.name)).toEqual([
      "read",
    ]);
  });
});
