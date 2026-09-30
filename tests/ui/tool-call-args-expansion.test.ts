import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatExpandedToolActivityDetail,
  formatToolCallArgs,
  PERSISTED_TOOL_DETAIL_LIMITS,
  splitToolActivityDetail,
  TOOL_ARGS_HEADING,
} from "../../shared/tool-activity-detail";
import { leadingLines } from "../../ui/src/pages/chat/ToolActivityBody";

function readUiSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../ui/src/${path}`, import.meta.url)), "utf8");
}

describe("expanded tool call arguments", () => {
  test("a call with arguments now renders an Arguments section", () => {
    const detail = formatExpandedToolActivityDetail(
      "decision_evaluate",
      { state: "payouts failing", questions: { urgent: { type: "noul" } } },
      "result",
      { ok: true }
    );
    expect(detail).toBeDefined();
    expect(detail).toContain(TOOL_ARGS_HEADING);
    const parts = splitToolActivityDetail(detail ?? "");
    expect(parts.args).toBeDefined();
    const parsed = JSON.parse(parts.args ?? "") as Record<string, unknown>;
    expect(parsed.state).toBe("payouts failing");
    expect((parsed.questions as Record<string, { type: string }>).urgent.type).toBe("noul");
  });

  test("arguments are pretty printed JSON, not a single line", () => {
    const text = formatToolCallArgs({ path: "a.ts", limit: 20 }) ?? "";
    const body = text.split("\n").slice(1).join("\n");
    expect(body).toContain('\n  "path"');
    expect(body).toContain('\n  "limit"');
  });

  test("head, arguments and output all survive the split", () => {
    const detail = formatExpandedToolActivityDetail("exec", { command: "ls -la" }, "result", {
      output: "a.txt\nb.txt",
    });
    const parts = splitToolActivityDetail(detail ?? "");
    expect(parts.head).toBe("Ran ls -la");
    expect(JSON.parse(parts.args ?? "")).toEqual({ command: "ls -la" });
    expect(parts.output).toBe("a.txt\nb.txt");
  });

  test("file edits keep the diff alongside the arguments", () => {
    const diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b";
    const detail = formatExpandedToolActivityDetail(
      "edit",
      { path: "x.ts", old_string: "a", new_string: "b" },
      "result",
      { change: { path: "x.ts", diff } }
    );
    const parts = splitToolActivityDetail(detail ?? "");
    expect(parts.diff).toBe(diff);
    expect(JSON.parse(parts.args ?? "")).toMatchObject({ path: "x.ts" });
  });

  test("a call with no arguments omits the section", () => {
    expect(formatToolCallArgs({})).toBeUndefined();
    const detail = formatExpandedToolActivityDetail("ping", {}, "result", { output: "pong" });
    expect(detail).not.toContain(TOOL_ARGS_HEADING);
    expect(splitToolActivityDetail(detail ?? "").args).toBeUndefined();
  });

  test("a single huge argument value is summarized, not dumped", () => {
    const blob = "z".repeat(60_000);
    const body = (formatToolCallArgs({ blob }) ?? "").split("\n").slice(1).join("\n");
    expect(body.length).toBeLessThan(blob.length);
    expect(body).toContain("more characters]");
    expect(body.length).toBeLessThan(10_000);
  });

  test("a many-key payload is clipped at the arguments limit", () => {
    const wide: Record<string, string> = {};
    for (let index = 0; index < 2_000; index += 1) wide[`key_${index}`] = `value_${index}`;
    const body = (formatToolCallArgs(wide) ?? "").split("\n").slice(1).join("\n");
    expect(body.length).toBeLessThanOrEqual(PERSISTED_TOOL_DETAIL_LIMITS.argsChars + 200);
    expect(body).toContain("more characters omitted");
  });

  test("nested argument values stay bounded too", () => {
    const nested = { level1: { level2: { level3: { payload: "q".repeat(50_000) } } } };
    const body = (formatToolCallArgs(nested) ?? "").split("\n").slice(1).join("\n");
    expect(body.length).toBeLessThan(50_000);
  });

  test("data URLs in arguments are summarized, not dumped", () => {
    const body = (formatToolCallArgs({ image: `data:image/png;base64,${"A".repeat(9_000)}` }) ?? "")
      .split("\n")
      .slice(1)
      .join("\n");
    expect(body).toContain("data URL omitted");
    expect(body).not.toContain("AAAAAAAAAA");
  });

  test("start phase calls still expose their arguments", () => {
    const detail = formatExpandedToolActivityDetail("read", { path: "notes.md" }, "start");
    expect(detail).toContain(TOOL_ARGS_HEADING);
    expect(splitToolActivityDetail(detail ?? "").args).toContain("notes.md");
  });

  test("an output body containing a heading is not mis-split", () => {
    const parts = splitToolActivityDetail(
      `Ran x\n\n${TOOL_ARGS_HEADING}\n{\n  "a": 1\n}\n\nOutput:\nline\n\nOutput:\nnot a new section`
    );
    expect(parts.args).toContain('"a": 1');
    expect(parts.output).toContain("not a new section");
  });

  test("long argument payloads collapse to a show-all affordance", () => {
    const long = Array.from({ length: 400 }, (_, i) => `  "k${i}": "v${i}"`).join("\n");
    const preview = leadingLines(`{\n${long}\n}`, 200);
    expect(preview.text.length).toBeLessThan(long.length);
    expect(preview.total).toBe(402);
  });
});

describe("tool activity body wiring", () => {
  test("renders an Arguments block with a code surface and a copy control", () => {
    const source = readUiSource("pages/chat/ToolActivityBody.tsx");
    expect(source).toContain('data-testid="activity-args-body"');
    expect(source).toContain('data-testid="activity-args-code"');
    expect(source).toContain("chat-code-surface");
    expect(source).toContain("font-mono");
    expect(source).toContain('data-testid="activity-copy-button"');
    expect(source).toContain("navigator.clipboard");
  });

  test("labels the sections it owns without duplicating the diff header", () => {
    const source = readUiSource("pages/chat/ToolActivityBody.tsx");
    expect(source).toContain("Arguments");
    expect(source).toContain("Output");
    expect(source).not.toContain("<SectionLabel>Diff</SectionLabel>");
  });

  test("the timeline passes the arguments section through", () => {
    const source = readUiSource("pages/chat/ActivityTimeline.tsx");
    expect(source).toContain("detailParts?.args");
    expect(source).toContain("args={detailParts.args}");
  });

  test("a tool call with only arguments is still expandable", () => {
    const source = readUiSource("pages/chat/ActivityTimeline.tsx");
    expect(source).toContain("detailParts?.args || detailParts?.output || detailParts?.diff");
  });
});
