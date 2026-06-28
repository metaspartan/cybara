import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const chatSourcePath = join(process.cwd(), "ui", "src", "pages", "Chat.tsx");

describe("Chat live activity persistence", () => {
  test("keeps a dedicated run activity buffer for post-completion rendering", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("const runActivityBufferRef = useRef<LiveActivityItem[]>([])");
    expect(source).toContain("const runActivities =");
    expect(source).toContain("activities: runActivities.map((activity) => ({ ...activity }))");
  });

  test("does not clear live activities on idle while a request is still loading", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain(
      "if (!loadingRef.current && !hasPendingCaptureForVisibleSession) {"
    );
    expect(source).toContain("setLiveActivities([]);");
    expect(source).toContain("runActivityBufferRef.current = [];");
  });

  test("clears the temporary live timeline after attaching it to the completed assistant message", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("pendingProcessCaptureRef.current = null;");
    expect(source).toContain("runActivityBufferRef.current = [];");
    expect(source).toContain("setLiveActivities([]);");
    expect(source).toContain("setLiveCurrentStep(null);");
  });

  test("uses server event timestamps when appending live activities to preserve order", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("eventTimestamp?: number");
    expect(source).toContain(
      "typeof eventTimestamp === \"number\" && Number.isFinite(eventTimestamp)"
    );
    expect(source).toMatch(
      /appendLiveActivity\(\s*phase,\s*text,\s*payload\.toolName,\s*eventTimestamp,\s*payload\.toolCallId,\s*payload\.sandboxProvider\s*\);/
    );
  });

  test("ignores stale polling snapshots that arrive after newer SSE events", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("latestStatusTimestampBySessionRef");
    expect(source).toContain("snapshotLatestTimestamp + 25 < latestKnownTimestamp");
  });

  test("clears stale running step text after a tool completion with no in-flight step", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("const nextActiveStep = getLatestInFlightStep(runActivityBufferRef.current);");
    expect(source).toContain("if (nextActiveStep) {");
    expect(source).toContain("setLiveCurrentStep(nextActiveStep);");
    expect(source).toContain("} else {");
    expect(source).toContain("setLiveCurrentStep(null);");
  });

  test("renders worked duration when duration is defined", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain(
      '{workedDurationMs !== undefined ? formatWorkedDuration(workedDurationMs) : "0h 00m 00s"}'
    );
  });

  test("does not truncate activity timeline display lists", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).not.toContain("activities.slice(-20)");
    expect(source).not.toContain(".slice(-50)");
    expect(source).not.toContain("finalizeCompletedActivities(processActivities).slice(-8)");
  });

  test("keeps the working timeline visible while the session remains active", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain(
      "const currentSessionIsLoading = isLoading && loadingSessionId === sessionId;"
    );
    expect(source).toContain("const showWorkingTimeline =");
    expect(source).toContain("currentSessionIsLoading ||");
    expect(source).toContain("currentSessionIsActive ||");
    expect(source).toContain("pendingCaptureForCurrentSession ||");
    expect(source).toContain(
      'const timelineStatus =\n    currentSessionIsActive && liveStatus === "idle" ? ("thinking" as const) : liveStatus;'
    );
  });

  test("persists message process map across reloads", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain('const MESSAGE_PROCESS_MAP_STORAGE_KEY = "cybara:messageProcessMap"');
    expect(source).toContain("readPersistedMessageProcessMap()");
    expect(source).toContain("persistMessageProcessMap(messageProcessMap)");
  });

  test("does not trim message process map history to last 199 entries", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).not.toContain("Object.entries(previous).slice(-199)");
  });

  test("does not cap persisted message process activities per message", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).not.toContain("MAX_PERSISTED_ACTIVITY_ITEMS_PER_MESSAGE");
    expect(source).not.toContain("normalized.slice(0, MAX_PERSISTED_ACTIVITY_ITEMS_PER_MESSAGE)");
    expect(source).not.toContain("value.slice(0, MAX_PERSISTED_ACTIVITY_ITEMS_PER_MESSAGE)");
  });

  test("infers thought timeline lines from assistant content as a fallback", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("function inferThoughtActivitiesFromContent(");
    expect(source).toContain("!hasPersistedThoughtActivities");
    expect(source).toContain("inferThoughtActivitiesFromContent(");
  });

  test("renders compact work timeline entries instead of large tool cards", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("<ProcessActivityList activities={workActivitiesWithSandbox} />");
    expect(source).not.toContain("function ToolCallItem(");
  });

  test("uses stable message process keys and supports legacy timestamp-key migration", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("function getLegacyMessageProcessKey(");
    expect(source).toContain("function getMessageProcessActivities(");
    expect(source).toContain(
      "const canonicalKey = getMessageProcessKey(sessionId, message, index);"
    );
    expect(source).toContain(
      "const legacyKey = getLegacyMessageProcessKey(sessionId, message, index);"
    );
  });

  test("prefers the best worked duration candidate instead of tiny synthetic tool ranges", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("const durationCandidates: number[] = [];");
    expect(source).toContain("return Math.max(...durationCandidates);");
  });

  test("restores process thoughts from persisted message metadata", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("function normalizeMessageProcessActivities(");
    expect(source).toContain("message.process_activities");
    expect(source).toContain(
      "const embeddedProcessActivities = normalizeMessageProcessActivities("
    );
    expect(source).toContain("function inferThoughtActivitiesFromThinking(");
  });

  test("does not cap inferred thinking timeline lines", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).not.toContain(".slice(0, 24)");
  });

  test("supports multiline compose and dictation controls", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("<textarea");
    expect(source).toContain("Enter to send • Shift+Enter for newline");
    expect(source).toContain("handleToggleDictation");
  });

  test("keeps sessions panel open on session switch/new session callbacks", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("setShowSessionsPanel(true);");
    expect(source).toContain("onLoadSession={(id, msgs, loadedWorkspaceDir, loadedAgentId) => {");
    expect(source).toContain("syncSessionAgentSelection(loadedAgentId);");
    expect(source).toContain("onNewSession={() => {");
    expect(source).toContain("setSessionAgentId(null);");
  });
});
