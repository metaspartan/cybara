import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();

describe("mobile eval and session runtime parity", () => {
  test("exposes fork, golden, and session metrics through the native chat surfaces", () => {
    const api = readFileSync(join(root, "apps/mobile/src/lib/api.ts"), "utf8");
    const detail = readFileSync(
      join(root, "apps/mobile/src/screens/dashboardSessionDetail.tsx"),
      "utf8"
    );
    const metrics = readFileSync(
      join(root, "apps/mobile/src/screens/dashboardMetricsPanels.tsx"),
      "utf8"
    );
    const evals = readFileSync(
      join(root, "apps/mobile/src/screens/dashboardEvalsPanel.tsx"),
      "utf8"
    );
    const settings = readFileSync(
      join(root, "apps/mobile/src/screens/dashboardDetailPanels.tsx"),
      "utf8"
    );

    expect(api).toContain("forkSession(");
    expect(api).toContain("saveSessionGolden(");
    expect(api).toContain("exportEvals(");
    expect(api).toContain("importEvals(");
    expect(api).toContain("replayEval(");
    expect(api).toContain("async metricsSessions(");
    expect(api).toContain("pageSize = 10");
    expect(api).toContain("/api/metrics/sessions?page=");
    expect(api).toContain("pageSize=${encodeURIComponent(String(pageSize))}");
    expect(detail).toContain('label: "Fork chat"');
    expect(detail).toContain('label: "Save golden run"');
    expect(metrics).toContain('title="Chat runtime"');
    expect(metrics).toContain('label="Average TTFT"');
    expect(metrics).toContain('label="Input"');
    expect(metrics).toContain('label="Output"');
    expect(metrics).toContain('label="Cache read"');
    expect(metrics).toContain('label="Cache write"');
    expect(metrics).toContain('label="Compacted"');
    expect(metrics).toContain("loadSessionRuntimePage");
    expect(metrics).toContain("sessionPagination.totalPages");
    expect(evals).toContain("Copy redacted eval JSONL");
    expect(evals).toContain("Copy replayable eval suite");
    expect(evals).toContain("Import eval suite from clipboard");
    expect(evals).toContain("api.config()");
    expect(evals).toContain("Enable Lab");
    expect(evals).toContain("Golden turn actions");
    expect(evals).toContain("Capture completed turns");
    expect(evals).toContain("Redact exports by default");
    expect(evals).toContain('exportResearch("distillation_sft")');
    expect(settings).toContain("<MobileEvalsPanel");
  });
});
