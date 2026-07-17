import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readIdeUiSource } from "../source-fixtures";

const uiSrc = fileURLToPath(new URL("../../ui/src", import.meta.url));
const read = (rel: string) => readFileSync(`${uiSrc}/${rel}`, "utf8");

describe("UI render performance wiring", () => {
  test("Metrics prepares large collections before rendering charts", () => {
    const source = read("pages/Metrics.tsx");

    expect(source).toContain("const tokenCloudEntries = useMemo");
    expect(source).toContain(".slice(0, 60)");
    expect(source).toContain("const visibleProviders = useMemo");
    expect(source).toContain(".slice(0, 12)");
    expect(source).toContain("const modelPerformanceRows = useMemo");
    expect(source).toContain("const maxTps = Math.max(...rows.map((model) => model.avgTps), 1)");
    expect(source).toContain("const activityDayRows = useMemo");
    expect(source).not.toContain("Math.max(...modelMetrics.models.map");
    expect(source).not.toContain("...timeSeries.days.map((d) =>");
  });

  test("Metrics defers expensive detail feeds until after overview render", () => {
    const metricsSource = read("pages/Metrics.tsx");
    const hooksSource = read("hooks/useApi.ts");

    expect(metricsSource).toContain("DETAIL_METRICS_IDLE_DELAY_MS");
    expect(metricsSource).toContain("requestIdleCallback");
    expect(metricsSource).toContain("const detailQueryOptions = useMemo");
    expect(metricsSource).toContain("useMetricsTokenAnalysis(detailQueryOptions)");
    expect(metricsSource).toContain("useMetricsModels(detailQueryOptions)");
    expect(metricsSource).toContain("if (!detailMetricsEnabled) return;");
    expect(hooksSource).toContain("type MetricsQueryControlOptions");
    expect(hooksSource).toContain(
      "useMetricsTokenAnalysis(options: MetricsQueryControlOptions = {})"
    );
    expect(hooksSource).toContain("...options");
  });

  test("Metrics renders per-section skeletons for deferred panels", () => {
    const source = read("pages/Metrics.tsx");
    const components = read("pages/metrics/MetricsComponents.tsx");

    expect(components).toContain("function MetricChartSkeleton");
    expect(components).toContain("function MetricRowsSkeleton");
    expect(components).toContain("function MetricHeatmapSkeleton");
    expect(components).toContain("function MetricCloudSkeleton");
    expect(source).toContain("tokenAnalysisPending ? (");
    expect(source).toContain("providerPlansPending ? (");
    expect(source).toContain("storagePending ? (");
    expect(source).toContain("loading={storagePending}");
    expect(source.indexOf("tokenAnalysisPending ? (")).toBeLessThan(
      source.indexOf('emptyLabel="No token velocity data yet"')
    );
  });

  test("IDE large-file plain overlay only renders the visible line window", () => {
    const source = readIdeUiSource();

    expect(source).toContain("disableTokenizedHighlight");
    expect(source).toContain("visibleLineIndices.map((i) =>");
    expect(source).toContain("height: `${renderedEditorRowCount * lineHeightPx}px`");
    expect(source).toContain("translateY(${gutterStartLine * lineHeightPx}px)");
    expect(source).not.toContain("sourceLines.map((line, i) =>");
  });

  test("IDE explorer filters schedule large tree updates without blocking typing", () => {
    const source = readIdeUiSource();

    expect(source).toContain("useTransition");
    expect(source).toContain('const [treeFilterDraft, setTreeFilterDraft] = useState("")');
    expect(source).toContain(
      "const [isTreeFilterPending, startTreeFilterTransition] = useTransition()"
    );
    expect(source).toContain("startTreeFilterTransition(() => setTreeFilter(nextFilter))");
    expect(source).toContain("value={treeFilterDraft}");
    expect(source).toContain("isTreeFilterPending &&");
  });

  test("Metrics groups automatic provider plan windows into compact provider cards", () => {
    const source = read("pages/Metrics.tsx");

    expect(source).toContain("interface ProviderPlanMetricCard");
    expect(source).toContain("const providerPlanCards = useMemo<ProviderPlanMetricCard[]>");
    expect(source).toContain('providerPlanWindowDisplay(plan, "rolling_5h")');
    expect(source).toContain('providerPlanWindowDisplay(plan, "rolling_week")');
    expect(source).toContain("providerPlanCards.map((plan)");
    expect(source).toContain("grid grid-cols-2 gap-2");
  });
});
