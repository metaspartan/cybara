import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  classifyToolCapabilities,
  getToolCapabilityPolicy,
  isDestructiveToolCall,
  resolveToolCapabilityDecision,
  setToolCapabilityPolicy,
} from "../../src/core/tool-capability-policy";
import { executeTool } from "../../src/core/tools/handlers";

afterEach(() => {
  config.set("tool_capability_policy", null);
});

describe("tool capability policy", () => {
  test("classifies permissions and destructive arguments independently", () => {
    expect(classifyToolCapabilities("read", { path: "README.md" }, ["fs:read"])).toEqual(["read"]);
    expect(classifyToolCapabilities("exec", { command: "rm -rf build" }, ["exec:run"])).toEqual([
      "execution",
      "destructive",
    ]);
    expect(isDestructiveToolCall("git", { command: "reset --hard HEAD" })).toBe(true);
    expect(isDestructiveToolCall("git", { command: "status" })).toBe(false);
    expect(isDestructiveToolCall("wallet", { action: "balance" })).toBe(false);
    expect(isDestructiveToolCall("wallet", { action: "send" })).toBe(true);
  });

  test("uses the most restrictive policy across a tool call", () => {
    setToolCapabilityPolicy({ execution: "allow", destructive: "ask" });
    expect(
      resolveToolCapabilityDecision("exec", { command: "rm -rf build" }, ["exec:run"])
    ).toEqual({ capabilities: ["execution", "destructive"], mode: "ask" });

    setToolCapabilityPolicy({ execution: "allow", destructive: "deny" });
    expect(
      resolveToolCapabilityDecision("exec", { command: "rm -rf build" }, ["exec:run"]).mode
    ).toBe("deny");
  });

  test("fails closed in the canonical tool executor", async () => {
    setToolCapabilityPolicy({ read: "deny" });
    await expect(executeTool("read", { path: "README.md" })).rejects.toThrow(
      "denied by the read capability policy"
    );
  });

  test("normalizes unknown settings to inherit", () => {
    config.set("tool_capability_policy", { read: "unknown", browser: "allow" });
    expect(getToolCapabilityPolicy()).toMatchObject({
      read: "inherit",
      browser: "allow",
      destructive: "inherit",
    });
  });
});
