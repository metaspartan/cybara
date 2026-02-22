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
});
