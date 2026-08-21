import { describe, expect, test } from "bun:test";
import type { SessionMessageSummary } from "../../apps/mobile/src/lib/api";
import {
  MOBILE_CHAT_WORK_TIMELINE,
  MOBILE_NATIVE_TEXT_RENDERING,
  MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT,
  buildMobileWorkTimeline,
  chatIsWaitingForAssistant,
  extractMobileMarkdownImages,
  formatMobileWorkedDuration,
  hasUnicodeTextFallback,
  latestVisibleChatMessages,
  mobileGoalIterationNumber,
  shouldUseSelectableNativeText,
  splitMessageContent,
  splitUnicodeTextRuns,
  visibleChatMessages,
} from "../../apps/mobile/src/lib/chat-format";

const messages: SessionMessageSummary[] = [
  {
    id: "system-1",
    role: "system",
    content: "hidden system prompt",
  },
  {
    id: "user-1",
    role: "user",
    content: "show this request",
  },
];

describe("mobile chat formatting", () => {
  test("extracts safe screenshot markdown without leaving alt text in the transcript", () => {
    const extracted = extractMobileMarkdownImages(
      [
        "Analysis complete.",
        "![screenshot](file:///Users/test/.cybara/screenshots/solar-one.png)",
        "![screenshot](file:///Users/test/.cybara/screenshots/solar-two.png)",
        "![unsafe](file:///Users/test/private.png)",
      ].join("\n\n")
    );

    expect(extracted.content).toContain("Analysis complete.");
    expect(extracted.content).not.toContain("solar-one.png");
    expect(extracted.content).not.toContain("solar-two.png");
    expect(extracted.content).toContain("![unsafe](file:///Users/test/private.png)");
    expect(extracted.images).toEqual([
      {
        alt: "screenshot",
        source: "file:///Users/test/.cybara/screenshots/solar-one.png",
        filePath: "/Users/test/.cybara/screenshots/solar-one.png",
      },
      {
        alt: "screenshot",
        source: "file:///Users/test/.cybara/screenshots/solar-two.png",
        filePath: "/Users/test/.cybara/screenshots/solar-two.png",
      },
    ]);
  });

  test("hides system messages without changing gateway message order", () => {
    expect(visibleChatMessages(messages)).toEqual([messages[1]]);
  });

  test("recognizes autonomous goal prompts for compact native iteration rows", () => {
    expect(
      mobileGoalIterationNumber({
        role: "user",
        content: "  [autonomous goal iteration 19]\nContinue working on the objective.",
      })
    ).toBe(19);
    expect(mobileGoalIterationNumber({ role: "user", content: "Continue working" })).toBeNull();
    expect(
      mobileGoalIterationNumber({
        role: "assistant",
        content: "[autonomous goal iteration 2]",
      })
    ).toBeNull();
  });

  test("keeps only the latest visible chat messages for mobile rendering", () => {
    const longHistory = Array.from(
      { length: MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT + 40 },
      (_, index) => ({
        id: `message-${index}`,
        role: index % 5 === 0 ? "system" : index % 2 === 0 ? "assistant" : "user",
        content: `message ${index}`,
      })
    );
    const expected = longHistory
      .filter((message) => message.role !== "system")
      .slice(-MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT);

    const visible = latestVisibleChatMessages(longHistory);

    expect(visible.length).toBe(MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT);
    expect(visible.some((message) => message.role === "system")).toBe(false);
    expect(visible).toEqual(expected);
  });

  test("marks the chat as waiting when the latest visible message is from the user", () => {
    expect(chatIsWaitingForAssistant(messages, false)).toBe(true);
    expect(
      chatIsWaitingForAssistant(
        [
          ...messages,
          {
            id: "assistant-1",
            role: "assistant",
            content: "done",
          },
        ],
        false
      )
    ).toBe(false);
    expect(chatIsWaitingForAssistant([], true)).toBe(true);
  });

  test("splits long assistant text around fenced code blocks", () => {
    expect(splitMessageContent("Before\n```typescript\nconst ok = true;\n```\nAfter")).toEqual([
      { type: "text", content: "Before\n", key: "text-0" },
      {
        type: "code",
        language: "typescript",
        content: "const ok = true;\n",
        key: "code-7",
      },
      { type: "text", content: "\nAfter", key: "text-41" },
    ]);
  });

  test("keeps emoji and non-ascii runs intact for native text fallback", () => {
    const grinning = "\u{1F600}";
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
    expect(MOBILE_NATIVE_TEXT_RENDERING.disablesSelectableForUnicode).toBe(true);
    expect(MOBILE_NATIVE_TEXT_RENDERING.forceEmojiFontFamily).toBe(false);
    expect(MOBILE_NATIVE_TEXT_RENDERING.preserveNativeUnicodeFallback).toBe(true);
    expect(MOBILE_NATIVE_TEXT_RENDERING.monospaceOnlyForAsciiCode).toBe(true);
    expect(hasUnicodeTextFallback("plain ascii")).toBe(false);
    expect(hasUnicodeTextFallback(`Ship ${grinning} cafe\u0301 中文 ${family}`)).toBe(true);
    expect(shouldUseSelectableNativeText("plain ascii")).toBe(true);
    expect(shouldUseSelectableNativeText(`Ship ${grinning}`)).toBe(false);
    expect(shouldUseSelectableNativeText("中文")).toBe(false);
    expect(splitUnicodeTextRuns(`Ship ${grinning} cafe\u0301 中文 ${family}`)).toEqual([
      { type: "text", content: "Ship " },
      { type: "emoji", content: grinning },
      { type: "text", content: " caf" },
      { type: "unicode", content: "e\u0301" },
      { type: "text", content: " " },
      { type: "unicode", content: "中文" },
      { type: "text", content: " " },
      { type: "emoji", content: family },
    ]);
  });

  test("formats mobile work timeline like the web chat activity text", () => {
    expect(MOBILE_CHAT_WORK_TIMELINE.showWorkedForLine).toBe(true);
    expect(MOBILE_CHAT_WORK_TIMELINE.renderToolCallsAsActivityText).toBe(true);
    expect(MOBILE_CHAT_WORK_TIMELINE.useDesktopToolIntentLabels).toBe(true);
    expect(formatMobileWorkedDuration(26_000)).toBe("0h 00m 26s");

    const timeline = buildMobileWorkTimeline({
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      thinking: "I'll check the available tools and execute a concrete mobile app smoke test.",
      toolCalls: [
        {
          id: "tool-search",
          name: "tool_search",
          status: "completed",
          args: { query: "mobile test tools" },
          startedAt: 1000,
        },
        {
          id: "shell-1",
          name: "shell",
          status: "completed",
          args: { cmd: "ls -la && pwd" },
          startedAt: 27_000,
        },
      ],
    });

    expect(timeline.workedDuration).toBe("0h 00m 26s");
    expect(timeline.activities.map((activity) => activity.text)).toEqual([
      "I'll check the available tools and execute a concrete mobile app smoke test.",
      'Search complete for "mobile test tools"',
      "Ran ls -la && pwd",
    ]);
  });

  test("uses current time for active mobile work duration", () => {
    const timeline = buildMobileWorkTimeline(
      {
        id: "assistant-live",
        role: "assistant",
        content: "",
        processActivities: [
          {
            id: "read-live",
            phase: "start",
            text: "Exploring package.json",
            timestamp: 10_000,
            toolName: "read",
          },
        ],
      },
      45_000
    );

    expect(timeline.workedDuration).toBe("0h 00m 35s");
    expect(timeline.activities[0]).toMatchObject({
      phase: "start",
      text: "Exploring package.json",
    });
  });

  test("prefers the persisted run duration for completed mobile work", () => {
    const timeline = buildMobileWorkTimeline({
      id: "assistant-persisted-duration",
      role: "assistant",
      content: "Done",
      workedDurationMs: 26_000,
      processActivities: [
        {
          id: "short-tool",
          phase: "result",
          text: "Ran command",
          timestamp: 25_000,
        },
      ],
    });

    expect(timeline.workedDuration).toBe("0h 00m 26s");
  });

  test("hides persisted provider recovery status from mobile work", () => {
    const timeline = buildMobileWorkTimeline({
      id: "assistant-provider-recovery",
      role: "assistant",
      content: "Recovered",
      processActivities: [
        {
          id: "provider-refresh",
          phase: "start",
          text: "Provider session refreshed; continuing...",
          timestamp: 10_000,
          toolName: "__thought",
        },
      ],
    });

    expect(timeline.activities).toEqual([]);
  });

  test("keeps repeated persisted tool calls with distinct ids", () => {
    const timeline = buildMobileWorkTimeline({
      id: "assistant-repeated-tools",
      role: "assistant",
      content: "Done",
      toolCalls: [
        {
          id: "read-1",
          name: "read",
          status: "completed",
          args: { path: "a.ts" },
        },
        {
          id: "read-2",
          name: "read",
          status: "completed",
          args: { path: "a.ts" },
        },
      ],
    });

    expect(timeline.activities).toHaveLength(2);
    expect(timeline.activities.map((activity) => activity.toolCallId)).toEqual([
      "read-1",
      "read-2",
    ]);
  });
});
