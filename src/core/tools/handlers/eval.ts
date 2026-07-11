import { ensureSessionTrajectory, replayGolden, saveGolden } from "../../agent-eval";
import type { ToolContext } from "../index";

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export async function handleEvalSave(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const sessionId =
    typeof args.sessionId === "string" && args.sessionId.trim()
      ? args.sessionId.trim()
      : requiredString(context?.sessionId, "sessionId");
  const messageIndex =
    typeof args.messageIndex === "number" && Number.isInteger(args.messageIndex)
      ? args.messageIndex
      : undefined;
  const trajectory = await ensureSessionTrajectory(sessionId, messageIndex);
  const name =
    typeof args.name === "string" && args.name.trim()
      ? args.name.trim()
      : trajectory.request.userMessage.content.slice(0, 80) || "Golden run";
  const golden = saveGolden({
    trajectory,
    name,
    description: typeof args.description === "string" ? args.description : undefined,
    tags: Array.isArray(args.tags)
      ? args.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  });
  return { success: true, golden };
}

export async function handleEvalReplay(args: Record<string, unknown>): Promise<unknown> {
  const goldenId = requiredString(args.goldenId, "goldenId");
  const run = await replayGolden(goldenId, {
    agentId: typeof args.agentId === "string" ? args.agentId : undefined,
    modelOverride: typeof args.modelOverride === "string" ? args.modelOverride : undefined,
  });
  return { success: run.status !== "error", run };
}
