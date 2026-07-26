import { describe, expect, test } from "bun:test";
import { getBuiltinTools } from "../../src/core/agent";
import { toolSchemas } from "../../src/core/tools/index";
import { hasTool } from "../../src/core/tools/handlers/index";

describe("Tool schema import stability", () => {
  test("tools index and agent builtins import without circular init failures", () => {
    expect(Object.keys(toolSchemas).length).toBeGreaterThan(0);
    const builtins = getBuiltinTools();
    expect(builtins.length).toBeGreaterThan(0);
  });

  test("every advertised tool schema has a runtime handler", () => {
    const missing = Object.keys(toolSchemas).filter((name) => !hasTool(name));
    expect(missing).toEqual([]);
  });
});
