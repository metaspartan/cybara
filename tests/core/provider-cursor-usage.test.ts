import { describe, expect, test } from "bun:test";
import {
  buildCursorUsage,
  parseCursorHardLimit,
  parseCursorPeriodUsage,
  parseCursorPlanInfo,
  parseCursorUsageSummary,
} from "../../src/core/providers/cursor-usage";

const PLAN_BODY = {
  planInfo: {
    planName: "Premium",
    price: "",
    billingCycleEnd: "1796621871487",
    includedUsagePeriod: "INCLUDED_USAGE_PERIOD_WEEKLY",
    includedUsageResetsAt: "1794634669708",
  },
  nextUpgrade: { tier: "super", name: "Super", includedAmountCents: 16159 },
  isMerged: true,
};

const PERIOD_BODY = {
  billingCycleStart: "1794029869708",
  billingCycleEnd: "1794634669708",
  planUsage: {
    remainingBonus: false,
    bonusTooltip:
      "We work with model providers to give you free usage beyond what you've purchased.",
    autoPercentUsed: 0,
    totalPercentUsed: 0,
  },
  spendLimitUsage: { limitType: "user" },
  displayThreshold: 200,
  enabled: true,
  displayMessage: "You've used 0% of your included usage",
  autoBucketModels: ["default", "composer-2.5", "grok-4.7"],
};

const SUMMARY_BODY = {
  billingCycleStart: "2026-11-01T00:00:00.000Z",
  billingCycleEnd: "2026-12-01T00:00:00.000Z",
  membershipType: "premium",
  limitType: "user",
  isUnlimited: false,
  individualUsage: {
    plan: {
      enabled: true,
      used: 0,
      limit: 4615,
      remaining: 4615,
      breakdown: { included: 0, bonus: 0, total: 0 },
      autoPercentUsed: 0,
      apiPercentUsed: 0,
      totalPercentUsed: 0,
    },
    onDemand: { enabled: false, used: 0, limit: null, remaining: null },
  },
  teamUsage: {},
};

describe("parseCursorPlanInfo", () => {
  test("reads the plan name, the included usage period and the reset time", () => {
    const plan = parseCursorPlanInfo(PLAN_BODY);
    expect(plan?.planLabel).toBe("Premium");
    expect(plan?.usagePeriod).toBe("weekly");
    expect(plan?.usageResetsAt).toBe(1794634669708);
    expect(plan?.merged).toBe(true);
  });

  test("reads a monthly included usage window", () => {
    const plan = parseCursorPlanInfo({
      planInfo: { planName: "Ultra", includedUsagePeriod: "INCLUDED_USAGE_PERIOD_MONTHLY" },
      isMerged: true,
    });
    expect(plan?.usagePeriod).toBe("monthly");
  });

  test("reads the numeric period encoding Cursor also sends", () => {
    expect(parseCursorPlanInfo({ planInfo: { includedUsagePeriod: 1 } })?.usagePeriod).toBe(
      "monthly"
    );
    expect(parseCursorPlanInfo({ planInfo: { includedUsagePeriod: 2 } })?.usagePeriod).toBe(
      "weekly"
    );
  });

  test("returns nothing for a payload without plan information", () => {
    expect(parseCursorPlanInfo({})).toBeNull();
    expect(parseCursorPlanInfo(null)).toBeNull();
    expect(parseCursorPlanInfo("plan")).toBeNull();
  });
});

describe("parseCursorPeriodUsage", () => {
  test("reads the included usage percentages and the billing cycle", () => {
    const usage = parseCursorPeriodUsage(PERIOD_BODY);
    expect(usage?.totalPercentUsed).toBe(0);
    expect(usage?.autoPercentUsed).toBe(0);
    expect(usage?.apiPercentUsed).toBeUndefined();
    expect(usage?.cycleStart).toBe(1794029869708);
    expect(usage?.cycleEnd).toBe(1794634669708);
    expect(usage?.onDemand?.limitType).toBe("user");
  });

  test("reads the separate pool percentages when the plan is not merged", () => {
    const usage = parseCursorPeriodUsage({
      ...PERIOD_BODY,
      planUsage: { autoPercentUsed: 30, apiPercentUsed: 80, totalPercentUsed: 55 },
    });
    expect(usage?.autoPercentUsed).toBe(30);
    expect(usage?.apiPercentUsed).toBe(80);
    expect(usage?.totalPercentUsed).toBe(55);
  });

  test("returns nothing for a payload without usage", () => {
    expect(parseCursorPeriodUsage({})).toBeNull();
    expect(parseCursorPeriodUsage(undefined)).toBeNull();
  });
});

describe("parseCursorHardLimit", () => {
  test("reads a finite hard limit in cents", () => {
    expect(parseCursorHardLimit({ hardLimit: 5000 })).toBe(5000);
  });

  test("treats the unlimited hard limit as no limit", () => {
    expect(parseCursorHardLimit({ hardLimit: 2147483647 })).toBeUndefined();
    expect(parseCursorHardLimit({})).toBeUndefined();
  });
});

describe("parseCursorUsageSummary", () => {
  test("reads the plan allowance and the on-demand budget", () => {
    const summary = parseCursorUsageSummary(SUMMARY_BODY);
    expect(summary?.membershipType).toBe("premium");
    expect(summary?.planUsedCents).toBe(0);
    expect(summary?.planLimitCents).toBe(4615);
    expect(summary?.onDemandEnabled).toBe(false);
    expect(summary?.onDemandLimitCents).toBeNull();
    expect(summary?.cycleEnd).toBe(Date.parse("2026-12-01T00:00:00.000Z"));
  });

  test("returns nothing for a payload without usage", () => {
    expect(parseCursorUsageSummary({})).toBeNull();
  });
});

describe("buildCursorUsage", () => {
  test("reports one weekly window for a merged plan", () => {
    const built = buildCursorUsage({
      plan: parseCursorPlanInfo(PLAN_BODY),
      usage: parseCursorPeriodUsage(PERIOD_BODY),
      summary: parseCursorUsageSummary(SUMMARY_BODY),
    });
    expect(built?.planLabel).toBe("Premium");
    expect(built?.period).toBe("weekly");
    expect(built?.primary?.usedPercent).toBe(0);
    expect(built?.primary?.resetsAt).toBe(1794634669708);
    expect(built?.primary?.windowSeconds).toBe(604800);
    expect(built?.extras).toEqual([]);
    expect(built?.onDemand).toBeUndefined();
  });

  test("reports both usage pools for a plan that has them", () => {
    const built = buildCursorUsage({
      plan: parseCursorPlanInfo({ ...PLAN_BODY, isMerged: false }),
      usage: parseCursorPeriodUsage({
        ...PERIOD_BODY,
        planUsage: { autoPercentUsed: 30, apiPercentUsed: 80, totalPercentUsed: 55 },
      }),
      summary: parseCursorUsageSummary(SUMMARY_BODY),
    });
    expect(built?.primary?.usedPercent).toBe(55);
    expect(built?.extras.map((window) => [window.title, window.usedPercent])).toEqual([
      ["Cursor Models", 30],
      ["Other Models", 80],
    ]);
    expect(built?.extras[1]?.resetsAt).toBe(1794634669708);
  });

  test("reports a monthly window for a monthly plan", () => {
    const built = buildCursorUsage({
      plan: parseCursorPlanInfo({
        planInfo: {
          planName: "Ultra",
          includedUsagePeriod: "INCLUDED_USAGE_PERIOD_MONTHLY",
          includedUsageResetsAt: "1796621871487",
        },
        isMerged: true,
      }),
      usage: parseCursorPeriodUsage(PERIOD_BODY),
      summary: parseCursorUsageSummary(SUMMARY_BODY),
    });
    expect(built?.period).toBe("monthly");
    expect(built?.primary?.resetsAt).toBe(1796621871487);
  });

  test("reports the dollar allowance for an enterprise account with no plan usage", () => {
    const built = buildCursorUsage({
      plan: parseCursorPlanInfo(PLAN_BODY),
      usage: parseCursorPeriodUsage({ billingCycleStart: "1", billingCycleEnd: "2" }),
      summary: parseCursorUsageSummary({
        ...SUMMARY_BODY,
        individualUsage: {
          ...SUMMARY_BODY.individualUsage,
          plan: { enabled: true, used: 75055, limit: 80000, remaining: 4945 },
        },
      }),
    });
    expect(built?.primary?.title).toBe("Enterprise");
    expect(built?.primary?.usedPercent).toBeCloseTo(93.8, 1);
    expect(built?.period).toBe("monthly");
  });

  test("reports the on-demand budget when the account has one", () => {
    const built = buildCursorUsage({
      plan: parseCursorPlanInfo(PLAN_BODY),
      usage: parseCursorPeriodUsage(PERIOD_BODY),
      summary: parseCursorUsageSummary({
        ...SUMMARY_BODY,
        individualUsage: {
          ...SUMMARY_BODY.individualUsage,
          onDemand: { enabled: true, used: 2500, limit: 10000, remaining: 7500 },
        },
      }),
    });
    expect(built?.onDemand?.title).toBe("On-demand");
    expect(built?.onDemand?.usedPercent).toBe(25);
    expect(built?.onDemand?.unlimited).toBe(false);
  });

  test("reports an unlimited on-demand budget", () => {
    const built = buildCursorUsage({
      plan: parseCursorPlanInfo(PLAN_BODY),
      usage: parseCursorPeriodUsage(PERIOD_BODY),
      summary: parseCursorUsageSummary({
        ...SUMMARY_BODY,
        individualUsage: {
          ...SUMMARY_BODY.individualUsage,
          onDemand: { enabled: true, used: 2500, limit: null, remaining: null },
        },
      }),
    });
    expect(built?.onDemand?.unlimited).toBe(true);
    expect(built?.onDemand?.usedPercent).toBe(0);
  });

  test("returns nothing when no usage can be read at all", () => {
    expect(buildCursorUsage({ plan: null, usage: null, summary: null })).toBeNull();
  });
});
