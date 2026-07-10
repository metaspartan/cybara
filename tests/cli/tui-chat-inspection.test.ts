import { describe, expect, test } from "bun:test";
import {
  compactInspectionLines,
  logLines,
  mcpStatusLines,
  memoryStatusLine,
  skillStatusLines,
} from "../../src/cli-tui-chat-inspection";

describe("TUI chat inspection formatters", () => {
  test("formats skill eligibility and ignores malformed entries", () => {
    expect(
      skillStatusLines({
        skills: [
          { name: "code-review", eligible: true },
          { name: "deploy", eligible: false },
          { name: "disabled", disabled: true },
          null,
        ],
      })
    ).toEqual(["* code-review · ready", "- deploy · blocked", "- disabled · disabled"]);
    expect(skillStatusLines(null)).toEqual([]);
  });

  test("formats MCP status and tool counts", () => {
    expect(
      mcpStatusLines([
        { id: "local", name: "Local tools", status: "running", toolCount: 4 },
        { id: "stopped" },
      ])
    ).toEqual(["* Local tools · running · 4 tools", "- stopped · stopped"]);
  });

  test("summarizes memory status across current response shapes", () => {
    expect(
      memoryStatusLine(
        { files: 7, chunks: 42, configuredProvider: "local-transformers" },
        { memories: [{}, {}, {}] }
      )
    ).toBe("Memory 3 files · 42 indexed chunks · local-transformers");
    expect(memoryStatusLine(null, null)).toBe("Memory 0 files · 0 indexed chunks · local");
  });

  test("formats logs and bounds long inspection output", () => {
    const lines = logLines([
      { level: "warn", module: "Gateway", message: "Connection recovered" },
      { source: "Agent", message: "Turn completed" },
      { level: "debug" },
    ]);
    expect(lines).toEqual(["WARN  Gateway · Connection recovered", "INFO  Agent · Turn completed"]);
    expect(compactInspectionLines(["one", "two", "three"], 2)).toBe("one\ntwo\n… 1 more");
  });
});
