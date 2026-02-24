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
  test("treats generating and tool execution events as active status", () => {
    const source = readSidebarSource();

    expect(source).toContain("'generating'");
    expect(source).toContain("'tool_executing'");
    expect(source).toContain("'tool_completed'");
    expect(source).toContain("setStatus(globalActive || hasActiveSessions ? 'active' : 'idle')");
  });

  test("renders active ring state from unified active status", () => {
    const source = readSidebarSource();

    expect(source).toContain("status === 'active'");
    expect(source).toContain("ring-2 ring-amber-400/60");
  });
});
