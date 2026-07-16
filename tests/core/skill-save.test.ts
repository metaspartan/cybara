import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("self-improving skills (skill_save)", () => {
  const tools =
    readFileSync("src/core/tools/index.ts", "utf8") +
    readFileSync("src/core/tools/schemas-extended.ts", "utf8");
  const handlers = readFileSync("src/core/tools/handlers/index.ts", "utf8");
  const skillHandler = readFileSync("src/core/tools/handlers/skill.ts", "utf8");
  const prompt = readFileSync("src/core/system-prompt.ts", "utf8");

  test("skill_save tool schema is registered", () => {
    expect(tools).toContain('name: "skill_save"');
    expect(handlers).toContain("skill_save: handleSkillSave");
  });

  test("handler persists via createLocalSkill and validates input", () => {
    expect(skillHandler).toContain("createLocalSkill({");
    expect(skillHandler).toContain("skill_save requires a 'name'");
    expect(skillHandler).toContain("skill_save requires 'content'");
  });

  test("system prompt nudges codifying recurring procedures", () => {
    expect(prompt).toContain("Self-improvement");
    expect(prompt).toContain("skill_save");
  });
});
