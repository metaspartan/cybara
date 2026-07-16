import { describe, expect, test } from "bun:test";
import {
  environmentSnapshotFromDetail,
  fileChangesFromMessages,
  formatContextUsageLine,
  formatFileChangeLine,
  formatPlanLine,
  formatTokenUsageLine,
  lspServersFromResponse,
  subagentsFromResponse,
  tasksFromResponse,
} from "../../src/cli/tui/chat-environment";

describe("CLI TUI environment helpers", () => {
  test("normalizes session detail into context, token, plan, and diff summaries", () => {
    const snapshot = environmentSnapshotFromDetail({
      workspace_dir: "/Users/carsen/Documents/GitHub/cybara",
      gitBranch: "main",
      contextUsage: {
        tokensUsed: 120_500,
        contextWindow: 256_000,
        compactionCount: 2,
        compactedTokens: 48_000,
      },
      tokenUsage: {
        inputTokens: 10_000,
        outputTokens: 2_400,
        tokensPerSecond: 18.249,
        callCount: 3,
      },
      plan: {
        items: [
          { content: "Audit CLI controls", status: "completed" },
          { content: "Add environment panel", status: "in_progress" },
          { content: "Verify in terminal", status: "pending" },
        ],
      },
      messagesList: [
        {
          process_activities: [{ text: "Edited src/cli/index.tsx +12 -3" }],
          tool_calls: [
            {
              name: "edit",
              args: {
                path: "src/cli/tui/components/chat.tsx",
                oldText: "old\ntext",
                newText: "new\ntext\nhere",
              },
            },
          ],
        },
      ],
    });

    expect(snapshot.workspaceDir).toBe("/Users/carsen/Documents/GitHub/cybara");
    expect(snapshot.gitBranch).toBe("main");
    expect(snapshot.contextUsage?.percentage).toBe(47);
    expect(snapshot.contextUsage?.compactionCount).toBe(2);
    expect(snapshot.tokenUsage?.tokensPerSecond).toBe(18.25);
    expect(snapshot.plan?.summary).toEqual({ completed: 1, total: 3 });
    expect(snapshot.fileChanges?.files.map((file) => file.path)).toEqual([
      "src/cli/index.tsx",
      "src/cli/tui/components/chat.tsx",
    ]);
    expect(formatContextUsageLine(snapshot.contextUsage)).toContain("compacted 2x");
    expect(formatTokenUsageLine(snapshot.tokenUsage)).toContain("18.25 tok/s");
    expect(formatPlanLine(snapshot.plan)).toContain("1/3 complete");
    expect(formatFileChangeLine(snapshot.fileChanges)).toContain("2 files");
  });

  test("extracts file changes from structured tool results", () => {
    const changes = fileChangesFromMessages([
      {
        tool_calls: [
          {
            result: {
              changes: [
                { path: "src/a.ts", addedLines: 2, removedLines: 1 },
                { path: "src/b.ts", plus: 5, minus: 0 },
              ],
            },
          },
        ],
      },
    ]);

    expect(changes?.totalAdded).toBe(7);
    expect(changes?.totalRemoved).toBe(1);
    expect(changes?.files[0]?.type).toBe("updated");
    expect(changes?.files[1]?.type).toBe("created");
  });

  test("deduplicates activity summaries against workspace-relative tool changes", () => {
    const changes = fileChangesFromMessages(
      [
        {
          process_activities: [
            { text: "Edited app.js +182 -0" },
            { text: "Edited styles.css +48 -3" },
          ],
          tool_calls: [
            {
              result: {
                changes: [
                  { path: "C:\\Projects\\dashboard\\app.js", addedLines: 182, removedLines: 0 },
                  {
                    path: "C:\\Projects\\dashboard\\styles.css",
                    addedLines: 48,
                    removedLines: 3,
                  },
                ],
              },
            },
          ],
        },
      ],
      "c:\\projects\\dashboard"
    );

    expect(changes?.files).toEqual([
      { path: "app.js", added: 182, removed: 0, type: "created" },
      { path: "styles.css", added: 48, removed: 3, type: "updated" },
    ]);
    expect(changes?.totalAdded).toBe(230);
    expect(changes?.totalRemoved).toBe(3);
  });

  test("normalizes task and subagent API responses", () => {
    expect(
      tasksFromResponse({
        tasks: [
          { id: "task-1", title: "Review UI", status: "active", priority: "high" },
          { name: "Backfill tests", status: "queued" },
        ],
      })
    ).toEqual([
      { id: "task-1", title: "Review UI", status: "active", priority: "high" },
      { id: "Backfill tests", title: "Backfill tests", status: "queued", priority: undefined },
    ]);

    expect(
      subagentsFromResponse({
        subagents: [
          { id: "sub-1", label: "Tester", status: "running" },
          { subagentId: "sub-2", task: "Audit CLI", status: "done" },
        ],
      })
    ).toEqual([
      { id: "sub-1", label: "Tester", status: "running" },
      { id: "sub-2", label: "Audit CLI", status: "done" },
    ]);
  });

  test("normalizes only initialized LSP servers", () => {
    expect(
      lspServersFromResponse({
        active: [
          { id: "vtsls", name: "TypeScript", command: "vtsls", initialized: true },
          { id: "yaml", name: "YAML", command: "yaml-language-server", initialized: false },
          { id: "shellscript", command: "bash-language-server" },
          null,
        ],
      })
    ).toEqual([
      { id: "vtsls", name: "TypeScript", command: "vtsls" },
      { id: "shellscript", name: "shellscript", command: "bash-language-server" },
    ]);
    expect(lspServersFromResponse(null)).toEqual([]);
  });
});
