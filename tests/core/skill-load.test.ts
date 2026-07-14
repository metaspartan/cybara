import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clearLoadedSkillsCache } from "../../src/core/skills/loader";
import { handleSkillLoad } from "../../src/core/tools/handlers/skill";

let workspaceDir = "";

afterEach(() => {
  clearLoadedSkillsCache();
  if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
  workspaceDir = "";
});

describe("skill_load", () => {
  test("loads workspace Skill instructions without exposing its file path", async () => {
    workspaceDir = mkdtempSync(join(tmpdir(), "cybara-skill-load-"));
    const skillDir = join(workspaceDir, "skills", "release-qa");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: Release QA\ndescription: Validate a release\n---\n\nReturn RELEASE_QA_OK.\n"
    );
    clearLoadedSkillsCache();

    const loaded = (await handleSkillLoad(
      { name: "release-qa" },
      { agentId: "agent-1", workspaceDir }
    )) as Record<string, unknown>;

    expect(loaded.name).toBe("Release QA");
    expect(loaded.instructions).toContain("RELEASE_QA_OK");
    expect(loaded.source).toBe("workspace");
    expect(loaded.filePath).toBeUndefined();
  });

  test("rejects unavailable skills", async () => {
    workspaceDir = mkdtempSync(join(tmpdir(), "cybara-skill-load-missing-"));
    clearLoadedSkillsCache();
    await expect(
      handleSkillLoad({ name: "missing-skill" }, { agentId: "agent-1", workspaceDir })
    ).rejects.toThrow("Skill not found or unavailable");
  });
});
