import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const environmentPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatEnvironmentOverview.tsx", import.meta.url)
);

describe("chat environment usage summary", () => {
  test("separates active context from cumulative session usage", () => {
    const source = readFileSync(environmentPath, "utf8");

    expect(source).toContain("Active context");
    expect(source).toContain("remaining");
    expect(source).toContain('label="Input"');
    expect(source).toContain('label="Output"');
    expect(source).toContain('label="Model calls"');
    expect(source).toContain('label="Output speed"');
    expect(source).toContain('label="First token"');
    expect(source).toContain('label="Model calls"');
    expect(source).toContain('label="Cache read"');
    expect(source).toContain('label="Cache write"');
    expect(source).toContain("tokenUsage?.firstTokenMs ?? timeToFirstTokenMs");
    expect(source).toContain('label="Compaction"');
    expect(source).not.toContain('label="Compact"');
  });

  test("uses the active theme accent for context pressure", () => {
    const source = readFileSync(environmentPath, "utf8");

    expect(source).toContain("bg-[rgb(var(--accent-primary))]");
    expect(source).toContain("contextPercent");
  });
});
