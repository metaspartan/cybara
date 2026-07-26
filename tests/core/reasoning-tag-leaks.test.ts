import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripReasoningTagTokens, summarizeProgressThought } from "../../src/core/agent-internals";
import { reduceSessionStatusSnapshot } from "../../src/core/status";
import { mergeActivityLists, type LiveActivityItem } from "../../ui/src/lib/chatActivities";
import {
  buildMobileWorkTimeline,
  stripStreamingReasoningForDisplay,
} from "../../apps/mobile/src/lib/chat-format";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("reasoning tag tokens never leak into visible chat state", () => {
  test("gateway: summarizeProgressThought drops bare tags and cleans mixed text", () => {
    expect(summarizeProgressThought("</think>")).toBeUndefined();
    expect(summarizeProgressThought("<think>")).toBeUndefined();
    expect(summarizeProgressThought("[/thinking]")).toBeUndefined();
    expect(summarizeProgressThought("Checking the file</think>")).toBe("Checking the file");
    expect(summarizeProgressThought("<thinking>plan</thinking> run tests")).toBe("plan run tests");
  });

  test("gateway: summarizeProgressThought keeps live reasoning concise at a sentence boundary", () => {
    const thought = Array.from(
      { length: 40 },
      (_, index) => `Reasoning step ${index + 1} verifies the next tool call.`
    ).join(" ");

    expect(thought.length).toBeGreaterThan(500);
    const summary = summarizeProgressThought(thought);
    expect(summary?.length).toBeGreaterThan(240);
    expect(summary?.length).toBeLessThanOrEqual(500);
    expect(summary?.endsWith(".")).toBe(true);
    expect(summary).toStartWith("Reasoning step 1 verifies the next tool call.");
  });

  test("gateway: stripReasoningTagTokens handles every tag family", () => {
    for (const token of [
      "</think>",
      "<think>",
      "</thinking>",
      "<antthinking>",
      "</reasoning>",
      "<REASONING_SCRATCHPAD>",
      "</final>",
      "[thinking]",
      "[/reasoning]",
    ]) {
      expect(stripReasoningTagTokens(token).trim()).toBe("");
    }
  });

  test("gateway: status snapshots sanitize activity detail through the shared stripper", () => {
    const statusSource = read("src/core/status.ts");
    expect(statusSource).toContain('import { stripReasoningTagTokens } from "./agent-internals"');
    expect(statusSource).toContain("stripReasoningTagTokens(detail)");
  });

  test("gateway: live status snapshots preserve complete long thoughts", () => {
    const thought = Array.from(
      { length: 35 },
      (_, index) => `Live thought ${index + 1} checks the next operation.`
    ).join(" ");
    const snapshot = reduceSessionStatusSnapshot(undefined, {
      status: "thinking",
      timestamp: 1,
      detail: thought,
      sessionId: "long-thought-session",
    });

    expect(snapshot?.detail).toBe(thought);
    expect(snapshot?.activities[0]?.text).toBe(thought);
  });

  test("web: mergeActivityLists drops activities that are only tag markup", () => {
    const activities: LiveActivityItem[] = [
      { id: "a", phase: "result", text: "</think>", timestamp: 1, toolName: "__thought" },
      { id: "b", phase: "result", text: "Read package.json", timestamp: 2, toolName: "read" },
      { id: "c", phase: "result", text: "Done</think> checking", timestamp: 3 },
    ];
    const merged = mergeActivityLists(activities, []);
    expect(merged.map((entry) => entry.text)).toEqual(["Read package.json", "Done checking"]);
  });

  test("mobile: work timeline drops tag-only thinking and activities", () => {
    const timeline = buildMobileWorkTimeline(
      {
        id: "m1",
        role: "assistant",
        content: "hello",
        timestamp: new Date().toISOString(),
        thinking: "</think>",
        processActivities: [
          { id: "p1", phase: "result", text: "</think>", timestamp: Date.now() },
          { id: "p2", phase: "result", text: "Ran bash", timestamp: Date.now() },
        ],
      },
      Date.now()
    );
    expect(timeline.activities.map((entry) => entry.text)).toEqual(["Ran bash"]);
  });

  test("streaming display hides reasoning in all three buffer shapes", () => {
    expect(stripStreamingReasoningForDisplay("<think>secret plan</think>The answer is 4.")).toBe(
      "The answer is 4."
    );
    expect(stripStreamingReasoningForDisplay("still reasoning here</think>Final answer.")).toBe(
      "Final answer."
    );
    expect(stripStreamingReasoningForDisplay("Intro text<think>partial reasoning")).toBe(
      "Intro text"
    );
    expect(stripStreamingReasoningForDisplay("Just a normal answer.")).toBe(
      "Just a normal answer."
    );
  });

  test("activity timelines still strip reasoning tag tokens", () => {
    const mobileChat = read("apps/mobile/src/lib/chat-format.ts");
    expect(mobileChat).toContain("stripReasoningTagTokens");
    const macTimeline = read("apps/macos/Cybara/Sources/Cybara/NativeToolTimeline.swift");
    expect(macTimeline).toContain("nativeReasoningMarkupTokenPattern");
  });

  test("no client renders a live streaming answer body during a run", () => {
    const web = read("ui/src/pages/Chat.tsx");
    expect(web).not.toContain("{visibleStreamingText && (");

    const mobileChat = read("apps/mobile/src/screens/dashboardChat.tsx");
    expect(mobileChat).toContain("if (isLiveMessage) {");
    expect(mobileChat).not.toContain("stripStreamingReasoningForDisplay(rawContent)");

    const macScreens = read("apps/macos/Cybara/Sources/Cybara/NativeScreens.swift");
    expect(macScreens).not.toContain("NativeMarkdownView(content: visibleStreamingContent");
  });

  test("mobile and native timelines leave thought rows unbounded", () => {
    const mobileChat = read("apps/mobile/src/screens/dashboardChat.tsx");
    const macTimeline = read("apps/macos/Cybara/Sources/Cybara/NativeToolTimeline.swift");

    expect(mobileChat).toContain('numberOfLines={activity.toolName === "__thought" ? 0 : 2}');
    expect(macTimeline).toContain('.lineLimit(activity.toolName == "__thought" ? nil : 3)');
  });
});
