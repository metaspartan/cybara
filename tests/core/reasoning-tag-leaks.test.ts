import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripReasoningTagTokens, summarizeProgressThought } from "../../src/core/agent-internals";
import { mergeActivityLists, type LiveActivityItem } from "../../ui/src/lib/chatActivities";
import {
  buildMobileWorkTimeline,
  stripStreamingReasoningForDisplay,
} from "../../apps/mobile/src/lib/chat-format";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// A model streaming reasoning can emit a bare "</think>" (or any reasoning
// tag token) as a delta. That token must never surface as a visible thought,
// activity, or streamed answer text in any client.
describe("reasoning tag tokens never leak into visible chat state", () => {
  test("gateway: summarizeProgressThought drops bare tags and cleans mixed text", () => {
    expect(summarizeProgressThought("</think>")).toBeUndefined();
    expect(summarizeProgressThought("<think>")).toBeUndefined();
    expect(summarizeProgressThought("[/thinking]")).toBeUndefined();
    expect(summarizeProgressThought("Checking the file</think>")).toBe("Checking the file");
    expect(summarizeProgressThought("<thinking>plan</thinking> run tests")).toBe("plan run tests");
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
    // Paired block.
    expect(stripStreamingReasoningForDisplay("<think>secret plan</think>The answer is 4.")).toBe(
      "The answer is 4."
    );
    // Implicit opener (DeepSeek style): everything before the close is reasoning.
    expect(stripStreamingReasoningForDisplay("still reasoning here</think>Final answer.")).toBe(
      "Final answer."
    );
    // Unclosed opener: reasoning still streaming, show nothing after it.
    expect(stripStreamingReasoningForDisplay("Intro text<think>partial reasoning")).toBe(
      "Intro text"
    );
    // Plain text is untouched.
    expect(stripStreamingReasoningForDisplay("Just a normal answer.")).toBe(
      "Just a normal answer."
    );
  });

  test("activity timelines still strip reasoning tag tokens", () => {
    // The activity/thought stripper stays wired even though live answer bodies
    // are no longer rendered during a run.
    const mobileChat = read("apps/mobile/src/lib/chat-format.ts");
    expect(mobileChat).toContain("stripReasoningTagTokens");
    const macTimeline = read("apps/macos/Cybara/Sources/Cybara/NativeToolTimeline.swift");
    expect(macTimeline).toContain("nativeReasoningMarkupTokenPattern");
  });

  test("no client renders a live streaming answer body during a run", () => {
    // Every client shows only the working timeline/status while generating; the
    // full reply appears on completion. No live token block that could read as
    // a stuck/duplicate answer next to 'Generating response...'.
    const web = read("ui/src/pages/Chat.tsx");
    expect(web).not.toContain("{visibleStreamingText && (");

    // Mobile: the live-assistant placeholder renders only the WorkTimeline.
    const mobileChat = read("apps/mobile/src/screens/dashboardChat.tsx");
    expect(mobileChat).toContain("if (isLiveMessage) {");
    expect(mobileChat).not.toContain("stripStreamingReasoningForDisplay(rawContent)");

    // macOS: the thinking bubble shows the timeline only, no streamed body.
    const macScreens = read("apps/macos/Cybara/Sources/Cybara/NativeScreens.swift");
    expect(macScreens).not.toContain("NativeMarkdownView(content: visibleStreamingContent");
  });
});
