import { describe, expect, test } from "bun:test";

describe("Tool schema import stability", () => {
  test("tools index and agent builtins import without circular init failures", async () => {
    const toolsModule = await import("../../src/core/tools/index");
    expect(Object.keys(toolsModule.toolSchemas).length).toBeGreaterThan(0);

    const agentModule = await import("../../src/core/agent");
    const builtins = agentModule.getBuiltinTools();
    expect(builtins.length).toBeGreaterThan(0);
  });
});
