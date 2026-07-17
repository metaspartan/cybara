import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const panelSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/SubagentPanel.tsx", import.meta.url)),
  "utf8"
);
const detailSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/SubagentDetailPanel.tsx", import.meta.url)),
  "utf8"
);
const hookSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/hooks/useApi.ts", import.meta.url)),
  "utf8"
);

describe("subagent live detail", () => {
  test("uses workspace tabs instead of a detail modal", () => {
    expect(panelSource).toContain("onOpenSubagent?.(subagent.id, subagent.label)");
    expect(panelSource).not.toContain('title={selectedSubagent?.label || "Subagent Details"}');
    expect(detailSource).toContain("export function SubagentDetailPanel");
  });

  test("refreshes active detail from child status events with polling recovery", () => {
    expect(detailSource).toContain('event.type !== "status"');
    expect(detailSource).toContain("event.sessionId !== sessionKeyRef.current");
    expect(detailSource).toContain("void refetch()");
    expect(hookSource).toContain("? 2_000\n        : false");
  });

  test("shows live timing, activity, tools, and final output in one panel", () => {
    expect(detailSource).toContain("formatElapsed");
    expect(detailSource).toContain("<SubagentTimeline subagent={subagent}");
    expect(detailSource).toContain("Waiting for the first update");
    expect(detailSource).toContain("Final output");
  });
});
