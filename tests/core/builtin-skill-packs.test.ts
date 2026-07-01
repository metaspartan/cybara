import { describe, expect, test } from "bun:test";
import { getBuiltinSkillPacks } from "../../src/core/skills/builtin-packs";

describe("built-in skill packs", () => {
  const packs = getBuiltinSkillPacks();

  test("ships a non-trivial curated library", () => {
    expect(packs.length).toBeGreaterThanOrEqual(10);
  });

  test("every pack is a valid, model-invocable bundled skill with real content", () => {
    const names = new Set<string>();
    for (const pack of packs) {
      expect(pack.source).toBe("bundled");
      expect(pack.skill.name).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(pack.skill.description.length).toBeGreaterThan(20);
      expect(pack.skill.instructions.length).toBeGreaterThan(120);
      expect(pack.invocation?.disableModelInvocation).toBe(false);
      expect(names.has(pack.skill.name)).toBe(false);
      names.add(pack.skill.name);
    }
  });

  test("covers a broad set of common workflows", () => {
    const names = packs.map((p) => p.skill.name);
    for (const expected of ["web-research", "code-review", "debugging", "security-review"]) {
      expect(names).toContain(expected);
    }
  });
});
