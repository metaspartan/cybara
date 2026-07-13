import { describe, expect, test } from "bun:test";
import { capSessionMessageMetadata } from "../../src/core/session-message-metadata";

describe("persisted session message metadata", () => {
  test("database startup does not replace complete metadata with an elision marker", async () => {
    const source = await Bun.file(new URL("../../src/core/database.ts", import.meta.url)).text();
    expect(source).not.toContain("json_object('elided'");
    expect(source).not.toContain("session_messages size repair");
  });

  test("retains file diffs when unrelated tool output exceeds the metadata budget", () => {
    const diff = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-old\n+new";
    const metadata = JSON.stringify({
      source: "chat_api",
      tool_calls: [
        {
          id: "read-1",
          name: "read",
          args: { path: "src/large.ts" },
          result: { content: "x".repeat(300_000) },
        },
        {
          id: "edit-1",
          name: "edit",
          args: { path: "src/app.ts", oldText: "old", newText: "new" },
          result: {
            success: true,
            path: "src/app.ts",
            change: { path: "src/app.ts", type: "updated", addedLines: 1, removedLines: 1, diff },
          },
        },
      ],
    });

    const persisted = capSessionMessageMetadata(metadata);
    const parsed = JSON.parse(persisted || "{}") as {
      elided?: boolean;
      tool_calls?: Array<{ name?: string; result?: unknown }>;
    };

    expect(parsed.elided).not.toBe(true);
    expect(parsed.tool_calls).toHaveLength(2);
    expect(JSON.stringify(parsed.tool_calls?.[0]?.result)).toContain("persisted preview");
    const editResult = parsed.tool_calls?.[1]?.result as {
      change?: { diff?: string };
    };
    expect(editResult.change?.diff).toBe(diff);
  });

  test("keeps a large unified patch available after persistence", () => {
    const patch = `--- a/src/generated.ts\n+++ b/src/generated.ts\n@@ -0,0 +1,1 @@\n+${"value".repeat(60_000)}`;
    const metadata = JSON.stringify({
      tool_calls: [
        {
          id: "patch-1",
          name: "apply_patch",
          args: { patch },
          result: {
            success: true,
            changes: [
              {
                path: "src/generated.ts",
                type: "updated",
                addedLines: 1,
                removedLines: 0,
                diff: patch,
              },
            ],
          },
        },
      ],
    });

    const persisted = capSessionMessageMetadata(metadata);
    const parsed = JSON.parse(persisted || "{}") as {
      tool_calls?: Array<{
        args?: { patch?: string };
        result?: { changes?: Array<{ diff?: string }> };
      }>;
    };
    expect(parsed.tool_calls?.[0]?.args?.patch).toBe(patch);
    expect(parsed.tool_calls?.[0]?.result?.changes?.[0]?.diff).toBe(patch);
  });

  test("persists screenshot paths without redundant image bytes", () => {
    const metadata = JSON.stringify({
      tool_calls: [
        {
          id: "capture-1",
          name: "computer_use",
          result: JSON.stringify({
            action: "capture",
            ok: true,
            screenshot: "a".repeat(20_000),
            screenshotMime: "image/png",
            filePath: "/Users/test/.cybara/screenshots/screen.png",
          }),
        },
      ],
    });

    const persisted = capSessionMessageMetadata(metadata);
    const parsed = JSON.parse(persisted || "{}") as {
      tool_calls?: Array<{ result?: Record<string, unknown> }>;
    };
    expect(parsed.tool_calls?.[0]?.result).toMatchObject({
      action: "capture",
      filePath: "/Users/test/.cybara/screenshots/screen.png",
      contentType: "image/png",
    });
    expect(parsed.tool_calls?.[0]?.result).not.toHaveProperty("screenshot");
  });
});
