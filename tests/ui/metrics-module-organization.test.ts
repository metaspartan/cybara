import { describe, expect, test } from "bun:test";

const readPage = (name: string): Promise<string> =>
  Bun.file(new URL(`../../ui/src/pages/${name}`, import.meta.url)).text();

describe("metrics module organization", () => {
  test("keeps the metrics page and presentation components focused", async () => {
    const [page, components, formatting] = await Promise.all([
      readPage("Metrics.tsx"),
      readPage("metrics/MetricsComponents.tsx"),
      readPage("metrics/metricsFormatting.ts"),
    ]);

    expect(page.split("\n").length).toBeLessThanOrEqual(2000);
    expect(components.split("\n").length).toBeLessThanOrEqual(1000);
    expect(page).toContain('from "./metrics/MetricsComponents"');
    expect(page).toContain("<SessionRuntimeTable");
    expect(page).toContain("useMetricsSnapshot");
    expect(page).not.toContain("useMetricsTokenAnalysis");
    expect(page).toContain('aria-label="Metric sections"');
    expect(page).toContain("queryClient.refetchQueries");
    expect(page).toContain('aria-label="Refresh metrics"');
    expect(page).toContain("overview.fileOperations.filesSearched");
    expect(page).toContain('label="Tool Calls"');
    expect(components).toContain("export function SessionRuntimeTable");
    expect(formatting).toContain("export function formatNumber");
    expect(formatting).toContain("export function metricTokenActivityRows");
  });
});
