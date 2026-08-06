import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type ChatMessage,
  collectPlanTimelineFromMessages,
  extractLatestPlanFromMessages,
  isSessionPlanComplete,
  shouldShowSessionPlanInComposer,
} from "../../ui/src/pages/chat/chatModel";
import { readChatUiSource } from "../source-fixtures";

const chatModelPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/chatModel.ts", import.meta.url)
);
const planCardPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/PlanSummaryCard.tsx", import.meta.url)
);
const chatComposerPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatComposer.tsx", import.meta.url)
);
const chatPageHeaderPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatPageHeader.tsx", import.meta.url)
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
    readChatUiSource(),
    readFileSync(chatModelPath, "utf8"),
    readFileSync(chatComposerPath, "utf8"),
    readFileSync(chatPageHeaderPath, "utf8"),
    readFileSync(planCardPath, "utf8"),
    readFileSync(environmentOverviewPath, "utf8"),
    readFileSync(gitBranchSelectorPath, "utf8"),
    readFileSync(environmentGitHookPath, "utf8"),
    readFileSync(apiPath, "utf8"),
    readFileSync(artifactsPath, "utf8"),
  ].join("\n");
}

function readChatPageSource(): string {
  return readChatUiSource();
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
    expect(source).toContain("Session overview");
    expect(source).toContain("Active context");
    expect(source).toContain('t("chat.plan.title")');
    expect(source).toContain("extractLatestPlanFromMessages(typedMessages, sessionId)");
    expect(chatPage).toContain("useEnvironmentGitBranches(effectiveWorkspaceDir)");
    expect(chatPage).toContain("gitBranch: environmentGit.currentBranch");
    expect(source).toContain("/api/git/branches?path=");
    expect(source).toContain("GIT_BRANCH_LOAD_TIMEOUT_MS");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain('apiFetch("/api/git/branch"');
    expect(source).toContain("function GitBranchSelector");
    expect(source).toContain("Search branches");
    expect(source).toContain("New branch name");
    expect(chatPage).toContain('environmentKey={sessionId || "new-chat-environment"}');
    expect(chatPage).toContain("state.chatEnvironmentOpen");
    expect(chatPage).toContain("state.setChatEnvironmentOpen");
    expect(chatPage).not.toContain("setShowEnvironmentOverview(false);");
    expect(chatPage).toContain('data-chat-environment-reserved="true"');
    expect(chatPage).toContain("showEnvironmentOverview && !showWorkspacePanel");
    expect(environmentOverview).not.toContain("Close environment overview");
    expect(chatPage).toContain("sessionId={sessionId}");
    expect(chatPage).toContain("hiddenComposerPlanKey");
    expect(chatPage).toContain("showComposerPlan");
    expect(chatPage).toContain("shouldShowSessionPlanInComposer(");
    expect(chatPage).toContain("currentSessionIsWorking");
    expect(chatPage).not.toContain("seenEnvironmentOverviewKey");
    expect(chatPage).not.toContain("environmentOverviewSignalKey");
    expect(chatPage).not.toContain("showEnvironmentOverviewDot");
    expect(chatPage).toContain('aria-label="Environment overview"');
    expect(chatPage).toContain("<PlanSummaryCard");
    expect(chatPage).toContain("dismissible");
    expect(chatPage).toContain("expandable");
    expect(chatPage).toContain("setHiddenComposerPlanKey(currentSessionPlanKey)");
    expect(chatPage).not.toContain("collectPlanFromToolCalls");
    expect(chatPage).not.toContain("<PlanSummaryCard plan={planSummary}");
    expect(environmentOverview).not.toContain("browserOrigin");
    expect(environmentOverview).toContain("<PlanSummaryCard");
    expect(environmentOverview).toContain("onDismiss={onDismissPlan}");
    expect(environmentOverview).toContain('label="First token"');
    expect(environmentOverview).toContain('label="Output speed"');
    expect(environmentOverview).toContain("agentUsingBrowser");
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

  test("hides only completed plans from the composer", () => {
    expect(
      isSessionPlanComplete({
        sessionId: "completed-plan",
        source: "todo_tool",
        items: [{ content: "Finish work", status: "completed", priority: "medium" }],
        summary: { total: 1, pending: 0, inProgress: 0, completed: 1 },
      })
    ).toBe(true);
    expect(
      isSessionPlanComplete({
        sessionId: "active-plan",
        source: "todo_tool",
        items: [{ content: "Finish work", status: "in_progress", priority: "medium" }],
        summary: { total: 1, pending: 0, inProgress: 1, completed: 0 },
      })
    ).toBe(false);
  });

  test("shows an incomplete composer plan only for the run that produced it", () => {
    const activePlan = {
      sessionId: "active-plan",
      source: "todo_tool" as const,
      updatedAt: "2026-07-15T18:00:10.000Z",
      items: [
        { content: "Finish work", status: "in_progress" as const, priority: "medium" as const },
      ],
      summary: { total: 1, pending: 0, inProgress: 1, completed: 0 },
    };
    expect(
      shouldShowSessionPlanInComposer(activePlan, true, Date.parse("2026-07-15T18:00:08.000Z"))
    ).toBe(true);
    expect(
      shouldShowSessionPlanInComposer(activePlan, false, Date.parse("2026-07-15T18:00:08.000Z"))
    ).toBe(false);
    expect(
      shouldShowSessionPlanInComposer(activePlan, true, Date.parse("2026-07-15T18:01:00.000Z"))
    ).toBe(false);
    expect(
      shouldShowSessionPlanInComposer(
        {
          ...activePlan,
          items: [{ ...activePlan.items[0], status: "completed" as const }],
          summary: { total: 1, pending: 0, inProgress: 0, completed: 1 },
        },
        true,
        Date.parse("2026-07-15T18:00:08.000Z")
      )
    ).toBe(false);
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
      cancelled: 0,
    });
    expect(timeline[1]?.summary).toEqual({
      total: 4,
      pending: 1,
      inProgress: 1,
      completed: 2,
      cancelled: 0,
    });
    expect(timeline[2]?.summary).toEqual({
      total: 4,
      pending: 0,
      inProgress: 0,
      completed: 4,
      cancelled: 0,
    });
    const latestPlan = extractLatestPlanFromMessages(messages, "session-plan-ui");
    expect(latestPlan?.summary).toEqual({
      total: 4,
      pending: 0,
      inProgress: 0,
      completed: 4,
      cancelled: 0,
    });
    expect(latestPlan?.items[3]?.content).toBe("Add xAI model");
  });
});
