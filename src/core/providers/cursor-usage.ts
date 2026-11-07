export type CursorUsagePeriod = "weekly" | "monthly" | "";

export interface CursorPlanInfo {
  planLabel: string;
  usagePeriod: CursorUsagePeriod;
  usageResetsAt?: number;
  merged: boolean;
}

export interface CursorOnDemand {
  limitType: string;
  limitCents?: number;
  usedCents?: number;
}

export interface CursorPeriodUsage {
  totalPercentUsed?: number;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  cycleStart?: number;
  cycleEnd?: number;
  onDemand?: CursorOnDemand;
  bonusSpendCents?: number;
  remainingBonus?: boolean;
}

export interface CursorUsageSummary {
  membershipType?: string;
  planUsedCents?: number;
  planLimitCents?: number;
  onDemandEnabled?: boolean;
  onDemandUsedCents?: number;
  onDemandLimitCents?: number | null;
  cycleEnd?: number;
}

export interface CursorUsageWindowValue {
  usedPercent: number;
  resetsAt?: number;
  windowSeconds?: number;
  unlimited?: boolean;
  title?: string;
}

export interface CursorUsageResult {
  planLabel?: string;
  period: CursorUsagePeriod;
  primary?: CursorUsageWindowValue;
  extras: CursorUsageWindowValue[];
  onDemand?: CursorUsageWindowValue;
}

const WEEKLY_PERIODS = new Set(["INCLUDED_USAGE_PERIOD_WEEKLY", "2"]);
const MONTHLY_PERIODS = new Set(["INCLUDED_USAGE_PERIOD_MONTHLY", "1"]);
const UNLIMITED_CENTS = 2147483647;

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
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function asCents(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function asPercent(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(100, parsed);
}

function windowSeconds(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined || end <= start) return undefined;
  return Math.round((end - start) / 1000);
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
    merged: payload?.isMerged === true,
  };
}

export function parseCursorPeriodUsage(body: unknown): CursorPeriodUsage | null {
  const payload = asRecord(body);
  if (!payload) return null;
  const planUsage = asRecord(payload.planUsage);
  const spendLimit = asRecord(payload.spendLimitUsage);
  const onDemand: CursorOnDemand | undefined = spendLimit
    ? {
        limitType: typeof spendLimit.limitType === "string" ? spendLimit.limitType : "",
        limitCents: asCents(spendLimit.individualLimit),
        usedCents: asCents(spendLimit.individualUsed),
      }
    : undefined;
  const usage: CursorPeriodUsage = {
    totalPercentUsed: asPercent(planUsage?.totalPercentUsed),
    autoPercentUsed: asPercent(planUsage?.autoPercentUsed),
    apiPercentUsed: asPercent(planUsage?.apiPercentUsed),
    cycleStart: asEpochMs(payload.billingCycleStart),
    cycleEnd: asEpochMs(payload.billingCycleEnd),
    onDemand,
    bonusSpendCents: asCents(planUsage?.bonusSpend),
    remainingBonus: planUsage?.remainingBonus === true,
  };
  const hasPlanUsage = usage.totalPercentUsed !== undefined;
  const hasOnDemand = usage.onDemand !== undefined;
  if (!hasPlanUsage && !hasOnDemand && usage.cycleEnd === undefined) return null;
  return usage;
}

export function parseCursorHardLimit(body: unknown): number | undefined {
  const payload = asRecord(body);
  const limit = asCents(payload?.hardLimit);
  if (limit === undefined || limit >= UNLIMITED_CENTS) return undefined;
  return limit;
}

export function parseCursorUsageSummary(body: unknown): CursorUsageSummary | null {
  const payload = asRecord(body);
  if (!payload) return null;
  const individual = asRecord(payload.individualUsage);
  const plan = asRecord(individual?.plan);
  const onDemand = asRecord(individual?.onDemand);
  const summary: CursorUsageSummary = {
    membershipType:
      typeof payload.membershipType === "string" ? payload.membershipType.trim() : undefined,
    planUsedCents: asCents(plan?.used),
    planLimitCents: asCents(plan?.limit),
    onDemandEnabled: onDemand?.enabled === true,
    onDemandUsedCents: asCents(onDemand?.used),
    onDemandLimitCents: onDemand?.limit === null ? null : (asCents(onDemand?.limit) ?? undefined),
    cycleEnd: asEpochMs(payload.billingCycleEnd),
  };
  const known =
    summary.planUsedCents !== undefined ||
    summary.planLimitCents !== undefined ||
    summary.onDemandEnabled === true;
  return known ? summary : null;
}

function onDemandWindow(
  summary: CursorUsageSummary | null,
  usage: CursorPeriodUsage | null,
  hardLimitCents: number | undefined
): CursorUsageWindowValue | undefined {
  if (summary?.onDemandEnabled) {
    const limit = summary.onDemandLimitCents;
    const used = summary.onDemandUsedCents ?? 0;
    const unlimited = limit === null || limit === undefined;
    const usedPercent = unlimited ? 0 : Math.min(100, (used / limit) * 100);
    return { usedPercent, unlimited, title: "On-demand" };
  }
  const spend = usage?.onDemand;
  if (!spend) return undefined;
  const limit = spend.limitCents ?? hardLimitCents;
  const used = spend.usedCents ?? 0;
  if (limit === undefined) return undefined;
  if (limit <= 0) return undefined;
  const usedPercent = Math.min(100, (used / limit) * 100);
  return { usedPercent, unlimited: false, title: "On-demand" };
}

export function buildCursorUsage(input: {
  plan: CursorPlanInfo | null;
  usage: CursorPeriodUsage | null;
  summary: CursorUsageSummary | null;
  hardLimitCents?: number;
}): CursorUsageResult | null {
  const { plan, usage, summary } = input;
  const extras: CursorUsageWindowValue[] = [];
  const resetsAt = plan?.usageResetsAt ?? usage?.cycleEnd;
  const seconds = windowSeconds(usage?.cycleStart, usage?.cycleEnd);
  const period = plan?.usagePeriod ?? "";
  const onDemand = onDemandWindow(summary, usage, input.hardLimitCents);

  if (usage?.totalPercentUsed !== undefined) {
    const primary: CursorUsageWindowValue = {
      usedPercent: usage.totalPercentUsed,
      title: period === "monthly" ? "Monthly" : "Weekly",
    };
    if (resetsAt !== undefined) primary.resetsAt = resetsAt;
    if (seconds !== undefined) primary.windowSeconds = seconds;
    if (usage.apiPercentUsed !== undefined) {
      const cursorModels: CursorUsageWindowValue = {
        usedPercent: usage.autoPercentUsed ?? 0,
        title: "Cursor Models",
      };
      const otherModels: CursorUsageWindowValue = {
        usedPercent: usage.apiPercentUsed,
        title: "Other Models",
      };
      if (resetsAt !== undefined) {
        cursorModels.resetsAt = resetsAt;
        otherModels.resetsAt = resetsAt;
      }
      if (seconds !== undefined) {
        cursorModels.windowSeconds = seconds;
        otherModels.windowSeconds = seconds;
      }
      extras.push(cursorModels, otherModels);
    }
    return {
      planLabel: plan?.planLabel || undefined,
      period: period || "weekly",
      primary,
      extras,
      onDemand,
    };
  }

  const used = summary?.planUsedCents;
  const limit = summary?.planLimitCents;
  if (used === undefined || limit === undefined || limit <= 0) return null;
  const primary: CursorUsageWindowValue = {
    usedPercent: Math.min(100, (used / limit) * 100),
    title: "Enterprise",
  };
  if (summary?.cycleEnd !== undefined) primary.resetsAt = summary.cycleEnd;
  return {
    planLabel: plan?.planLabel || summary?.membershipType || undefined,
    period: "monthly",
    primary,
    extras,
    onDemand,
  };
}
