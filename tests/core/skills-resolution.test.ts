import { beforeEach, describe, expect, test } from "bun:test";
import {
  checkSkillEligibility,
  clearSkillsCache,
  executeSkill,
  getSkill,
  loadAllSkills,
  type SkillEligibilityContext,
} from "../../src/core/skills";

beforeEach(() => {
  clearSkillsCache();
});

describe("Skills SKILL.md resolution", () => {
  test("resolves bundled skills by both frontmatter name and folder slug", () => {
    const byHeading = getSkill("Canvas Skill");
    const bySlug = getSkill("canvas");

    expect(byHeading).toBeDefined();
    expect(bySlug).toBeDefined();
    expect(byHeading?.name).toBe("Canvas Skill");
    expect(bySlug?.name).toBe("Canvas Skill");
    expect(byHeading?.location).toMatch(/skills[\\/]+canvas[\\/]+SKILL\.md$/);
  });

  test("returns manual execution hint for non-automated bundled skills", async () => {
    const result = await executeSkill("Canvas Skill", {});

    expect(result).toMatchObject({
      error: 'Skill "Canvas Skill" exists but has no automated executor',
      skill: {
        name: "Canvas Skill",
      },
      hint: "Read the skill's SKILL.md for manual instructions",
    });
  });

  test("loads Canvas metadata from valid frontmatter", () => {
    const skill = getSkill("canvas");

    expect(skill?.name).toBe("Canvas Skill");
    expect(skill?.description).toContain("interactive HTML");
  });

  test("loads bundled skills", () => {
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
      "blender-mcp",
    ];

    for (const name of expected) {
      const skill = getSkill(name);
      expect(skill, name).toBeDefined();
      expect(skill?.description.length).toBeGreaterThan(20);
      expect(skill?.location).toMatch(/skills[\\/]+/);
    }
  });

  test("loads fal.ai bundled skill by name and folder slug", () => {
    const byName = getSkill("fal.ai");
    const bySlug = getSkill("fal-ai");

    expect(byName).toBeDefined();
    expect(bySlug).toBeDefined();
    expect(byName?.name).toBe("fal.ai");
    expect(bySlug?.name).toBe("fal.ai");
  });

  test("gates fal.ai on either supported fal env var", async () => {
    const entry = (await loadAllSkills({})).find((skill) => skill.skill.name === "fal.ai");
    expect(entry).toBeDefined();

    const baseContext: SkillEligibilityContext = {
      platform: "darwin",
      hasBin: () => true,
      hasEnv: () => false,
      hasConfig: () => false,
    };

    const blocked = checkSkillEligibility(entry!, baseContext);
    expect(blocked.eligible).toBe(false);
    expect(blocked.missing.anyEnv).toEqual(["FAL_KEY", "FAL_API_KEY"]);

    const withFalKey = checkSkillEligibility(entry!, {
      ...baseContext,
      hasEnv: (name) => name === "FAL_KEY",
    });
    expect(withFalKey.eligible).toBe(true);

    const withFalApiKey = checkSkillEligibility(entry!, {
      ...baseContext,
      hasEnv: (name) => name === "FAL_API_KEY",
    });
    expect(withFalApiKey.eligible).toBe(true);
  });

  test("gates mactop to macOS with mactop installed", async () => {
    const entry = (await loadAllSkills({})).find((skill) => skill.skill.name === "mactop");
    expect(entry).toBeDefined();

    const missingBinary = checkSkillEligibility(entry!, {
      platform: "darwin",
      hasBin: () => false,
      hasEnv: () => true,
      hasConfig: () => true,
    });
    expect(missingBinary.eligible).toBe(false);
    expect(missingBinary.missing.bins).toEqual(["mactop"]);

    const linux = checkSkillEligibility(entry!, {
      platform: "linux",
      hasBin: () => true,
      hasEnv: () => true,
      hasConfig: () => true,
    });
    expect(linux.eligible).toBe(false);
    expect(linux.missing.os).toEqual(["darwin"]);

    const ready = checkSkillEligibility(entry!, {
      platform: "darwin",
      hasBin: (name) => name === "mactop",
      hasEnv: () => true,
      hasConfig: () => true,
    });
    expect(ready.eligible).toBe(true);
  });

  test("gates Blender MCP on an available Python runner", async () => {
    const entry = (await loadAllSkills({})).find((skill) => skill.skill.name === "blender-mcp");
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Blender MCP skill was not loaded");

    const missingRuntime = checkSkillEligibility(entry, {
      platform: "darwin",
      hasBin: () => false,
      hasEnv: () => true,
      hasConfig: () => true,
    });
    expect(missingRuntime.eligible).toBe(false);
    expect(missingRuntime.missing.anyBins).toEqual(["uvx", "blender-mcp"]);

    const uvxReady = checkSkillEligibility(entry, {
      platform: "win32",
      hasBin: (name) => name === "uvx",
      hasEnv: () => true,
      hasConfig: () => true,
    });
    expect(uvxReady.eligible).toBe(true);
  });
});
