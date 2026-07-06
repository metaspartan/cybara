import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sidebarPath = fileURLToPath(
  new URL("../../ui/src/components/layout/Sidebar.tsx", import.meta.url)
);

function readSidebarSource(): string {
  return readFileSync(sidebarPath, "utf8");
}

describe("Sidebar status indicator behavior", () => {
  test("treats every in-turn status event as activity so the glow never flickers", () => {
    const source = readSidebarSource();

    // tool_completed/compacting count too: long silent LLM calls sit between
    // tool rounds, and dropping to idle mid-turn made the glow strobe.
    for (const status of [
      "thinking",
      "generating",
      "tool_executing",
      "tool_completed",
      "compacting",
    ]) {
      expect(source).toContain(`"${status}"`);
    }
    expect(source).toMatch(
      /setStatus\(globalActive \|\| hasActiveSessions \? ["']active["'] : ["']idle["']\)/
    );
    // Generous silence window: no status events arrive during a long model
    // call, and expiring the session mid-turn is what caused the flicker.
    expect(source).toContain("ACTIVE_WINDOW_MS = 60_000");
  });

  test("renders active ring state with a slow pulsing halo", () => {
    const source = readSidebarSource();

    expect(source).toMatch(/status === ["']active["']/);
    expect(source).toContain("ring-2 ring-amber-400/60");
    expect(source).toContain("cybara-activity-pulse");
  });
});
