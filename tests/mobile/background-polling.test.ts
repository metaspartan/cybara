import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dashboard = readFileSync(
  join(import.meta.dir, "../../apps/mobile/src/screens/DashboardScreen.tsx"),
  "utf8"
);

describe("mobile background polling", () => {
  test("dashboard timers pause while the app is inactive", () => {
    expect(dashboard).toContain("const appStateRef = useRef(AppState.currentState)");
    expect(dashboard).toContain("appStateRef.current = state");
    expect(dashboard).toContain('if (appStateRef.current === "active") void refresh(false)');
    expect(dashboard).toContain('if (appStateRef.current === "active") void refreshMetrics()');
  });

  test("dashboard-wide polling pauses while a live chat owns the screen", () => {
    expect(dashboard).toContain('if (detailRoute?.kind === "session") return');
    expect(dashboard).toContain("[detailRoute?.kind, profile.id]");
  });
});
