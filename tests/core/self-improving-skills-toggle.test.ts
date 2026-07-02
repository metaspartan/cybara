import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import { isSelfImprovingSkillsEnabled, isToolEnabledForAgent } from "../../src/core/tools/index";

afterEach(() => {
  config.set("self_improving_skills_enabled", true);
});

describe("self-improving skills toggle", () => {
  test("only an explicit false disables it (default-on contract)", () => {
    // The gate is `!== false`, so any non-false value keeps it enabled.
    config.set("self_improving_skills_enabled", true);
    expect(isSelfImprovingSkillsEnabled()).toBe(true);
  });

  test("explicit true keeps skill_save available", () => {
    config.set("self_improving_skills_enabled", true);
    expect(isSelfImprovingSkillsEnabled()).toBe(true);
    expect(isToolEnabledForAgent("skill_save")).toBe(true);
  });

  test("explicit false withholds skill_save", () => {
    config.set("self_improving_skills_enabled", false);
    expect(isSelfImprovingSkillsEnabled()).toBe(false);
    expect(isToolEnabledForAgent("skill_save")).toBe(false);
  });

  test("toggle does not affect unrelated tools", () => {
    config.set("self_improving_skills_enabled", false);
    expect(isToolEnabledForAgent("read")).toBe(true);
    expect(isToolEnabledForAgent("grep")).toBe(true);
  });
});
