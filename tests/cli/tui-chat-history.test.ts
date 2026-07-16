import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import {
  defaultTUIConversationExportPath,
  formatTUIConversationExport,
  nextTUITranscriptSearchIndex,
  nthLatestAssistantResponse,
  resolveTUIConversationExportPath,
  searchTUITranscript,
  TranscriptSearchPanel,
  transcriptOffsetForMessage,
  tuiTerminalDiagnosticLines,
  type TUITranscriptMessage,
} from "../../src/cli/tui/components/chat-history";

const messages: TUITranscriptMessage[] = [
  { role: "system", content: "Internal instructions" },
  { role: "user", content: "Review the payment service" },
  { role: "assistant", content: "I found a retry bug in the payment worker." },
  { role: "user", content: "Fix the worker and add regression coverage" },
  {
    role: "assistant",
    content: "The payment worker now retries safely and all tests pass.",
  },
];

describe("CLI TUI transcript history", () => {
  test("searches newest first across user and assistant turns", () => {
    expect(searchTUITranscript(messages, "payment worker")).toEqual([
      {
        messageIndex: 4,
        role: "assistant",
        excerpt: "The payment worker now retries safely and all tests pass.",
      },
      {
        messageIndex: 2,
        role: "assistant",
        excerpt: "I found a retry bug in the payment worker.",
      },
    ]);
    expect(searchTUITranscript(messages, "internal")).toEqual([]);
    expect(searchTUITranscript(messages, "   ")).toEqual([]);
  });

  test("wraps result selection and computes bounded transcript offsets", () => {
    expect(nextTUITranscriptSearchIndex(0, -1, 3)).toBe(2);
    expect(nextTUITranscriptSearchIndex(2, 1, 3)).toBe(0);
    expect(nextTUITranscriptSearchIndex(4, 1, 0)).toBe(0);
    expect(transcriptOffsetForMessage(9, 10, 3)).toBe(0);
    expect(transcriptOffsetForMessage(5, 10, 3)).toBe(4);
    expect(transcriptOffsetForMessage(0, 10, 3)).toBe(7);
    expect(transcriptOffsetForMessage(-5, 0, 3)).toBe(0);
  });

  test("copies numbered assistant responses without counting user turns", () => {
    expect(nthLatestAssistantResponse(messages, 1)).toContain("retries safely");
    expect(nthLatestAssistantResponse(messages, 2)).toContain("retry bug");
    expect(nthLatestAssistantResponse(messages, 3)).toBeNull();
    expect(nthLatestAssistantResponse(messages, 0)).toBeNull();
  });

  test("exports a portable Markdown conversation with useful metadata", () => {
    const output = formatTUIConversationExport(messages, {
      title: "Payment review",
      sessionId: "session-123",
      workspaceDir: "/work/cybara",
      model: "Mini",
    });
    expect(output).toContain("# Payment review");
    expect(output).toContain("- Session: `session-123`");
    expect(output).toContain("- Workspace: `/work/cybara`");
    expect(output).toContain("## User\n\nReview the payment service");
    expect(output).toContain("## Assistant\n\nThe payment worker now retries safely");
    expect(output).not.toContain("Internal instructions");
  });

  test("creates deterministic safe export paths", () => {
    expect(defaultTUIConversationExportPath("session:/123", "/tmp/exports", 0)).toBe(
      "/tmp/exports/cybara-session123-1970-01-01T00-00-00-000Z.md"
    );
    expect(resolveTUIConversationExportPath("nested/chat.md", "/tmp/exports")).toBe(
      "/tmp/exports/nested/chat.md"
    );
  });

  test("reports cross-platform terminal capabilities", () => {
    expect(
      tuiTerminalDiagnosticLines({
        columns: 120,
        rows: 42,
        isTTY: true,
        platform: "win32",
        env: { WT_SESSION: "one", COLORTERM: "truecolor" },
        clipboardCommand: "clip.exe",
      })
    ).toEqual([
      "Terminal Windows Terminal · win32 · local",
      "Viewport 120x42 · truecolor · interactive",
      "Clipboard clip.exe · alternate screen on",
    ]);
  });

  test("renders a bounded search panel around the active result", () => {
    const matches = Array.from({ length: 8 }, (_, index) => ({
      messageIndex: 20 - index,
      role: index % 2 === 0 ? ("assistant" as const) : ("user" as const),
      excerpt: `Result ${index + 1}`,
    }));
    const output = renderToString(
      React.createElement(TranscriptSearchPanel, {
        query: "worker",
        matches,
        selectedIndex: 6,
        compact: false,
      }),
      { columns: 100 }
    );
    expect(output).toContain("Find worker");
    expect(output).toContain("Result 7");
    expect(output).not.toContain("Result 1");
    expect(output).toContain("Enter jump");
  });
});
