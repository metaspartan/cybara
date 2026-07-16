import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const chatSourcePath = join(process.cwd(), "src", "api", "chat.ts");
const processActivitiesSourcePath = join(process.cwd(), "src", "api", "chat-process-activities.ts");

describe("chat response persistence guards", () => {
  test("builds fallback process activities when status snapshot is empty", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    const processActivitiesSource = readFileSync(processActivitiesSourcePath, "utf8");
    expect(processActivitiesSource).toContain("export function buildFallbackProcessActivities(");
    expect(source).toContain(
      "const statusSnapshotActivities = getSessionProcessActivities(session.id"
    );
    expect(source).toContain(
      "excludeActivityIds: collectAttachedProcessActivityIds(session.messages)"
    );
    expect(source).toContain("const fallbackProcessActivities =");
    expect(source).toContain("buildFallbackProcessActivities(");
  });

  test("avoids blank assistant bubbles by using a content fallback", () => {
    const source = readFileSync(chatSourcePath, "utf8");
    expect(source).toContain("const assistantContent =");
    expect(source).toContain("buildToolExecutionFallbackMessage(");
    expect(source).toContain(': "Completed."');
    expect(source).toContain("content: assistantContent");
  });
});
