import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { liveToolFullDetail } from "../../src/core/live-tool-detail";
import {
  formatExpandedToolActivityDetail,
  LIVE_TOOL_DETAIL_LIMITS,
  PERSISTED_TOOL_DETAIL_LIMITS,
  splitToolActivityDetail,
} from "../../shared/tool-activity-detail";

const editDiff = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old line",
  "+new line",
].join("\n");

describe("expanded tool output", () => {
  test("command results show the command and its output", () => {
    const text = formatExpandedToolActivityDetail("exec", { command: "echo hi" }, "result", {
      output: "hi\n",
      exitCode: 0,
    });
    expect(text).toBe('Ran echo hi\n\nArguments:\n{\n  "command": "echo hi"\n}\n\nOutput:\nhi\n');
    expect(splitToolActivityDetail(text ?? "")).toEqual({
      head: "Ran echo hi",
      args: '{\n  "command": "echo hi"\n}',
      output: "hi\n",
    });
  });

  test("non-zero exit codes are visible in the output", () => {
    const text = formatExpandedToolActivityDetail("exec", { command: "false" }, "result", {
      output: "boom",
      exitCode: 2,
    });
    expect(splitToolActivityDetail(text ?? "").output).toBe("boom\n[exit code 2]");
  });

  test("in-flight calls show arguments but no output section", () => {
    const text = formatExpandedToolActivityDetail("exec", { command: "sleep 5" }, "start", {
      output: "ignored",
    });
    expect(text).toBe('Running sleep 5\n\nArguments:\n{\n  "command": "sleep 5"\n}');
    expect(splitToolActivityDetail(text ?? "").output).toBeUndefined();
  });

  test("tools without a custom head still expose their content", () => {
    const text = formatExpandedToolActivityDetail("read", { path: "a.txt" }, "result", {
      path: "a.txt",
      content: "line one\nline two",
    });
    expect(splitToolActivityDetail(text ?? "")).toEqual({
      head: "",
      args: '{\n  "path": "a.txt"\n}',
      output: "line one\nline two",
    });
  });

  test("head-only tools keep their head without a redundant arguments block", () => {
    const text = formatExpandedToolActivityDetail("skill_load", { name: "pdf" }, "result", {
      name: "pdf",
      instructions: "do the thing",
    });
    expect(text).toBe("Loaded pdf skill");
    expect(splitToolActivityDetail(text ?? "").args).toBeUndefined();
  });

  test("structured results without text fields are pretty-printed and stripped of bulk", () => {
    const text = formatExpandedToolActivityDetail("web_search", { query: "q" }, "result", {
      results: [{ title: "T", url: "https://example.com" }],
      snapshot: "/tmp/private.png",
      system_reminder: "do not show",
      thumb: `data:image/png;base64,${"A".repeat(5_000)}`,
    });
    const output = splitToolActivityDetail(text ?? "").output ?? "";
    expect(output).toContain('"title": "T"');
    expect(output).toContain("[data URL omitted");
    expect(output).not.toContain("private.png");
    expect(output).not.toContain("do not show");
    expect(output).not.toContain("AAAAAAAAAA");
  });

  test("errors and blocked calls show the message", () => {
    const text = formatExpandedToolActivityDetail(
      "fetch",
      { url: "u" },
      "error",
      "HTTP 500 upstream"
    );
    expect(splitToolActivityDetail(text ?? "").output).toBe("HTTP 500 upstream");
  });

  test("long output keeps the head and tail within the limit", () => {
    const long = `${"a".repeat(50_000)}TAILMARK`;
    const text = formatExpandedToolActivityDetail(
      "exec",
      { command: "cat big" },
      "result",
      { output: long, exitCode: 0 },
      LIVE_TOOL_DETAIL_LIMITS
    );
    const output = splitToolActivityDetail(text ?? "").output ?? "";
    expect(output.length).toBeLessThan(LIVE_TOOL_DETAIL_LIMITS.outputChars + 100);
    expect(output).toContain("characters omitted");
    expect(output.endsWith("TAILMARK")).toBe(true);
  });

  test("plan, image and skill tools keep their own summaries without an output dump", () => {
    const todo = formatExpandedToolActivityDetail(
      "todo",
      { items: [{ content: "One", status: "completed" }] },
      "result",
      { items: [{ content: "One", status: "completed" }], success: true }
    );
    expect(todo).not.toContain("Output:");
    const skill = formatExpandedToolActivityDetail("skill_load", { name: "x" }, "result", {
      name: "x",
      content: "very long skill body",
    });
    expect(skill ?? "").not.toContain("very long skill body");
  });
});

describe("expanded file edit diffs", () => {
  test("edit results expose the unified diff", () => {
    const text = formatExpandedToolActivityDetail("edit", { path: "src/a.ts" }, "result", {
      success: true,
      change: { path: "src/a.ts", diff: editDiff, addedLines: 1, removedLines: 1 },
    });
    expect(splitToolActivityDetail(text ?? "")).toEqual({
      head: "",
      args: '{\n  "path": "src/a.ts"\n}',
      diff: editDiff,
    });
  });

  test("apply_patch results join every file diff", () => {
    const text = formatExpandedToolActivityDetail("apply_patch", {}, "result", {
      changes: [
        { path: "a", diff: "--- a/a\n+++ b/a\n+one" },
        { path: "b", diff: "--- a/b\n+++ b/b\n+two" },
      ],
    });
    const diff = splitToolActivityDetail(text ?? "").diff ?? "";
    expect(diff).toContain("+one");
    expect(diff).toContain("+two");
  });

  test("oversized diffs are cut on a line boundary", () => {
    const bigDiff = Array.from({ length: 5_000 }, (_, index) => `+line ${index}`).join("\n");
    const text = formatExpandedToolActivityDetail(
      "write",
      { path: "big.txt" },
      "result",
      { change: { diff: bigDiff } },
      LIVE_TOOL_DETAIL_LIMITS
    );
    const diff = splitToolActivityDetail(text ?? "").diff ?? "";
    expect(diff.length).toBeLessThan(LIVE_TOOL_DETAIL_LIMITS.diffChars + 100);
    expect(diff).toContain("more characters omitted");
    expect(diff.split("\n").at(-2)).toMatch(/^\+line \d+$/);
  });

  test("persisted limits keep a large diff intact", () => {
    const diff = Array.from({ length: 2_000 }, (_, index) => `+line ${index}`).join("\n");
    const text = formatExpandedToolActivityDetail(
      "write",
      { path: "big.txt" },
      "result",
      { change: { diff } },
      PERSISTED_TOOL_DETAIL_LIMITS
    );
    expect(splitToolActivityDetail(text ?? "").diff).toBe(diff);
  });

  test("failed edits fall back to the error text", () => {
    const text = formatExpandedToolActivityDetail(
      "edit",
      { path: "a" },
      "error",
      "oldText not found"
    );
    expect(splitToolActivityDetail(text ?? "").output).toBe("oldText not found");
  });
});

describe("live tool detail", () => {
  test("completion events use the raw result, not the model-facing reduced one", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/core/agent-tool-execution.ts", import.meta.url)),
      "utf8"
    );
    expect(source).toContain('fullDetail: liveFullDetail("result", result)');
    expect(source).not.toContain('liveFullDetail("result", finalResult)');
  });

  test("live completion events carry the output and diff", () => {
    const output = liveToolFullDetail("exec", { command: "ls" }, "result", {
      output: "a.txt",
      exitCode: 0,
    });
    expect(output).toBe('Ran ls\n\nArguments:\n{\n  "command": "ls"\n}\n\nOutput:\na.txt');
    const diff = liveToolFullDetail("edit", { path: "src/a.ts" }, "result", {
      change: { diff: editDiff },
    });
    expect(splitToolActivityDetail(diff ?? "").diff).toBe(editDiff);
  });
});
