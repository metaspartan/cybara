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
const environmentOverviewPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatEnvironmentOverview.tsx", import.meta.url)
);
const gitBranchSelectorPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/GitBranchSelector.tsx", import.meta.url)
);
const environmentGitHookPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/useEnvironmentGitBranches.ts", import.meta.url)
);
const apiPath = fileURLToPath(new URL("../../ui/src/lib/api.ts", import.meta.url));
const artifactsPath = fileURLToPath(new URL("../../ui/src/pages/Artifacts.tsx", import.meta.url));

function readUiSource(): string {
  return [
    readFileSync(chatPagePath, "utf8"),
    readFileSync(chatModelPath, "utf8"),
    readFileSync(planCardPath, "utf8"),
    readFileSync(environmentOverviewPath, "utf8"),
    readFileSync(gitBranchSelectorPath, "utf8"),
    readFileSync(environmentGitHookPath, "utf8"),
    readFileSync(apiPath, "utf8"),
    readFileSync(artifactsPath, "utf8"),
  ].join("\n");
}

function readChatPageSource(): string {
  return readFileSync(chatPagePath, "utf8");
}

function readEnvironmentOverviewSource(): string {
  return readFileSync(environmentOverviewPath, "utf8");
}

function readPlanCardSource(): string {
  return readFileSync(planCardPath, "utf8");
}

describe("chat plan and artifact UI wiring", () => {
  test("renders todo plans in a dismissible composer card and current-chat environment overview", () => {
    const source = readUiSource();
    const chatPage = readChatPageSource();
    const environmentOverview = readEnvironmentOverviewSource();
    const planCard = readPlanCardSource();
    expect(source).toContain("ChatEnvironmentOverview");
    expect(source).toContain("function PlanSummaryCard");
    expect(source).toContain("Current chat only");
    expect(source).toContain("Latest plan update");
    expect(source).toContain("extractLatestPlanFromMessages(typedMessages, sessionId)");
    expect(chatPage).toContain("useEnvironmentGitBranches(effectiveWorkspaceDir)");
    expect(chatPage).toContain("gitBranch={environmentGit.currentBranch}");
    expect(source).toContain("/api/git/branches?path=");
    expect(source).toContain("GIT_BRANCH_LOAD_TIMEOUT_MS");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain('apiFetch("/api/git/branch"');
    expect(source).toContain("function GitBranchSelector");
    expect(source).toContain("Search branches");
    expect(source).toContain("New branch name");
    expect(chatPage).toContain('key={sessionId || "new-chat-environment"}');
    expect(chatPage).toContain("setShowEnvironmentOverview(false);");
    expect(chatPage).toContain("sessionId={sessionId}");
    expect(chatPage).toContain("hiddenComposerPlanKey");
    expect(chatPage).toContain("showComposerPlan");
    expect(chatPage).toContain("seenEnvironmentOverviewKey");
    expect(chatPage).toContain("environmentOverviewSignalKey");
    expect(chatPage).toContain("showEnvironmentOverviewDot");
    expect(chatPage).toContain("setSeenEnvironmentOverviewKey(environmentOverviewSignalKey)");
    expect(chatPage).toContain('aria-label="Environment overview"');
    expect(chatPage).toContain("<PlanSummaryCard");
    expect(chatPage).toContain("dismissible");
    expect(chatPage).toContain("expandable");
    expect(chatPage).toContain("setHiddenComposerPlanKey(currentSessionPlanKey)");
    expect(chatPage).not.toContain("collectPlanFromToolCalls");
    expect(chatPage).not.toContain("<PlanSummaryCard plan={planSummary}");
    expect(environmentOverview).not.toContain('label="Browser"');
    expect(environmentOverview).not.toContain("browserOrigin");
    expect(environmentOverview).toContain("<PlanSummaryCard plan={currentPlan} expandable");
    expect(environmentOverview).toContain("chat-environment-panel");
    expect(environmentOverview).toContain("gitBranch: string | null");
    expect(environmentOverview).toContain("gitBranches: GitBranchOption[]");
    expect(environmentOverview).toContain("onSwitchGitBranch");
    expect(environmentOverview).toContain("onCreateGitBranch");
    expect(environmentOverview).toContain('label="Branch"');
    expect(environmentOverview).toContain("createPortal(panel, document.body)");
    expect(environmentOverview).toContain('data-session-id={sessionId || "new-chat"}');
    expect(environmentOverview).toContain('background: "var(--chat-environment-panel-bg)"');
    expect(environmentOverview).toContain('backdropFilter: "none"');
    expect(environmentOverview).not.toContain("Earlier updates in this chat");
    expect(environmentOverview).not.toContain("previousPlans");
    expect(planCard).toContain('aria-label="Hide current plan"');
    expect(planCard).toContain("<details");
    expect(planCard).toContain("<summary");
    expect(planCard).toContain('data-testid={compact ? "chat-composer-plan" : "chat-plan-card"}');
    expect(source).toContain("parsePlanFromToolCall(toolCall, sessionId, message.timestamp)");
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
      {
        role: "assistant",
        content: "Done.",
        timestamp: "2026-07-08T20:08:00.000Z",
        tool_calls: [
          {
            id: "plan-3",
            name: "todo",
            status: "completed",
            result: {
              items: [
                { content: "Inspect state", status: "completed", priority: "high" },
                { content: "Patch UI", status: "completed", priority: "medium" },
                { content: "Test browser", status: "completed", priority: "medium" },
                { content: "Add xAI model", status: "completed", priority: "low" },
              ],
            },
          },
        ],
      },
    ];

    const timeline = collectPlanTimelineFromMessages(messages, "session-plan-ui");
    expect(timeline).toHaveLength(3);
    expect(timeline.map((entry) => [entry.messageIndex, entry.toolIndex])).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
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
    expect(timeline[2]?.summary).toEqual({
      total: 4,
      pending: 0,
      inProgress: 0,
      completed: 4,
    });
    const latestPlan = extractLatestPlanFromMessages(messages, "session-plan-ui");
    expect(latestPlan?.summary).toEqual({
      total: 4,
      pending: 0,
      inProgress: 0,
      completed: 4,
    });
    expect(latestPlan?.items[3]?.content).toBe("Add xAI model");
  });
});
