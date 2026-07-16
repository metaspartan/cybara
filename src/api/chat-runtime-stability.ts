export interface ResidentChatSessionRecord {
  id: string;
  persisted: boolean;
  estimatedChars: number;
  lastAccessedAt: number;
  protected: boolean;
}

export interface ResidentChatSessionLimits {
  maxSessions: number;
  maxEstimatedChars: number;
}

export function pendingChatDrainRetryDelay(
  turnLocked: boolean,
  runStatusActive: boolean
): number | null {
  if (turnLocked) return 100;
  if (runStatusActive) return 500;
  return null;
}

export function selectResidentChatSessionEvictions(
  records: ResidentChatSessionRecord[],
  limits: ResidentChatSessionLimits
): string[] {
  let residentCount = records.length;
  let estimatedChars = records.reduce((total, record) => total + record.estimatedChars, 0);
  const candidates = records
    .filter((record) => record.persisted && !record.protected)
    .sort(
      (left, right) => left.lastAccessedAt - right.lastAccessedAt || left.id.localeCompare(right.id)
    );
  const evictions: string[] = [];

  for (const candidate of candidates) {
    if (residentCount <= limits.maxSessions && estimatedChars <= limits.maxEstimatedChars) {
      break;
    }
    evictions.push(candidate.id);
    residentCount -= 1;
    estimatedChars -= candidate.estimatedChars;
  }

  return evictions;
}
