export type ComputerUseTrajectoryStatus = "completed" | "interrupted" | "error";

type ComputerUseTrajectoryStopHandler = (
  sessionId: string,
  status: ComputerUseTrajectoryStatus,
  error?: string
) => Promise<boolean>;

let stopHandler: ComputerUseTrajectoryStopHandler | undefined;

export function setComputerUseTrajectoryStopHandler(
  handler: ComputerUseTrajectoryStopHandler
): void {
  stopHandler = handler;
}

export async function stopRegisteredComputerUseTrajectory(
  sessionId: string,
  status: ComputerUseTrajectoryStatus = "completed",
  error?: string
): Promise<boolean> {
  return stopHandler ? await stopHandler(sessionId, status, error) : false;
}
