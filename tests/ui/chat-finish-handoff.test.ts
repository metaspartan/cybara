import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// When a run this client didn't drive finishes (started on another client, or
// the view remounted mid-run), every UI must fetch the persisted assistant
// reply BEFORE dropping the live timeline/streaming buffer. Clearing first
// left the chat blank for seconds — or forever on web — right at completion.
describe("chat completion handoff (no blank chat when a run finishes)", () => {
  test("web: idle event refreshes the open session before clearing live state", () => {
    const source = read("ui/src/pages/Chat.tsx");
    expect(source).toContain("refreshSessionMessagesRef");
    expect(source).toContain("const finalizeLiveState = () => {");
    // Refresh first, clear in .finally so failures still clean up.
    expect(source).toContain(
      "void refreshSessionMessagesRef.current(sessionToRefresh).finally(finalizeLiveState);"
    );
    // The refresher only applies results to the still-visible session.
    expect(source).toContain("activeSessionRef.current === sid");
    // Sessions that are not on screen skip the fetch and just clean up.
    expect(source).toContain("sessionToRefresh === activeSessionRef.current");
  });

  test("mobile: idle event reloads the session before dropping the live assistant", () => {
    const source = read("apps/mobile/src/screens/DashboardScreen.tsx");
    expect(source).toContain("void loadSession(false).finally(() => {");
    expect(source).toContain("commitLiveAssistant(() => null, event.timestamp);");
    // The old instant-clear form must not come back.
    expect(source).not.toMatch(
      /if \(event\.status === "idle"\) \{\s*\n\s*if \(!sendingRef\.current\) \{\s*\n\s*commitLiveAssistant\(\(\) => null, event\.timestamp\);/
    );
  });

  test("macos: idle status loads messages before resetting the live timeline", () => {
    const source = read("apps/macos/Cybara/Sources/Cybara/NativeScreens.swift");
    const idleBlock = source.slice(source.indexOf('if status == "idle"'));
    const resetIndex = idleBlock.indexOf("resetLiveTimeline(clearStartedAt: true)");
    const loadIndex = idleBlock.indexOf("await loadMessages(id)");
    expect(loadIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(loadIndex);
  });
});

// The chat must follow live output (activities, tool calls, streamed tokens)
// without trapping users who scrolled up to read.
describe("chat live auto-scroll", () => {
  test("web: sticks to bottom on live content only when already near the bottom", () => {
    const source = read("ui/src/pages/Chat.tsx");
    expect(source).toContain(
      "const nearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 96;"
    );
    expect(source).toContain("if (!nearBottom) return;");
    expect(source).toMatch(
      /\}, \[liveActivities, streamingContent, liveCurrentStep, artifactViewerTarget\]\);/
    );
  });

  test("macos: scrolls the live thinking bubble into view as it streams", () => {
    const source = read("apps/macos/Cybara/Sources/Cybara/NativeScreens.swift");
    expect(source).toContain(".onChange(of: liveActivities.count)");
    expect(source).toContain(".onChange(of: streamingContent)");
    expect(source).toContain('proxy.scrollTo("thinking", anchor: .bottom)');
  });

  test("mobile: scrolls to end as the live assistant message grows", () => {
    const source = read("apps/mobile/src/screens/DashboardScreen.tsx");
    expect(source).toContain("scrollRef.current?.scrollToEnd({ animated: true });");
    expect(source).toContain("liveAssistant?.content,");
    expect(source).toContain("liveAssistant?.processActivities?.length,");
  });
});
