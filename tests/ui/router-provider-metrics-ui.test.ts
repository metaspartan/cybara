import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("router, provider, and metrics UI wiring", () => {
  test("native selects force dark readable option colors for Tauri Windows", () => {
    const selectSource = read("ui/src/components/ui/Select.tsx");
    const cssSource = read("ui/src/index.css");

    expect(selectSource).toContain("[color-scheme:dark]");
    expect(selectSource).toContain('className="bg-[#0f0f16] text-white"');
    expect(cssSource).toContain("select option,");
    expect(cssSource).toContain("background-color: #0f0f16;");
    expect(cssSource).toContain("select option:checked");
  });

  test("router page exposes strategy cards plus daily and monthly cash budgets", () => {
    const source = read("ui/src/pages/RouterSettings.tsx");

    expect(source).toContain("const STRATEGY_OPTIONS");
    expect(source).toContain("Monthly budget");
    expect(source).toContain("globalSpendLimitDaily: monthly ? monthly / 30 : undefined");
    expect(source).toContain("Plan-aware routing");
    expect(source).toContain("Coding plan preset");
    expect(source).toContain("manualPlanEditable");
    expect(source).toContain("Plan tracked automatically");
    expect(source).toContain("presetLimitSummary(preset)");
    expect(source).toContain("Array.isArray(p.info?.models)");
    expect(source).toContain("displayName={plan?.providerName || providerName(routeType)}");
    expect(source).toContain("formatTokenPrice(route.priceInputPerM, route.priceOutputPerM)");
    expect(source).toContain("Lowest cost");
  });

  test("router plan polling is slower than route health polling and guarded while loading", () => {
    const source = read("ui/src/pages/RouterSettings.tsx");

    expect(source).toContain("const statusInterval = setInterval(() => void fetchStatus(), 5000)");
    expect(source).toContain(
      "const planInterval = setInterval(() => void fetchPlanStatus(), 15000)"
    );
    expect(source).toContain("if (!planConfig) return Promise.resolve()");
    expect(source).toContain("disabled={!planConfigLoaded}");
    expect(source).toContain("planStatusLoaded");
    expect(source).toContain("planSummary?.configured || 0");
    expect(source).toContain("planSummary?.monitored || 0");
  });

  test("providers page renders empty model lists without a stray zero label", () => {
    const source = read("ui/src/pages/Providers.tsx");
    const displaySource = read("ui/src/lib/providerPlanDisplay.ts");

    expect(source).toContain("No bundled models listed");
    expect(source).toContain("provider.models.length > 0");
    expect(source).toContain("selectedProviderInfo.models.length > 0");
    expect(source).toContain("function isProviderDefault");
    expect(source).toContain("defaultChecked={isProviderDefault(provider)}");
    expect(source).toContain("ProviderPlanUsagePill");
    expect(source).toContain("providerPlanWindowDisplay");
    expect(source).toContain('label="5h"');
    expect(source).toContain('label="Weekly"');
    expect(source).toContain("usage.resetLabel");
    expect(displaySource).toContain('value: "∞"');
    expect(displaySource).toContain("formatProviderPlanReset");
    expect(displaySource).toContain("Math.ceil(window.usedPercent)");
    expect(source).toContain("Plan tracked automatically");
    expect(source).toContain("manualPlanEditable");
    expect(source).toContain(
      "Manual plan caps are hidden because this provider reports plan usage"
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
  });
});
