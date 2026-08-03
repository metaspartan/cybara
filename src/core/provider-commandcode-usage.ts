export interface CommandCodePlan {
  id: string;
  displayName: string;
  monthlyCreditsUsd: number;
}

export const COMMANDCODE_PLANS: readonly CommandCodePlan[] = [
  { id: "individual-go", displayName: "Go", monthlyCreditsUsd: 10 },
  { id: "individual-pro", displayName: "Pro", monthlyCreditsUsd: 30 },
  { id: "individual-max", displayName: "Max", monthlyCreditsUsd: 150 },
  { id: "individual-ultra", displayName: "Ultra", monthlyCreditsUsd: 300 },
];

export function commandCodePlan(planId: string | undefined): CommandCodePlan | null {
  if (!planId) return null;
  const normalized = planId.trim().toLowerCase();
  return COMMANDCODE_PLANS.find((plan) => plan.id === normalized) ?? null;
}

export interface CommandCodeCreditsPayload {
  monthlyCredits: number;
  purchasedCredits: number;
  premiumMonthlyCredits: number;
  opensourceMonthlyCredits: number;
}

export interface CommandCodeSubscriptionPayload {
  planId: string;
  status: string;
  currentPeriodEnd?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseCommandCodeCredits(body: unknown): CommandCodeCreditsPayload | null {
  const root = isRecord(body) ? body : null;
  if (!root) return null;
  const credits = isRecord(root.credits) ? root.credits : root;
  const monthly = asFiniteNumber(credits.monthlyCredits);
  if (monthly === null) return null;
  return {
    monthlyCredits: monthly,
    purchasedCredits: asFiniteNumber(credits.purchasedCredits) ?? 0,
    premiumMonthlyCredits: asFiniteNumber(credits.premiumMonthlyCredits) ?? 0,
    opensourceMonthlyCredits: asFiniteNumber(credits.opensourceMonthlyCredits) ?? 0,
  };
}

export function parseCommandCodeSubscription(body: unknown): CommandCodeSubscriptionPayload | null {
  const root = isRecord(body) ? body : null;
  if (!root) return null;
  const data = isRecord(root.data) ? root.data : root;
  const planId = typeof data.planId === "string" ? data.planId.trim() : "";
  if (!planId) return null;
  const status = typeof data.status === "string" ? data.status : "unknown";
  const currentPeriodEnd =
    typeof data.currentPeriodEnd === "string" ? data.currentPeriodEnd : undefined;
  return { planId, status, currentPeriodEnd };
}

export interface CommandCodeUsageWindow {
  usedPercent: number;
  unlimited?: boolean;
  resetsAt?: string;
  title?: string;
}

export interface CommandCodeUsage {
  planLabel: string;
  monthly: CommandCodeUsageWindow;
}

export function buildCommandCodeUsage(
  credits: CommandCodeCreditsPayload,
  subscription: CommandCodeSubscriptionPayload | null
): CommandCodeUsage | null {
  const plan = commandCodePlan(subscription?.planId);
  const allowance = plan?.monthlyCreditsUsd;
  const remaining = Math.max(0, credits.monthlyCredits);
  const planLabel = plan ? `Command Code ${plan.displayName}` : "Command Code";

  if (!allowance || allowance <= 0) {
    return {
      planLabel,
      monthly: { usedPercent: 0, unlimited: true, title: "Monthly credits" },
    };
  }

  const used = Math.min(allowance, Math.max(0, allowance - remaining));
  const usedPercent = Math.round((used / allowance) * 100);
  return {
    planLabel,
    monthly: {
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      resetsAt: subscription?.currentPeriodEnd,
      title: "Monthly credits",
    },
  };
}
