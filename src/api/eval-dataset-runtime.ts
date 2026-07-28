import { ensureSessionTrajectory, registerDatasetItemExecutor } from "../core/agent-eval";
import { summarizeSessionTokenUsage } from "../core/session-context";
import { handleChat } from "./chat";

registerDatasetItemExecutor(async (run, item, signal) => {
  if (signal.aborted) throw signal.reason;
  const response = await handleChat({
    sessionId: item.sessionId,
    agentId: run.agentId,
    message: item.prompt,
    source: "dataset_generation",
    tools: run.toolsEnabled,
    abortSignal: signal,
    maxOutputTokens: run.maxOutputTokens,
    modelParamsOverride: {
      max_tool_iterations: 12,
      max_tool_runtime_seconds: run.sampleTimeoutSeconds,
    },
  });
  if (signal.aborted) throw signal.reason;
  if (response.failure) {
    throw new Error(response.message.content || "The teacher provider could not generate a sample");
  }
  if (response.interrupted || response.stopped) {
    throw new Error("Dataset sample generation was interrupted");
  }
  const trajectory = await ensureSessionTrajectory(item.sessionId);
  return {
    trajectoryId: trajectory.id,
    usage: summarizeSessionTokenUsage(item.sessionId),
  };
});
