import { createLocalSkill, executeSkill } from "../../skills/index";

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

/**
 * Self-improving skills: lets the agent codify a successful multi-step
 * procedure as a reusable local skill (~/.cybara/skills/<slug>/SKILL.md),
 * which the loader picks up for future sessions.
 */
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
