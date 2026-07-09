import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const composerActionPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatComposerActionButton.tsx", import.meta.url)
);
const chatAgentControlsPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatAgentControls.tsx", import.meta.url)
);
const contextUsageRingPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ContextUsageRing.tsx", import.meta.url)
);
const environmentOverviewPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatEnvironmentOverview.tsx", import.meta.url)
);
const sidebarPath = fileURLToPath(
  new URL("../../ui/src/components/layout/Sidebar.tsx", import.meta.url)
);
const notificationsPath = fileURLToPath(
  new URL("../../ui/src/hooks/useNotifications.ts", import.meta.url)
);
const gatewayIndexPath = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const providerPlanDisplayPath = fileURLToPath(
  new URL("../../ui/src/lib/providerPlanDisplay.ts", import.meta.url)
);
const statusStreamPath = fileURLToPath(
  new URL("../../ui/src/lib/status-stream.ts", import.meta.url)
);

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("status stream websocket wiring", () => {
  test("chat page uses shared status websocket stream helper", () => {
    const source = [
      readSource(chatPath),
      readSource(chatAgentControlsPath),
      readSource(composerActionPath),
      readSource(contextUsageRingPath),
      readSource(environmentOverviewPath),
    ].join("\n");
    const displaySource = readSource(providerPlanDisplayPath);
    expect(source).toContain("connectStatusStream");
    expect(source).toContain("PendingChatQueue");
    expect(source).toContain("chatApi.steerPendingMessage");
    expect(source).toContain("chatApi.reorderPendingMessages");
    expect(source).toContain("chatApi.updatePendingMessage");
    expect(source).toContain("chatApi.deletePendingMessage");
    expect(source).toContain("chatApi.getPendingMessages");
    expect(source).toContain("chatApi.stopSession(activeChatSessionId)");
    expect(source).toContain("ChatAgentControls");
    expect(source).toContain("MODEL_ROUTER_SELECTOR_VALUE");
    expect(source).toContain("Model Router");
    expect(source).toContain('apiFetch("/api/router/config")');
    expect(source).toContain("useChat(chatAgentId, { useModelRouter })");
    expect(source).toContain("setUseModelRouter(true)");
    expect(source).toContain("useUpdateSessionAgent");
    expect(source).toContain("providerPlansApi.status()");
    expect(source).toContain("providerPlanStatus");
    expect(source).toContain("activeProviderPlan");
    expect(source).toContain("providerPlanWindowSummary");
    expect(source).toContain("providerPlanTooltipRows");
    expect(source).toContain("ProviderPlanTooltipBar");
    expect(source).toContain("Plan usage:");
    expect(source).toContain("providerPlanWindowSummary");
    expect(source).toContain("providerPlanUsageClasses(usage)");
    expect(displaySource).toContain("formatProviderPlanReset");
    expect(displaySource).toContain('value: "∞"');
    expect(displaySource).toContain("Math.ceil(window.usedPercent)");
    expect(source).toContain("context-usage-tooltip-plan");
    expect(source).toContain("context-usage-tooltip-plan-bar");
    expect(source).toContain("contextUsageLabel");
    expect(source).toContain("contextUsageTooltip");
    expect(source).toContain("var(--context-ring-track)");
    expect(source).toContain("context-usage-ring-fill");
    expect(source).toContain("context-usage-tooltip");
    expect(source).toContain("context-usage-tooltip-title");
    expect(source).not.toContain("bg-[#2b2b2f]");
    expect(source).not.toContain("bg-[#171820]");
    expect(source).not.toContain("rgba(255,255,255,0.18)");
    expect(source).toContain("ChatApprovalControls");
    expect(source).toContain('id="chat-tool-approval-mode"');
    expect(source).toContain(
      "const Icon = updating ? Loader2 : isAskMode ? CircleHelp : ShieldAlert"
    );
    expect(source).toContain('"text-sky-300"');
    expect(source).toContain('"text-amber-300"');
    expect(source).toContain("settingsApi.updateConfig({ tool_approval_mode: nextMode })");
    expect(source).toContain('id="chat-agent-selector"');
    expect(source).not.toContain('<Zap className="pointer-events-none absolute left-2');
    expect(source).not.toContain("focus-within:border-white/20");
    expect(source).toContain('data-chat-composer-input="true"');
    expect(source).toContain("setSessionAgentId(nextAgentId ?? null)");
    expect(source).toContain("setSessionContextUsage(updated.contextUsage ?? null)");
    expect(source).toContain("setSessionTokenUsage(updated.tokenUsage ?? null)");
    expect(source).toContain("SessionTokenUsage");
    expect(source).toContain("tokenUsage={sessionTokenUsage}");
    expect(source).toContain("tokenUsage.totalTokens");
    expect(source).toContain("tokenUsage.tokensPerSecond");
    expect(source).toContain("clientPendingId: optimisticPendingMessageId");
    expect(source).toContain("cacheLiveStatusSnapshot(snapshot)");
    expect(source).toContain("cacheLiveStatusEvent(payload)");
    expect(source).toContain("cacheAssistantToken(payload)");
    expect(source).toContain("STOPPED_SESSION_STATUS_SUPPRESSION_MS");
    expect(source).toContain("stoppedSessionUntilRef");
    expect(source).toContain("markSessionStopped(activeChatSessionId)");
    expect(source).toContain("isSessionStopSuppressed(payloadSessionId)");
    expect(source).toContain("isSessionStopSuppressed(tokenSessionId)");
    expect(source).toContain("!isSessionStopSuppressed(candidate)");
    expect(source).toContain("activeSessionRef.current = sessionId");
    expect(source).toContain("const refreshed = await loadSessionMutation.mutateAsync(sessionId)");
    expect(source).not.toContain("appendSessionMessages(sessionId, [preSteerMessage");
    expect(source).toContain("buildPreSteeringActivityMessage(");
    expect(source).not.toContain("const sessionStillActive =");
    expect(source).not.toContain("if (!sessionStillActive) {");
    expect(source).toContain("refreshPendingMessages(sessionId)");
    expect(source).toContain("mergePendingChatMessages(snapshot?.pendingMessages, current)");
    expect(source).toContain("readCachedOptimisticPendingMessages(sessionId)");
    expect(source).toContain("writeCachedOptimisticPendingMessages(sessionId, pendingMessages)");
    expect(source).toContain("const resetChatSession = useCallback");
    expect(source).toContain("const suppressAutoRestoreRef = useRef(false)");
    expect(source).toContain("suppressAutoRestoreRef.current = true");
    expect(source).toContain("if (suppressAutoRestoreRef.current) return");
    expect(source).toContain("activeSessionRef.current = null");
    expect(source).toContain("restoreSessionGenerationRef.current += 1");
    expect(source).toContain("resetChatSession({");
    expect(source).toContain("resetAgentSelection: true");
    expect(source).toContain("onMouseDown={(event) =>");
    expect(source).toContain("onMouseUp={() =>");
    expect(source).toContain("Drag to reorder");
    expect(source).toContain('aria-label="Edit queued message"');
    expect(source).toContain('aria-label="Delete queued message"');
    expect(source).toContain('"Context automatically compacted"');
    expect(source).toContain("canQueueCurrentMessage");
    expect(source).toContain("const locallyLoadingCurrentSession =");
    expect(source).toContain("const requestSessionId = requestedQueueMode");
    expect(source).toContain("sessionId || activeSessionRef.current || crypto.randomUUID()");
    expect(source).toContain("persistSessionId(requestSessionId)");
    expect(source).toContain("if (sessionId) {\n      persistSessionId(sessionId);\n    }");
    expect(source).toContain(".getSessionStatus()");
    expect(source).toContain("const restoreGeneration = restoreSessionGenerationRef.current");
    expect(source).toContain("const resolveFreshestActiveSessionId = async () =>");
    expect(source).toContain(
      "const freshestActiveSessionId = await resolveFreshestActiveSessionId()"
    );
    expect(source).toContain(
      "const targetSessionId = freshestActiveSessionId || persistedSessionId"
    );
    expect(source).toContain("void hydrateSessionStatus(targetSessionId)");
    expect(source).toContain("if (!restored && !freshestActiveSessionId");
    expect(source).toContain("restoreSessionGenerationRef.current !== restoreGeneration");
    expect(source).toContain('!value.startsWith("agent:")');
    expect(source).toContain("freshestActiveSessionId");
    expect(source).toContain("Failed to restore chat session");
    expect(source).toContain("Failed to inspect active chat sessions");
    expect(source).toContain("sessionId: requestSessionId");
    expect(source).toContain("sessionId: requestSessionId || undefined");
    expect(source).toContain("optimisticPendingMessageCounterRef");
    expect(source).toContain("optimisticPendingMessageId = `optimistic-${now}-");
    expect(source).toContain('message.id.startsWith("optimistic-")');
    expect(source).toContain('"Queueing..."');
    expect(source).toContain("const composerHasDraft =");
    expect(source).toContain(
      "const showStopComposerButton = showWorkingTimeline && !composerHasDraft"
    );
    expect(source).toContain(
      "const sendQueuesFollowUp = showWorkingTimeline || pendingMessages.length > 0"
    );
    expect(source).not.toContain("new EventSource(");
  });

  test("sidebar status indicator uses websocket status stream", () => {
    const source = readSource(sidebarPath);
    expect(source).toContain("connectStatusStream");
    expect(source).not.toContain("new EventSource(");
  });

  test("session sidebar keeps idle detail prefetch bounded", () => {
    const source = readSource(
      fileURLToPath(new URL("../../ui/src/pages/chat/SessionSidebar.tsx", import.meta.url))
    );
    expect(source).toContain("const SIDEBAR_IDLE_PREFETCH_LIMIT = 1");
    expect(source).toContain("const SIDEBAR_IDLE_PREFETCH_TOTAL_LIMIT = 4");
    expect(source).toContain("remainingWarmBudget <= 0");
    expect(source).toContain("Math.min(SIDEBAR_IDLE_PREFETCH_LIMIT, remainingWarmBudget)");
  });

  test("status stream helper multiplexes subscribers through one websocket", () => {
    const source = readSource(statusStreamPath);
    expect(source).toContain("const statusStreamSubscribers = new Set");
    expect(source).toContain("let statusStreamSocket: WebSocket | null = null");
    expect(source).toContain("function ensureStatusStreamConnected()");
    expect(source).toContain("notifyStatusStreamEvent(payload)");
    expect(source).toContain("statusStreamSubscribers.size === 0");
    expect(source.match(/new WebSocket/g)?.length).toBe(1);
  });

  test("chat idle status refresh is not blocked by pending process capture", () => {
    const source = readSource(chatPath);
    const idleBranch = source.slice(source.indexOf('if (status === "idle")'));
    expect(idleBranch).toContain("void refreshSessionMessagesRef.current(sessionToRefresh)");
    expect(idleBranch).toContain("if (!loadingRef.current) {");
    expect(idleBranch).not.toContain("hasPendingCaptureForVisibleSession");
  });

  test("task notifications subscribe through websocket status stream", () => {
    const source = readSource(notificationsPath);
    expect(source).toContain("connectStatusStream");
    expect(source).not.toContain("new EventSource(");
  });

  test("sse status stream sends an initial active-session snapshot", () => {
    const source = readSource(gatewayIndexPath);
    expect(source).toContain("JSON.stringify(createStatusSnapshotEvent())");
    expect(source).not.toContain('JSON.stringify({ status: "idle", timestamp: Date.now() })');
  });
});
