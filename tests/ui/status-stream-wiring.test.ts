import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readChatUiSource } from "../source-fixtures";
import { readUiStylesSource } from "../shared/source-bundles";

const composerActionPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatComposerActionButton.tsx", import.meta.url)
);
const chatComposerPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatComposer.tsx", import.meta.url)
);
const chatAgentControlsPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatAgentControls.tsx", import.meta.url)
);
const chatFollowUpControlsPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatFollowUpControls.tsx", import.meta.url)
);
const contextUsageRingPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ContextUsageRing.tsx", import.meta.url)
);
const chatReasoningControlPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatReasoningControl.tsx", import.meta.url)
);
const environmentOverviewPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ChatEnvironmentOverview.tsx", import.meta.url)
);
const workspaceOpenMenuPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/WorkspaceOpenMenu.tsx", import.meta.url)
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
const useChatPath = fileURLToPath(new URL("../../ui/src/hooks/useChat.ts", import.meta.url));

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("status stream websocket wiring", () => {
  test("chat page uses shared status websocket stream helper", () => {
    const contextUsageRingSource = readSource(contextUsageRingPath);
    const reasoningSource = readSource(chatReasoningControlPath);
    const source = [
      readChatUiSource(),
      readSource(chatComposerPath),
      readSource(chatAgentControlsPath),
      readSource(chatFollowUpControlsPath),
      readSource(composerActionPath),
      contextUsageRingSource,
      reasoningSource,
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
    expect(contextUsageRingSource).toContain("aria-expanded={open}");
    expect(contextUsageRingSource).toContain("onClick={() => setOpen((current) => !current)}");
    expect(contextUsageRingSource).toContain("createPortal(tooltipContent, document.body)");
    expect(contextUsageRingSource).toContain("fixed z-[200]");
    expect(source).not.toContain("bg-[#2b2b2f]");
    expect(source).not.toContain("bg-[#171820]");
    expect(source).not.toContain("rgba(255,255,255,0.18)");
    expect(source).toContain("ChatApprovalControls");
    expect(source).toContain("ChatReasoningControl");
    expect(source).toContain("Reasoning effort");
    expect(source).toContain('role="slider"');
    expect(source).toContain('role="tooltip"');
    expect(source).toContain("onMouseEnter={() => setHelpOpen(true)}");
    expect(source).toContain("How much thinking the model does before answering.");
    expect(source).toContain("LEVEL_HINTS[option.label.toLowerCase()]");
    expect(reasoningSource).not.toContain("title={title}");
    expect(reasoningSource).not.toContain("setHovered");
    expect(source).toContain("supportedReasoningOptions");
    expect(source).toContain("useUpdateAgentReasoning");
    expect(source).toContain("chat-approval-control");
    expect(source).toContain(
      "const Icon = updating ? Loader2 : isAskMode ? CircleHelp : ShieldAlert"
    );
    expect(source).toContain('"text-sky-300"');
    expect(source).toContain('"text-amber-300"');
    expect(source).toMatch(
      /settingsApi\.updateConfig\(\{\s*tool_approval_mode:\s*nextMode,?\s*\}\)/
    );
    expect(source).toContain('controlId = "chat-agent-selector"');
    expect(source).toContain("id={controlId}");
    expect(source).toContain("chat-composer-responsive");
    expect(source).toContain("chat-approval-toggle");
    expect(source).toContain("chat-agent-selector-compact-label");
    expect(source).not.toContain('<Zap className="pointer-events-none absolute left-2');
    expect(source).not.toContain("focus-within:border-white/20");
    expect(source).toContain('data-chat-composer-input="true"');
    expect(source).toContain("setSessionAgentId(nextAgentId ?? null)");
    expect(source).toContain("setSessionContextUsage(updated.contextUsage ?? null)");
    expect(source).toContain("setSessionTokenUsage(updated.tokenUsage ?? null)");
    expect(source).toContain("SessionTokenUsage");
    expect(source).toContain("tokenUsage: sessionTokenUsage");
    expect(source).toContain("tokenUsage.totalTokens");
    expect(source).toContain("tokenUsage.tokensPerSecond");
    expect(source).toContain("clientPendingId: optimisticPendingMessageId");
    expect(source).toContain("cacheLiveStatusSnapshot(snapshot)");
    expect(source).toContain("cacheLiveStatusEvent(payload)");
    expect(source).toContain("cacheAssistantToken(payload)");
    expect(source).toContain("STOPPED_SESSION_STATUS_SUPPRESSION_MS");
    expect(source).toContain("stoppedRunSuppressionsRef");
    expect(source).toContain("latestRunIdBySessionRef");
    expect(source).toContain("markSessionStopped(activeChatSessionId)");
    expect(source).toContain("isSessionStopSuppressed(payloadSessionId, payload.runId)");
    expect(source).toContain("isSessionStopSuppressed(tokenSessionId, payload.runId)");
    expect(source).toContain("payload.activeSessions?.find");
    expect(source).toContain("await refreshSessionMessagesRef.current(resolvedSessionId)");
    expect(source).toContain("activeSessionRef.current = sessionId");
    expect(source).toContain("const refreshed = await loadSteeredSession(sessionId)");
    expect(source).not.toContain("appendSessionMessages(sessionId, [preSteerMessage");
    expect(source).toContain("buildPreSteeringActivityMessage(");
    expect(source).not.toContain("const sessionStillActive =");
    expect(source).not.toContain("if (!sessionStillActive) {");
    expect(source).toContain("refreshPendingMessages(sessionId)");
    expect(source).toContain("mergePendingChatMessages(snapshot?.pendingMessages, current, {");
    expect(source).toContain("preserveAcknowledged: true");
    expect(source).toContain("materializedPendingIds: transcriptPendingIds");
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
    expect(source).toContain('"Compacting earlier context..."');
    expect(source).toContain("canQueueCurrentMessage");
    expect(source).toContain("const currentSessionIsWorking = isLiveSessionRunning(");
    expect(source).toContain("const showWorkingTimeline = currentSessionIsWorking;");
    expect(source).toContain("const requestSessionId = requestedQueueMode");
    expect(source).toContain("sessionId || activeSessionRef.current || crypto.randomUUID()");
    expect(source).toContain("persistSessionId(requestSessionId)");
    expect(source).toContain("if (sessionId) {\n      persistSessionId(sessionId);\n    }");
    expect(source).toContain(".getSessionStatus()");
    expect(source).toContain("const restoreGeneration = restoreSessionGenerationRef.current");
    expect(source).toContain("const resolveFreshestActiveSessionId = async () =>");
    expect(source).toContain("const activeSessionLookup = resolveFreshestActiveSessionId()");
    expect(source).toContain("const restored = await restoreSessionFromId(persistedSessionId)");
    expect(source).toContain("const freshestActiveSessionId = await activeSessionLookup");
    expect(source).toContain("const statusHydration = hydrateSessionStatus(targetSessionId)");
    expect(source).toContain("await statusHydration");
    expect(source).toContain("if (restored) return;");
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
      "const showStopComposerButton = showWorkingTimeline && (!composerHasDraft || !sendQueuesFollowUp)"
    );
    expect(source).toContain(
      "followUpBehaviorEnabled && (showWorkingTimeline || pendingMessages.length > 0)"
    );
    expect(source).not.toContain("new EventSource(");
  });

  test("chat composer controls collapse by available composer width", () => {
    const chatSource = readChatUiSource() + readSource(chatComposerPath);
    const controlsSource = readSource(chatAgentControlsPath);
    const followUpControlsSource = readSource(chatFollowUpControlsPath);
    const cssSource = readUiStylesSource();

    expect(chatSource).toContain("chat-composer-responsive");
    expect(followUpControlsSource).toContain("chat-approval-control");
    expect(controlsSource).toContain("chat-agent-selector-compact-label");
    expect(controlsSource).toContain("selectedAgent?.model || selectedAgent?.name");
    expect(cssSource).toContain("container-type: inline-size");
    expect(cssSource).toContain("@container (max-width: 460px)");
    expect(cssSource).toContain("color: transparent !important");
    expect(cssSource).toContain("-webkit-text-fill-color: transparent");
  });

  test("sidebar status indicator uses websocket status stream", () => {
    const source = readSource(sidebarPath);
    expect(source).toContain("connectStatusStream");
    expect(source).not.toContain("new EventSource(");
  });

  test("session sidebar does not background-prefetch full tool-call details", () => {
    const source = readSource(
      fileURLToPath(new URL("../../ui/src/pages/chat/SessionSidebar.tsx", import.meta.url))
    );
    expect(source).toContain("const cached = loadSession.getCached(sessionId)");
    expect(source).not.toContain("loadSession.prefetch");
    expect(source).not.toContain("requestIdleCallback");
    expect(source).not.toContain("warmedSessionIdsRef");
  });

  test("chat session selection uses bounded session detail payloads", () => {
    const source = readSource(useChatPath);
    const loadSessionDetail = source.slice(source.indexOf("const loadSessionDetail"));
    expect(loadSessionDetail).toContain(
      "chatApi.getSession(sessionId, { signal: controller.signal })"
    );
    expect(loadSessionDetail).toContain("SESSION_DETAIL_TIMEOUT_MS");
    expect(loadSessionDetail).toContain(
      "queryFn: ({ signal }) => loadSessionDetail(sessionId, signal)"
    );
    expect(loadSessionDetail).not.toContain("includeFullToolCalls: true");
  });

  test("workspace open targets are lazy-loaded with a fallback timeout", () => {
    const source = readSource(workspaceOpenMenuPath);
    expect(source).toContain("WORKSPACE_TARGET_LOAD_TIMEOUT_MS");
    expect(source).toContain("FALLBACK_WORKSPACE_TARGETS");
    expect(source).toContain("targetLoadAbortRef");
    expect(source).toContain("workspaceOpenApi.targets(trimmedWorkspace, controller.signal)");
    expect(source).toContain("if (!open || !trimmedWorkspace || targets.length > 0 || loading)");
    expect(source).toContain("whitespace-nowrap rounded-lg");
    expect(source).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => \{/);
    const resetStart = source.indexOf("setTargets([]);");
    const resetEnd = source.indexOf("useEffect(() => {\n    if (!open", resetStart);
    const resetEffect = source.slice(resetStart, resetEnd);
    expect(resetEffect).toContain("setTargets([])");
    expect(resetEffect).not.toContain("void loadTargets();");
  });

  test("workspace editor marks remain visible across light and dark themes", () => {
    const source = readSource(workspaceOpenMenuPath);
    expect(source).toContain('new Set(["cursor", "windsurf", "pearai"])');
    expect(source).toContain('MONOCHROME_TARGET_IDS.has(target.id) && "invert dark:invert-0"');
  });

  test("status stream helper multiplexes subscribers through one websocket", () => {
    const source = readSource(statusStreamPath);
    expect(source).toContain("const statusStreamSubscribers = new Set");
    expect(source).toContain("let statusStreamSocket: WebSocket | null = null");
    expect(source).toContain("function ensureStatusStreamConnected()");
    expect(source).toContain("notifyStatusStreamEvent(payload)");
    expect(source).toContain("statusStreamSubscribers.size === 0");
    expect(source).toContain("STATUS_STREAM_HEARTBEAT_MS");
    expect(source).toContain("STATUS_STREAM_STALE_MS");
    expect(source).toContain("recordStatusStreamReplayEvent(payload)");
    expect(source).toContain("consumeStatusStreamReplayEvents()");
    expect(source).toContain('socket.send("ping")');
    expect(source).toContain('if (String(event.data) === "pong") return;');
    expect(source.match(/createAuthenticatedWebSocket/g)?.length).toBe(2);
    expect(source).not.toContain("appendApiTokenParam");
  });

  test("chat consumes status events buffered while its route is unmounted", () => {
    const chatSource = readChatUiSource();
    expect(chatSource).toContain("replayBufferedSessionEvents: true");
    expect(chatSource).toContain("sequence: cached.sequence");
  });

  test("chat idle status refresh is not blocked by pending process capture", () => {
    const source = readChatUiSource();
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
