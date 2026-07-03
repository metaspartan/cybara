import { beforeEach, describe, expect, test } from "bun:test";
import { clearSkillsCache, executeSkill, getSkill } from "../../src/core/skills";

beforeEach(() => {
  clearSkillsCache();
});

describe("Skills SKILL.md resolution", () => {
  test("resolves heading-only skills by both heading name and folder slug", () => {
    const byHeading = getSkill("Canvas Skill");
    const bySlug = getSkill("canvas");

    expect(byHeading).toBeDefined();
    expect(bySlug).toBeDefined();
    expect(byHeading?.name).toBe("Canvas Skill");
    expect(bySlug?.name).toBe("Canvas Skill");
    expect(byHeading?.location).toMatch(/skills[\\/]+canvas[\\/]+SKILL\.md$/);
  });

  test("returns manual execution hint for non-automated heading-only skills", async () => {
    const result = await executeSkill("Canvas Skill", {});

    expect(result).toMatchObject({
      error: 'Skill "Canvas Skill" exists but has no automated executor',
      skill: {
        name: "Canvas Skill",
      },
      hint: "Read the skill's SKILL.md for manual instructions",
    });
  });

  test("loads OpenClaw and Hermes inspired bundled skills", () => {
    const expected = [
      "code-wiki",
      "api-debug",
      "docker-management",
      "fastmcp",
      "subagent-driven-development",
      "domain-intel",
      "oss-forensics",
      "authorized-web-pentest",
      "adversarial-ux-test",
      "cloudflare-temporary-deploy",
    ];

    for (const name of expected) {
      const skill = getSkill(name);
      expect(skill, name).toBeDefined();
      expect(skill?.description.length).toBeGreaterThan(20);
      expect(skill?.location).toMatch(/skills[\\/]+/);
    }
  });
});
