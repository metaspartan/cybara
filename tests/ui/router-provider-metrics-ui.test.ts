import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("router, provider, and metrics UI wiring", () => {
  test("native selects keep readable option colors across Tauri themes", () => {
    const selectSource = read("ui/src/components/ui/Select.tsx");
    const cssSource = read("ui/src/index.css");

    expect(selectSource).toContain("themed-form-control");
    expect(selectSource).not.toContain("[color-scheme:dark]");
    expect(selectSource).not.toContain('className="bg-[#0f0f16] text-white"');
    expect(cssSource).toContain("select option,");
    expect(cssSource).toContain("background-color: var(--form-control-popover);");
    expect(cssSource).toContain("color: var(--form-control-text);");
    expect(cssSource).toContain("select option:checked");
    expect(cssSource).toContain("html.light select");
  });

  test("router page exposes strategy cards plus daily and monthly cash budgets", () => {
    const source = read("ui/src/pages/RouterSettings.tsx");

    expect(source).toContain("const STRATEGY_OPTIONS");
    expect(source).toContain("Monthly budget");
    expect(source).toContain("globalSpendLimitDaily: monthly ? monthly / 30 : undefined");
    expect(source).toContain("Plan-aware routing");
    expect(source).toContain("Optional manual plan fallback");
    expect(source).toContain("manualPlanEditable");
    expect(source).toContain("Plan usage is automatic");
    expect(source).toContain("No manual plan limits are needed for routing decisions");
    expect(source).toContain("providerPlanWindowDisplay");
    expect(source).toContain("providerPlanUsageClasses");
    expect(source).toContain("presetLimitSummary(preset)");
    expect(source).toContain("Array.isArray(p.info?.models)");
    expect(source).toContain(
      "displayName={route.targetName || plan?.providerName || providerName(routeType)}"
    );
    expect(source).toContain("formatTokenPrice(route.priceInputPerM, route.priceOutputPerM)");
    expect(source).toContain("Lowest cost");
  });

  test("router plan polling is slower than route health polling and guarded while loading", () => {
    const source = read("ui/src/pages/RouterSettings.tsx");

    expect(source).toContain("const statusInterval = setInterval(refreshStatus, 5000)");
    expect(source).toContain("const planInterval = setInterval(refreshPlans, 15000)");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain("if (!planConfig) return Promise.resolve()");
    expect(source).toContain("disabled={!planConfigLoaded}");
    expect(source).toContain("planStatusLoaded");
    expect(source).toContain("planSummary?.configured || 0");
    expect(source).toContain("planSummary?.monitored || 0");
  });

  test("providers page renders empty model lists without a stray zero label", () => {
    const source = read("ui/src/pages/Providers.tsx");
    const poolsSource = read("ui/src/components/providers/ProviderAccountPools.tsx");
    const displaySource = read("ui/src/lib/providerPlanDisplay.ts");

    expect(source).toContain("import { ProviderAccountPools }");
    expect(source).toContain("<ProviderAccountPools");
    expect(poolsSource).toContain("Account pools");
    expect(poolsSource).toContain("automatic usage");
    expect(poolsSource).toContain("balancing and failover");
    expect(poolsSource).toContain("Model Router route");
    expect(source).toContain("No bundled models listed");
    expect(source).toContain("provider.models.length > 0");
    expect(source).toContain("selectedProviderInfo.models.length > 0");
    expect(source).toContain("function isProviderDefault");
    expect(source).toContain("defaultChecked={isProviderDefault(provider)}");
    expect(source).toContain("ProviderPlanUsagePill");
    expect(source).toContain("providerPlanWindowDisplay");
    expect(source).toContain("providerPlanUsageClasses");
    expect(source).toContain("min-w-[112px]");
    expect(source).toContain("rounded-lg border px-3 py-2");
    expect(source).toContain("h-1.5 w-full");
    expect(source).toContain("rounded-md bg-white/10");
    expect(source).toContain('label="5h"');
    expect(source).toContain('label="Weekly"');
    expect(source).toContain("usage.resetLabel");
    expect(displaySource).toContain('value: "∞"');
    expect(displaySource).toContain("formatProviderPlanReset");
    expect(displaySource).toContain("Math.ceil(window.usedPercent)");
    expect(displaySource).toContain("export function providerPlanUsageLevel");
    expect(displaySource).toContain('if (usage.percent < 40) return "green"');
    expect(displaySource).toContain('if (usage.percent < 65) return "blue"');
    expect(displaySource).toContain('if (usage.percent < 80) return "yellow"');
    expect(displaySource).toContain('if (usage.percent < 95) return "orange"');
    expect(displaySource).toContain('fillClass: "bg-sky-300"');
    expect(displaySource).toContain('fillClass: "bg-yellow-300"');
    expect(displaySource).toContain('fillClass: "bg-orange-300"');
    expect(displaySource).toContain('fillClass: "bg-red-300"');
    expect(source).toContain("Plan usage is automatic");
    expect(source).toContain("manualPlanEditable");
    expect(source).toContain(
      "Live provider usage is used for routing. No manual plan limits are needed."
    );
  });

  test("metrics page includes token velocity and provider/model share views", () => {
    const source = read("ui/src/pages/Metrics.tsx");

    expect(source).toContain("const tokenVelocityRows = useMemo");
    expect(source).toContain("const providerTokenRows = useMemo");
    expect(source).toContain("const modelTokenRows = useMemo");
    expect(source).toContain("<MetricAreaChart");
    expect(source).toContain("Provider Token Share");
    expect(source).toContain("Model Token Share");
    expect(source).toContain("providerPlanUsageClasses(usage)");
    expect(source).toContain('label: "5h"');
    expect(source).toContain('label: "Weekly"');
    expect(source).toContain('providerPlanWindowDisplay(plan, "rolling_5h")');
    expect(source).toContain('providerPlanWindowDisplay(plan, "rolling_week")');
  });

  test("usage page is a primary destination and renders compact automatic provider limits", () => {
    const app = read("ui/src/App.tsx");
    const sidebar = read("ui/src/components/layout/Sidebar.tsx");
    const usage = read("ui/src/pages/Usage.tsx");

    expect(app).toContain('path="/usage"');
    expect(app).toContain("element={<Usage />}");
    expect(sidebar).toContain('{ path: "/usage", icon: Gauge, labelKey: "nav.usage" }');
    expect(sidebar).not.toContain("requiresUsage");
    expect(sidebar).not.toContain("providerPlansApi.availability()");
    expect(sidebar).not.toContain("setUsageAvailable");
    expect(usage).toContain('providerPlanWindowDisplay(plan, "rolling_5h")');
    expect(usage).toContain('providerPlanWindowDisplay(plan, "rolling_week")');
    expect(usage).toContain("providerPlanUsageClasses(usage)");
    expect(usage).toContain("UsageProviderCard");
    expect(usage).toContain("UsageSkeleton");
    expect(usage).toContain("No automatic usage yet");
    expect(usage).toContain("refetchInterval: 30_000");
    expect(usage).toContain('queryKey: ["provider-plan-status"]');
    expect(usage).not.toContain("RefreshCw");
    expect(usage).not.toContain(">Refresh<");
    expect(usage).not.toContain("browser_cookie");
    expect(usage).not.toContain("sourceMode");
  });
});
