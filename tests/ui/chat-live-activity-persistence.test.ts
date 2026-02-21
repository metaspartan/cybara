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
});
