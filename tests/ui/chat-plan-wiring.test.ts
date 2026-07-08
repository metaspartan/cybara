import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
});
