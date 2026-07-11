import type { AgentEvalRun } from "./types";

export interface EvalReplayOptions {
  agentId?: string;
  modelOverride?: string;
}

type EvalReplayExecutor = (goldenId: string, options?: EvalReplayOptions) => Promise<AgentEvalRun>;

let replayExecutor: EvalReplayExecutor | null = null;

export function registerEvalReplayExecutor(executor: EvalReplayExecutor): void {
  replayExecutor = executor;
}

export async function replayGolden(
  goldenId: string,
  options?: EvalReplayOptions
): Promise<AgentEvalRun> {
  if (!replayExecutor) throw new Error("Eval replay runtime is not ready");
  return replayExecutor(goldenId, options);
}
