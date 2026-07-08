import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectPlanTimelineFromMessages,
  extractLatestPlanFromMessages,
  type ChatMessage,
} from "../../ui/src/pages/chat/chatModel";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const chatModelPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/chatModel.ts", import.meta.url)
);
const planCardPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/PlanSummaryCard.tsx", import.meta.url)
);
const apiPath = fileURLToPath(new URL("../../ui/src/lib/api.ts", import.meta.url));
const artifactsPath = fileURLToPath(new URL("../../ui/src/pages/Artifacts.tsx", import.meta.url));

function readUiSource(): string {
  return [
    readFileSync(chatPagePath, "utf8"),
    readFileSync(chatModelPath, "utf8"),
    readFileSync(planCardPath, "utf8"),
    readFileSync(apiPath, "utf8"),
    readFileSync(artifactsPath, "utf8"),
  ].join("\n");
}

describe("chat plan and artifact UI wiring", () => {
  test("renders todo plans in transcript and composer", () => {
    const source = readUiSource();
    expect(source).toContain("function PlanSummaryCard");
    expect(source).toContain("collectPlanFromToolCalls");
    expect(source).toContain("collectPlanTimelineFromMessages(typedMessages, sessionId)");
    expect(source).toContain("ChatEnvironmentOverview");
    expect(source).toContain("extractLatestPlanFromMessages(typedMessages, sessionId)");
    expect(source).toContain(
      "{currentSessionPlan && <PlanSummaryCard plan={currentSessionPlan} compact />}"
    );
    expect(source).toContain("parsePlanFromToolCall(toolCall, sessionId, updatedAt)");
  });

  test("exposes session plan and artifact delete API wiring", () => {
    const source = readUiSource();
    expect(source).toContain("getSessionPlan");
    expect(source).toContain('/sessions/" + id + "/plan');
    expect(source).toContain("deleteSessionArtifact");
    expect(source).toContain("chatApi.deleteSessionArtifact");
    expect(source).toContain("This cannot be undone.");
  });

  test("collects chronological plan history while keeping the latest plan separate", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        timestamp: "2026-07-08T20:00:00.000Z",
        tool_calls: [
          {
            id: "plan-1",
            name: "todo",
            status: "completed",
            result: {
              items: [
                { content: "Inspect state", status: "completed", priority: "high" },
                { content: "Patch UI", status: "in_progress", priority: "medium" },
                { content: "Test browser", status: "pending", priority: "medium" },
              ],
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "",
        timestamp: "2026-07-08T20:04:00.000Z",
        tool_calls: [
          {
            id: "not-plan",
            name: "read",
            status: "completed",
          },
          {
            id: "plan-2",
            name: "todo",
            status: "completed",
            result: {
              items: [
                { content: "Inspect state", status: "completed", priority: "high" },
                { content: "Patch UI", status: "completed", priority: "medium" },
                { content: "Test browser", status: "in_progress", priority: "medium" },
                { content: "Add xAI model", status: "pending", priority: "low" },
              ],
            },
          },
        ],
      },
    ];

    const timeline = collectPlanTimelineFromMessages(messages, "session-plan-ui");
    expect(timeline).toHaveLength(2);
    expect(timeline.map((entry) => [entry.messageIndex, entry.toolIndex])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(timeline[0]?.summary).toEqual({
      total: 3,
      pending: 1,
      inProgress: 1,
      completed: 1,
    });
    expect(timeline[1]?.summary).toEqual({
      total: 4,
      pending: 1,
      inProgress: 1,
      completed: 2,
    });
    expect(extractLatestPlanFromMessages(messages, "session-plan-ui")?.items[3]?.content).toBe(
      "Add xAI model"
    );
  });
});
