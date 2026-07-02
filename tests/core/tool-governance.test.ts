import { describe, expect, test } from "bun:test";
import { PARALLEL_SAFE_TOOLS } from "../../src/core/llm/parallel-tools";
import {
  getDangerousToolNames,
  isDangerousTool,
  toolSchemas,
} from "../../src/core/tools/index";

describe("tool governance invariants", () => {
  const parallelSafePermissions = new Set([
    "agents:read",
    "fs:read",
    "memory:read",
    "net:fetch",
    "sessions:list",
    "sessions:read",
  ]);

  test("every advertised tool declares category and permissions metadata", () => {
    const invalid: string[] = [];

    for (const [name, tool] of Object.entries(toolSchemas)) {
      if (!tool.category) invalid.push(`${name}: missing category`);
      if (!Array.isArray(tool.permissions)) invalid.push(`${name}: missing permissions array`);
      if (tool.name !== name) invalid.push(`${name}: schema name mismatch ${tool.name}`);
    }

    expect(invalid).toEqual([]);
  });

  test("dangerous tool registry is backed by the classifier", () => {
    for (const name of getDangerousToolNames()) {
      expect(isDangerousTool(name)).toBe(true);
      expect(toolSchemas[name]).toBeDefined();
    }
  });

  test("parallel-safe tools are real read-only tool schemas", () => {
    const invalid: string[] = [];

    for (const name of PARALLEL_SAFE_TOOLS) {
      const tool = toolSchemas[name];
      if (!tool) {
        invalid.push(`${name}: missing schema`);
        continue;
      }
      if (isDangerousTool(name)) invalid.push(`${name}: dangerous`);
      for (const permission of tool.permissions) {
        if (!parallelSafePermissions.has(permission)) {
          invalid.push(`${name}: non-read-only permission ${permission}`);
        }
      }
    }

    expect(invalid).toEqual([]);
  });
});
