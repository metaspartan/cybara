import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  enrichActivitiesWithToolCallDetails,
  type LiveActivityItem,
} from "../../ui/src/lib/chatActivities";
import { leadingLines } from "../../ui/src/pages/chat/ToolActivityBody";
import { splitToolActivityDetail } from "../../shared/tool-activity-detail";

function readUiSource(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../ui/src/${path}`, import.meta.url)), "utf8");
}

const commandActivity: LiveActivityItem = {
  id: "a1",
  phase: "result",
  text: "Ran ls",
  timestamp: 1,
  toolName: "exec",
  toolCallId: "gateway-1",
};

describe("persisted tool activities", () => {
  test("carry the output and the id of the matched call", () => {
    const [enriched] = enrichActivitiesWithToolCallDetails(
      [commandActivity],
      [
        {
          id: "provider-1",
          name: "exec",
          args: { command: "ls" },
          status: "completed",
          result: { output: "a.txt\nb.txt", exitCode: 0 },
        },
      ]
    );
    expect(splitToolActivityDetail(enriched?.fullText ?? "")).toEqual({
      head: "Ran ls",
      args: '{\n  "command": "ls"\n}',
      output: "a.txt\nb.txt",
    });
    expect(enriched?.detailCallId).toBe("provider-1");
  });

  test("file edits become expandable with their diff", () => {
    const diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b";
    const [enriched] = enrichActivitiesWithToolCallDetails(
      [{ ...commandActivity, text: "Edited x.ts +1 -1", toolName: "edit", toolCallId: "e1" }],
      [
        {
          id: "e1",
          name: "edit",
          args: { path: "x.ts" },
          status: "completed",
          result: { change: { path: "x.ts", addedLines: 1, removedLines: 1, diff } },
        },
      ]
    );
    expect(enriched?.text).toBe("Edited x.ts +1 -1");
    expect(splitToolActivityDetail(enriched?.fullText ?? "").diff).toBe(diff);
  });

  test("failed calls surface their error", () => {
    const [enriched] = enrichActivitiesWithToolCallDetails(
      [{ ...commandActivity, phase: "error", text: "Command failed" }],
      [{ id: "f1", name: "exec", args: { command: "ls" }, status: "failed", error: "spawn ENOENT" }]
    );
    expect(splitToolActivityDetail(enriched?.fullText ?? "").output).toBe("spawn ENOENT");
  });
});

describe("leadingLines", () => {
  test("returns short text untouched", () => {
    expect(leadingLines("a\nb", 5)).toEqual({ text: "a\nb", total: 2 });
    expect(leadingLines("a\nb\nc", 3)).toEqual({ text: "a\nb\nc", total: 3 });
  });

  test("cuts long text after the requested lines", () => {
    const text = Array.from({ length: 1_000 }, (_, index) => `l${index}`).join("\n");
    const preview = leadingLines(text, 300);
    expect(preview.total).toBe(1_000);
    expect(preview.text.split("\n")).toHaveLength(300);
    expect(preview.text.endsWith("l299")).toBe(true);
  });
});

describe("expanded rendering contract", () => {
  const timeline = readUiSource("pages/chat/ActivityTimeline.tsx");

  test("arguments, output and diff render only while a row is expanded", () => {
    expect(timeline).toContain("const detailText = expanded ?");
    expect(timeline).toContain(
      "{expanded && (detailParts?.args || detailParts?.output || detailParts?.diff) ? ("
    );
    expect(timeline).toContain("args={detailParts.args}");
    expect(timeline).toContain("output={detailParts.output}");
    expect(timeline).toContain("diff={detailParts.diff}");
  });

  test("completed rows fetch the untruncated call only after expansion", () => {
    expect(timeline).toContain("if (!expanded || !eligible");
    expect(timeline).toContain("loadToolCallDetail(source, callId, phase)");
    expect(readUiSource("pages/chat/AssistantMetaInline.tsx")).toContain(
      "<ToolDetailSourceContext.Provider value={toolDetailSource}>"
    );
  });

  test("the body is memoized and long diffs are previewed", () => {
    const body = readUiSource("pages/chat/ToolActivityBody.tsx");
    expect(body).toContain("memo(function ToolActivityBody");
    expect(body).toContain("DIFF_PREVIEW_LINES = 300");
    expect(body).toContain("max-h-72 overflow-auto");
  });
});
