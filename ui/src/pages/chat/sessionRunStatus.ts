export interface SessionRunStatusLike {
  status?: string;
  detail?: string;
  toolName?: string;
  toolPhase?: string;
}

const STEERING_HANDOFF_DETAIL = "steering to follow-up...";

function normalizedDetail(detail?: string): string {
  return typeof detail === "string" ? detail.trim().toLowerCase() : "";
}

export function isSteeringHandoffStatus(event: SessionRunStatusLike): boolean {
  return event.status === "idle" && normalizedDetail(event.detail) === STEERING_HANDOFF_DETAIL;
}

export function isToolStatusEvent(event: SessionRunStatusLike): boolean {
  return !!(event.toolName?.trim() || event.toolPhase);
}

export function isRunEndingStatus(event: SessionRunStatusLike): boolean {
  if (event.status === "idle") return !isSteeringHandoffStatus(event);
  if (event.status === "error") return !isToolStatusEvent(event);
  return false;
}
