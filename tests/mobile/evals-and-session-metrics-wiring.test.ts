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

    expect(api).toContain("forkSession(");
    expect(api).toContain("saveSessionGolden(");
    expect(api).toContain('"/api/metrics/sessions"');
    expect(detail).toContain('label: "Fork chat"');
    expect(detail).toContain('label: "Save golden run"');
    expect(metrics).toContain('title="Chat runtime"');
    expect(metrics).toContain('label="Average TTFT"');
  });
});
