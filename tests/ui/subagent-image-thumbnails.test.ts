import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeSubagentActivities,
  updateRunDetails,
  registerSubagentRun,
  resetSubagentRegistryForTests,
  getRun,
} from "../../src/core/subagent-registry";

const timelineSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/SubagentTimeline.tsx", import.meta.url)),
  "utf8"
);
const activityTimelineSource = readFileSync(
  fileURLToPath(new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)),
  "utf8"
);

describe("subagent image thumbnails", () => {
  test("activity timeline shares its viewed-image thumbnail component", () => {
    expect(activityTimelineSource).toContain("export function ImageViewedThumbnail");
    expect(timelineSource).toContain('import { ImageViewedThumbnail } from "./ActivityTimeline"');
  });

  test("timeline resolves image sources from live payloads and stored tool calls", () => {
    expect(timelineSource).toContain("imageSourceFromPath(imagePath)");
    expect(timelineSource).toContain("imageViewedSource(toolCall)");
    expect(timelineSource).toContain("imageAltFromPath(imagePath)");
    expect(timelineSource).toContain("<ImageViewedThumbnail");
  });

  test("image rows auto-expand in progress and stay collapsible when completed", () => {
    expect(timelineSource).toContain("const defaultExpanded = Boolean(entry.imageSource);");
    expect(timelineSource).toContain(
      "const expanded = defaultExpanded !== toggledRows.has(entry.key);"
    );
    expect(timelineSource).toContain("expanded && entry.imageSource");
  });

  test("captured view activities keep their image payload through persistence", () => {
    resetSubagentRegistryForTests();
    const run = registerSubagentRun({
      childSessionKey: `child-image-${process.pid}`,
      requesterSessionKey: `parent-image-${process.pid}`,
      task: "View an image and report",
    });
    const activities = normalizeSubagentActivities([
      {
        id: "view-1",
        phase: "result",
        text: "Viewed an image",
        timestamp: 1,
        toolName: "read",
        toolCallId: "call-view-1",
        imagePath: "/tmp/cybara-e2e/test-image.png",
      },
    ]);
    expect(activities?.[0]).toMatchObject({
      imagePath: "/tmp/cybara-e2e/test-image.png",
      toolName: "read",
    });
    updateRunDetails(run.runId, { activities, activityCount: activities?.length });
    const stored = getRun(run.runId);
    expect(stored?.activities?.[0]?.imagePath).toBe("/tmp/cybara-e2e/test-image.png");
  });

  test("alt text stays UI-derived from imagePath instead of a dead schema field", () => {
    const registrySource = readFileSync(
      fileURLToPath(new URL("../../src/core/subagent-registry.ts", import.meta.url)),
      "utf8"
    );
    expect(registrySource).not.toContain("imageAlt");
    expect(timelineSource).toContain("imageAltFromPath(imagePath)");
    expect(timelineSource).toContain('entry.imageAlt || "Viewed image"');
  });

  test("orphan tool calls stay visible with or without image sources", () => {
    expect(timelineSource).toContain("if (matched.has(toolCall)) continue;");
    expect(timelineSource).not.toContain("if (!imageSource) continue;");
    expect(timelineSource).toContain("tool-orphan-");
  });
});
