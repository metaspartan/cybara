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
    expect(source).toContain("For a $20/month coding plan");
    expect(source).toContain("formatTokenPrice(route.priceInputPerM, route.priceOutputPerM)");
    expect(source).toContain("Lowest cost");
  });

  test("providers page renders empty model lists without a stray zero label", () => {
    const source = read("ui/src/pages/Providers.tsx");

    expect(source).toContain("No bundled models listed");
    expect(source).toContain("provider.models.length > 0");
    expect(source).toContain("selectedProviderInfo.models.length > 0");
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
