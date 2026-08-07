import { afterEach, describe, expect, test } from "bun:test";
import {
  parseGeneratedSkill,
  shouldCaptureSkillFromToolCalls,
} from "../../src/api/chat-skill-capture";
import { config } from "../../src/core/config";

afterEach(() => {
  config.set("self_improving_skills_enabled", null);
});

describe("chat skill capture", () => {
  test("qualifies a verified multi-step mutating workflow", () => {
    expect(
      shouldCaptureSkillFromToolCalls([
        { name: "read" },
        { name: "write" },
        { name: "exec" },
        { name: "edit" },
        { name: "exec" },
      ])
    ).toBe(true);
  });

  test("rejects shallow, single-mutation, or skill-covered turns", () => {
    expect(shouldCaptureSkillFromToolCalls([{ name: "read" }, { name: "read" }])).toBe(false);
    expect(shouldCaptureSkillFromToolCalls([{ name: "write" }, { name: "read" }])).toBe(false);
    expect(
      shouldCaptureSkillFromToolCalls([
        { name: "skill_load" },
        { name: "write" },
        { name: "exec" },
        { name: "edit" },
      ])
    ).toBe(false);
    expect(
      shouldCaptureSkillFromToolCalls([
        { name: "write" },
        { name: "exec" },
        { name: "edit" },
        { name: "skill_save" },
      ])
    ).toBe(false);
  });

  test("does not count failed tool calls toward the threshold", () => {
    expect(
      shouldCaptureSkillFromToolCalls([
        { name: "write", error: "denied" },
        { name: "exec", error: "boom" },
        { name: "read" },
      ])
    ).toBe(false);
  });

  test("stays off when self-improving skills are disabled", () => {
    config.set("self_improving_skills_enabled", false);
    expect(
      shouldCaptureSkillFromToolCalls([{ name: "write" }, { name: "exec" }, { name: "edit" }])
    ).toBe(false);
  });

  test("parses a well-formed generated SKILL.md", () => {
    const parsed = parseGeneratedSkill(
      `---\nname: monthly-spending-report\ndescription: Generate a monthly spending report from a bank CSV export.\n---\n\n# Monthly Spending Report\n\nBuild a per-month, per-category spending report.\n\n## Steps\n\n1. Read the CSV and parse rows.\n2. Group by month and category.\n3. Write report.md and verify totals.\n`
    );
    expect(parsed?.name).toBe("monthly-spending-report");
    expect(parsed?.description).toContain("spending report");
    expect(parsed?.content).toContain("## Steps");
  });

  test("returns null for NONE and malformed output", () => {
    expect(parseGeneratedSkill("NONE")).toBeNull();
    expect(parseGeneratedSkill("none, this was one-off")).toBeNull();
    expect(parseGeneratedSkill("# Just a heading with no frontmatter")).toBeNull();
    expect(
      parseGeneratedSkill("---\nname: x\n---\n\n# Title\n\nNo numbered steps here.")
    ).toBeNull();
  });
});
