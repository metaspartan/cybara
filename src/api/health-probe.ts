export interface LivenessPayload {
  live: true;
  timestamp: string;
}

export function isLivenessProbe(method: string, pathname: string): boolean {
  return method === "GET" && pathname === "/api/health/live";
}

export function createLivenessPayload(now: Date = new Date()): LivenessPayload {
  return {
    live: true,
    timestamp: now.toISOString(),
  };
}
