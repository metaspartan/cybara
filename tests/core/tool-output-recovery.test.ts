import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import { basename, dirname } from "path";
import {
  formatRecoverableToolOutputPreview,
  persistToolOutputForRecovery,
} from "../../src/core/tool-output-recovery";
import { assertReadablePath } from "../../src/core/tools/path-policy";

describe("tool output recovery", () => {
  test("writes the full oversized output to a private readable cache file", () => {
    const output = `head\n${"middle-line\n".repeat(2000)}tail`;
    const preview = formatRecoverableToolOutputPreview(output, 500, {
      sessionId: "../session with spaces",
      toolName: "exec/shell",
      toolCallId: "call:1",
    });

    expect(preview.truncated).toBe(true);
    expect(preview.content).toContain("Full output saved to:");
    expect(preview.content).toContain("offset/limit");
    expect(preview.outputPath).toBeTruthy();
    expect(existsSync(preview.outputPath!)).toBe(true);
    expect(readFileSync(preview.outputPath!, "utf8")).toBe(output);
    expect(() => assertReadablePath(preview.outputPath)).not.toThrow();
    expect(basename(dirname(preview.outputPath!))).toBe("session-with-spaces");
    expect(basename(preview.outputPath!)).toContain("exec-shell-call-1");

    rmSync(preview.outputPath!, { force: true });
  });

  test("does not write a cache file when output fits the prompt budget", () => {
    const preview = formatRecoverableToolOutputPreview("small output", 500, {
      sessionId: "small-session",
      toolName: "read",
    });

    expect(preview).toEqual({ content: "small output", truncated: false });
  });

  test("sanitizes path segments for direct persistence", () => {
    const path = persistToolOutputForRecovery({
      content: "payload",
      sessionId: "../../session",
      toolName: "grep && rm -rf",
      toolCallId: "call/1",
      now: new Date("2026-07-09T00:00:00.000Z"),
    });

    expect(path).toBeTruthy();
    expect(path).not.toContain("../");
    expect(basename(dirname(path!))).toBe("session");
    expect(basename(path!)).toContain("grep-rm-rf-call-1");
    expect(readFileSync(path!, "utf8")).toBe("payload");

    rmSync(path!, { force: true });
  });
});
