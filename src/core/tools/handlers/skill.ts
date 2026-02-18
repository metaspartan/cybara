import { executeSkill } from "../../skills/index";

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
