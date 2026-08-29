import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readChatUiSource, readMobileChatSource } from "../source-fixtures";
import { readNativeChatSource } from "../shared/source-bundles";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("chat completion handoff (no blank chat when a run finishes)", () => {
  test("web: externally started runs load the user turn and selected agent immediately", () => {
    const chatSource = read("ui/src/pages/Chat.tsx");
    const runtimeSource = read("ui/src/pages/chat/useChatLiveSessionRuntime.ts");
    expect(chatSource).toContain('refreshSessionMessagesRef.current(key, [], "latest")');
    expect(runtimeSource).toContain(
      'refreshSessionMessagesRef.current(activeSession, [], "latest")'
    );
    expect(runtimeSource).toContain("loadLatestTranscript(() => loadFreshSession(sid))");
    expect(runtimeSource).toContain("syncSessionAgentSelection(");
    expect(runtimeSource).toContain("use_model_router === true");
  });

  test("web: completed responses retain a newer in-flight agent selection", () => {
    const source = read("ui/src/pages/Chat.tsx");
    const sessionAgentIndex = source.indexOf("responseRecord.session_agent_id");
    const responseAuthorIndex = source.indexOf("responseAgent && typeof responseAgent.id");
    expect(sessionAgentIndex).toBeGreaterThan(-1);
    expect(responseAuthorIndex).toBeGreaterThan(sessionAgentIndex);
  });

  test("web: idle event refreshes the open session before clearing live state", () => {
    const source = readChatUiSource();
    expect(source).toContain("refreshSessionMessagesRef");
    expect(source).toContain("const finalizeLiveState = () => {");
    expect(source).toContain("if (refreshed) {");
    expect(source).toContain('setLiveCurrentStep("Finalizing response...")');
    expect(source).toContain("runStartSyncedSessionsRef.current.delete(sessionToRefresh)");
    expect(source).toContain("if (retryRefreshed) finalizeLiveState();");
    expect(source).not.toContain(
      "refreshSessionMessagesRef.current(sessionToRefresh).finally(finalizeLiveState)"
    );
    expect(source).toContain("loadPersistedCompletion");
    expect(source).toContain("loadFreshSession(sid)");
    expect(source).toContain("activeSessionRef.current === sid");
    expect(source).toContain("sessionToRefresh === activeSessionRef.current");
  });

  test("mobile: idle event reloads the session before pruning the live assistant", () => {
    const source = readMobileChatSource();
    expect(source).toContain("void loadSession(false).finally(() => {");
    expect(source).toContain(
      "prunePersistedMobileLiveAssistant(current, reconciledDetail.messages)"
    );
    expect(source).toContain("const cached = readCachedMobileLiveAssistant(sessionId);");
    expect(source).toContain("isMobileSessionStatusActive(sessionId, status)");
    expect(source).toContain("const active = serverReportsActive;");
    expect(source).not.toContain('snapshotStatus === "compacting"');
    expect(source).not.toContain('snapshotStatus === "tool_completed"');
    expect(source).not.toMatch(
      /if \(event\.status === "idle"\) \{\s*\n\s*if \(!sendingRef\.current\) \{\s*\n\s*commitLiveAssistant\(\(\) => null, event\.timestamp\);/
    );
    expect(source).not.toContain("commitLiveAssistant(() => null, event.timestamp);");
  });

  test("macos: idle status loads messages before resetting the live timeline", () => {
    const source = readNativeChatSource();
    const idleBlock = source.slice(source.indexOf('if status == "idle"'));
    const resetIndex = idleBlock.indexOf("resetLiveTimeline(clearStartedAt: true)");
    const loadIndex = idleBlock.indexOf("await loadMessages(id)");
    expect(loadIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(loadIndex);
    const workingTimelineBlock = source.slice(
      source.indexOf("var showWorkingTimeline: Bool"),
      source.indexOf("var sortedPendingMessages")
    );
    expect(workingTimelineBlock).toContain("activeSessionIDs.contains($0)");
    expect(workingTimelineBlock).not.toContain('"compacting"');
    expect(workingTimelineBlock).not.toContain('"tool_completed"');
  });

  test("macos: navigation keeps active transcripts and ignores late session loads", () => {
    const source = readNativeChatSource();
    expect(source).toContain("messagesBySessionID");
    expect(source).toContain("guard selectedSessionID == id else { return }");
    expect(source).toContain("nativeMergeReloadedSessionMessages(");
    expect(source).toContain("preserveReferenceTail: activeSessionIDs.contains(id) || sending");
  });
});

describe("chat live auto-scroll", () => {
  test("web: sticks to bottom on live content only when already near the bottom", () => {
    const source = readChatUiSource();
    expect(source).toContain("!isChatNearBottom(container, CHAT_FOLLOW_THRESHOLD_PX)");
    expect(source).toContain("keepScrolledToBottomRef.current");
    expect(source).toContain("programmaticScrollUntilRef.current = Number.POSITIVE_INFINITY");
    expect(source).toContain("observer.observe(container)");
    expect(source).toContain("for (const child of container.children) observer.observe(child)");
    expect(source).toContain("mutationObserver.observe(container, { childList: true })");
    expect(source).toContain("container.scrollTop = chatBottomScrollTop(container)");
  });

  test("macos: scrolls the live thinking bubble into view as it streams", () => {
    const source = readNativeChatSource();
    expect(source).toContain(".onChange(of: liveActivities.count)");
    expect(source).toContain(".onChange(of: streamingContent)");
    expect(source).toContain('proxy.scrollTo("thinking", anchor: .bottom)');
  });

  test("mobile: follows live growth with one stable non-animated scroll owner", () => {
    const source = readMobileChatSource();
    expect(source).toContain("onContentSizeChange={() => {");
    expect(source).toContain("if (!followChatBottomRef.current) return;");
    expect(source).toContain("if (!chatScrollGestureActiveRef.current) return;");
    expect(source).toContain("scrollRef.current?.scrollToEnd({ animated: false });");
    expect(source).not.toContain("scrollRef.current?.scrollToEnd({ animated: true });");
  });
});
