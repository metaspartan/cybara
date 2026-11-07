import { describe, expect, test } from "bun:test";
import { parseCursorPlanInfo, parseCursorUsage } from "../../src/core/providers/cursor-usage";

const PLAN_BODY = {
  planInfo: {
    planName: "Premium",
    price: "",
    billingCycleEnd: "1796621871487",
    includedUsagePeriod: "INCLUDED_USAGE_PERIOD_WEEKLY",
    includedUsageResetsAt: "1794634669708",
  },
  nextUpgrade: {
    tier: "super",
    name: "Super",
    includedAmountCents: 16159,
    description: "Get more usage with Super",
    dashboardAction: {
      action: "xaiCommercePaywall",
      args: {
        tier: "super",
        entrypoint: "plan_info",
        sku: "sku_WWvZ1VL9fabh",
      },
    },
    includedUsagePeriod: "INCLUDED_USAGE_PERIOD_WEEKLY",
  },
  isMerged: true,
};

const USAGE_BODY = {
  billingCycleStart: "1794029869708",
  billingCycleEnd: "1794634669708",
  planUsage: {
    remainingBonus: false,
    autoPercentUsed: 12,
    totalPercentUsed: 37,
  },
  spendLimitUsage: { limitType: "user" },
  displayThreshold: 200,
  enabled: true,
  displayMessage: "You've used 37% of your included usage",
  autoBucketModels: ["default", "composer-2.5", "grok-4.7"],
};

describe("parseCursorPlanInfo", () => {
  test("reads the plan name and the weekly included usage window", () => {
    const plan = parseCursorPlanInfo(PLAN_BODY);
    expect(plan?.planLabel).toBe("Premium");
    expect(plan?.usagePeriod).toBe("weekly");
    expect(plan?.usageResetsAt).toBe(1794634669708);
  });

  test("reads a monthly included usage window", () => {
    const plan = parseCursorPlanInfo({
      planInfo: { planName: "Pro", includedUsagePeriod: "INCLUDED_USAGE_PERIOD_MONTHLY" },
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

describe("parseCursorUsage", () => {
  test("reads the used percentage and the window it resets on", () => {
    const usage = parseCursorUsage(USAGE_BODY);
    expect(usage?.window?.usedPercent).toBe(37);
    expect(usage?.window?.resetsAt).toBe(1794634669708);
    expect(usage?.window?.windowSeconds).toBe(604800);
  });

  test("keeps a partial window when the cycle bounds are missing", () => {
    const usage = parseCursorUsage({ planUsage: { totalPercentUsed: 5 } });
    expect(usage?.window?.usedPercent).toBe(5);
    expect(usage?.window?.resetsAt).toBeUndefined();
    expect(usage?.window?.windowSeconds).toBeUndefined();
  });

  test("returns nothing when the payload carries no usage", () => {
    expect(parseCursorUsage({})).toBeNull();
    expect(parseCursorUsage({ planUsage: {} })).toBeNull();
    expect(parseCursorUsage(undefined)).toBeNull();
  });

  test("caps a percentage above a hundred at a hundred", () => {
    expect(parseCursorUsage({ planUsage: { totalPercentUsed: 140 } })?.window?.usedPercent).toBe(
      100
    );
  });
});
