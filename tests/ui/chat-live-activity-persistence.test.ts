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
    expect(source).toContain('if (!loadingRef.current) {');
    expect(source).toContain("setLiveActivities([]);");
    expect(source).toContain("runActivityBufferRef.current = [];");
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
    expect(source).not.toContain("finalizeCompletedActivities(processActivities).slice(-8)");
  });

  test("hides stale working timeline when session status is active but live status is idle", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain(
      "const showWorkingTimeline = isLoading || (currentSessionIsActive && liveStatus !== \"idle\");"
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

  test("infers thought timeline lines from assistant content as a fallback", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("function inferThoughtActivitiesFromContent(");
    expect(source).toContain("!hasPersistedThoughtActivities");
    expect(source).toContain("inferThoughtActivitiesFromContent(");
  });

  test("renders compact work timeline entries instead of large tool cards", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("<ProcessActivityList activities={workActivities} />");
    expect(source).not.toContain("function ToolCallItem(");
  });

  test("uses stable message process keys and supports legacy timestamp-key migration", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("function getLegacyMessageProcessKey(");
    expect(source).toContain("function getMessageProcessActivities(");
    expect(source).toContain("const canonicalKey = getMessageProcessKey(sessionId, message, index);");
    expect(source).toContain("const legacyKey = getLegacyMessageProcessKey(sessionId, message, index);");
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
    expect(source).toContain("const embeddedProcessActivities = normalizeMessageProcessActivities(");
    expect(source).toContain("function inferThoughtActivitiesFromThinking(");
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
