export type CursorUsagePeriod = "weekly" | "monthly" | "";

export interface CursorPlanInfo {
  planLabel: string;
  usagePeriod: CursorUsagePeriod;
  usageResetsAt?: number;
}

export interface CursorUsageWindow {
  usedPercent: number;
  resetsAt?: number;
  windowSeconds?: number;
}

export interface CursorUsage {
  window?: CursorUsageWindow;
}

const WEEKLY_PERIODS = new Set(["INCLUDED_USAGE_PERIOD_WEEKLY", "2"]);
const MONTHLY_PERIODS = new Set(["INCLUDED_USAGE_PERIOD_MONTHLY", "1"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function asPercent(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(100, parsed);
}

export function parseCursorPlanInfo(body: unknown): CursorPlanInfo | null {
  const payload = asRecord(body);
  const planInfo = asRecord(payload?.planInfo);
  if (!planInfo) return null;
  const planLabel = typeof planInfo.planName === "string" ? planInfo.planName.trim() : "";
  const rawPeriod = planInfo.includedUsagePeriod;
  const periodKey = typeof rawPeriod === "number" ? String(rawPeriod) : String(rawPeriod ?? "");
  let usagePeriod: CursorUsagePeriod = "";
  if (WEEKLY_PERIODS.has(periodKey)) usagePeriod = "weekly";
  else if (MONTHLY_PERIODS.has(periodKey)) usagePeriod = "monthly";
  return {
    planLabel,
    usagePeriod,
    usageResetsAt: asEpochMs(planInfo.includedUsageResetsAt),
  };
}

export function parseCursorUsage(body: unknown): CursorUsage | null {
  const payload = asRecord(body);
  if (!payload) return null;
  const planUsage = asRecord(payload.planUsage);
  const usedPercent = asPercent(planUsage?.totalPercentUsed);
  if (usedPercent === undefined) return null;
  const start = asEpochMs(payload.billingCycleStart);
  const end = asEpochMs(payload.billingCycleEnd);
  const window: CursorUsageWindow = { usedPercent };
  if (end !== undefined) window.resetsAt = end;
  if (start !== undefined && end !== undefined && end > start) {
    window.windowSeconds = Math.round((end - start) / 1000);
  }
  return { window };
}
