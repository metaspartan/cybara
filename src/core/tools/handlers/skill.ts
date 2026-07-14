import {
  createEligibilityContext,
  createLocalSkill,
  executeSkill,
  filterEligibleSkills,
  loadAllSkills,
} from "../../skills/index";
import type { ToolContext } from "../index";

export async function handleSummarization(args: Record<string, unknown>): Promise<unknown> {
  return await executeSkill("summarization", args);
}

export async function handleVideoFrames(args: Record<string, unknown>): Promise<unknown> {
  return await executeSkill("video_frames", args);
}

export async function handleWeather(args: Record<string, unknown>): Promise<unknown> {
  return await executeSkill("weather", args);
}

export async function handleSkillExecution(
  skillName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return await executeSkill(skillName, args);
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function handleSkillLoad(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const requested = typeof args.name === "string" ? args.name.trim() : "";
  if (!requested) throw new Error("Validation error: 'name' is required.");
  const requestedAlias = normalizeSkillName(requested);
  const eligible = filterEligibleSkills(
    await loadAllSkills({ workspaceDir: context?.workspaceDir }),
    createEligibilityContext()
  );
  const entry = eligible.find(
    (candidate) =>
      candidate.skill.name.toLowerCase() === requested.toLowerCase() ||
      normalizeSkillName(candidate.skill.name) === requestedAlias
  );
  if (!entry) throw new Error(`Skill not found or unavailable: ${requested}`);
  return {
    name: entry.skill.name,
    description: entry.skill.description,
    instructions: entry.skill.instructions,
    source: entry.source,
  };
}

export async function handleSkillSave(args: Record<string, unknown>): Promise<unknown> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!name) return { error: "skill_save requires a 'name'" };
  if (!content) return { error: "skill_save requires 'content'" };

  const result = createLocalSkill({
    name,
    description: typeof args.description === "string" ? args.description : undefined,
    content,
  });
  if (!result.success) return { error: result.error || "Failed to save skill" };
  return {
    success: true,
    slug: result.slug,
    path: result.path,
    note: "Skill saved. It is now available to future sessions via the skills loader.",
  };
}
