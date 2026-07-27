import { ensureSessionTrajectory, registerDatasetItemExecutor } from "../core/agent-eval";
import { summarizeSessionTokenUsage } from "../core/session-context";
import { handleChat } from "./chat";

registerDatasetItemExecutor(async (run, item) => {
  await handleChat({
    sessionId: item.sessionId,
    agentId: run.agentId,
    message: item.prompt,
    source: "dataset_generation",
    tools: run.toolsEnabled,
  });
  const trajectory = await ensureSessionTrajectory(item.sessionId);
  return {
    trajectoryId: trajectory.id,
    usage: summarizeSessionTokenUsage(item.sessionId),
  };
});
