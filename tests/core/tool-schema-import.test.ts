import { describe, expect, test } from "bun:test";
import { getBuiltinTools } from "../../src/core/agent";
import { toolSchemas } from "../../src/core/tools/index";

describe("Tool schema import stability", () => {
  test("tools index and agent builtins import without circular init failures", () => {
    expect(Object.keys(toolSchemas).length).toBeGreaterThan(0);
    const builtins = getBuiltinTools();
    expect(builtins.length).toBeGreaterThan(0);
  });
});
