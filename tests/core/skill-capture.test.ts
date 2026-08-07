import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  noteSkillCaptureOpportunity,
  resetSkillCaptureStateForTests,
} from "../../src/core/tools/handlers/skill-capture";
import type { ToolContext } from "../../src/core/tools/index";

function ctx(sessionId: string): ToolContext {
  return { sessionId } as ToolContext;
}

afterEach(() => {
  resetSkillCaptureStateForTests();
  config.set("self_improving_skills_enabled", null);
});

describe("skill capture nudge", () => {
  test("nudges on a verification step after a verified multi-step mutating workflow", () => {
    const context = ctx("capture-basic");
    expect(noteSkillCaptureOpportunity("write", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("edit", context)).toBeNull();
    const nudge = noteSkillCaptureOpportunity("exec", context);
    expect(nudge).toContain("skill_save");
  });

  test("re-nudges after further work but stops after the cap", () => {
    const context = ctx("capture-renudge");
    noteSkillCaptureOpportunity("write", context);
    noteSkillCaptureOpportunity("edit", context);
    expect(noteSkillCaptureOpportunity("exec", context)).toContain("skill_save");
    expect(noteSkillCaptureOpportunity("write", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("exec", context)).toContain("skill_save");
    expect(noteSkillCaptureOpportunity("write", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("exec", context)).toBeNull();
  });

  test("does not re-nudge without new mutation between verifications", () => {
    const context = ctx("capture-no-remutation");
    noteSkillCaptureOpportunity("write", context);
    noteSkillCaptureOpportunity("edit", context);
    expect(noteSkillCaptureOpportunity("exec", context)).toContain("skill_save");
    expect(noteSkillCaptureOpportunity("read", context)).toBeNull();
  });

  test("does not nudge for shallow single-mutation work", () => {
    const context = ctx("capture-shallow");
    expect(noteSkillCaptureOpportunity("read", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("write", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("read", context)).toBeNull();
  });

  test("does not nudge when an existing skill already covered the work", () => {
    const context = ctx("capture-loaded");
    noteSkillCaptureOpportunity("skill_load", context);
    expect(noteSkillCaptureOpportunity("write", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("edit", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("exec", context)).toBeNull();
  });

  test("does not nudge after the model already saved a skill", () => {
    const context = ctx("capture-saved");
    noteSkillCaptureOpportunity("write", context);
    noteSkillCaptureOpportunity("skill_save", context);
    expect(noteSkillCaptureOpportunity("edit", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("exec", context)).toBeNull();
  });

  test("stays silent when self-improving skills are disabled", () => {
    config.set("self_improving_skills_enabled", false);
    const context = ctx("capture-disabled");
    expect(noteSkillCaptureOpportunity("write", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("edit", context)).toBeNull();
    expect(noteSkillCaptureOpportunity("exec", context)).toBeNull();
  });
});
