import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("chat computer-use trajectory lifecycle", () => {
  test("stops only the trajectory owned by the settled chat session", () => {
    const source = readFileSync(join(process.cwd(), "src/core/computer-use.ts"), "utf8");

    expect(source).toContain("stopComputerUseTrajectoryForSession");
    expect(source).toContain("activeComputerUseTrajectory?.sessionId !== normalizedSessionId");
    expect(source).toContain("await stopActiveComputerUseTrajectory(status, error)");
  });

  test("awaits trajectory finalization before draining queued follow-ups", () => {
    const source = readFileSync(join(process.cwd(), "src/api/chat.ts"), "utf8");

    expect(source).toContain('response.interrupted ? "interrupted" : "completed"');
    expect(source).toContain('effectiveSessionId,\n        "error"');
    expect(source).toContain("return finalized;");
    expect(source).toContain(".catch(() => undefined)");
  });
});
