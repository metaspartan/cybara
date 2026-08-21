import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMobileChatSource } from "../source-fixtures";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");
const readApi = (): string =>
  read("lib/api.ts") + read("lib/api-types.ts") + read("lib/api-normalizers.ts");
const readStyles = (): string =>
  read("screens/dashboardStyles.ts") + read("screens/dashboardChatStyles.ts");

describe("mobile: chat management", () => {
  const screen =
    read("screens/DashboardScreen.tsx") +
    readMobileChatSource() +
    read("screens/dashboardSurfaceData.ts");

  test("long-pressing a chat offers a native delete confirmation", () => {
    expect(screen).toContain("onLongPress={() => confirmDeleteSession(session)}");
    expect(screen).toContain("const confirmDeleteSession");
    expect(screen).toContain("destructiveButtonIndex: 0");
    expect(screen).toContain('style: "destructive"');
  });

  test("delete calls the gateway deleteSession and refreshes", () => {
    const api = readApi();
    expect(api).toContain("deleteSession(id: string)");
    expect(screen).toContain("await api.deleteSession(id)");
  });

  test("chat rows and delete confirmations use normalized titles instead of raw session ids", () => {
    expect(screen).toContain("mobileSessionTitle(session)");
    expect(screen).toContain("compactLastUpdatedLabel(session)");
    expect(screen).toContain("styles.sessionListTime");
    expect(screen).toContain("const title = mobileSessionTitle(session);");
    expect(screen).toContain("mobileFirstNonEmptyString(detail?.title, sessionSummary?.title)");
    expect(screen).toContain("mobileFirstNonEmptyString(detail?.model, sessionSummary?.model)");
    expect(screen).not.toContain("session.id.slice");
    expect(screen).not.toContain("Session ID:");
  });

  test("queued follow-ups render as pending rows and only real pending ids can steer", () => {
    const api = readApi();
    const styles = readStyles();
    expect(api).toContain("interrupted?: boolean");
    expect(api).toContain("pendingChatMessages(sessionId: string)");
    expect(api).toContain("reorderPendingMessages(");
    expect(api).toContain("updatePendingMessage(");
    expect(api).toContain("deletePendingMessage(");
    expect(api).toContain("stopChatSession(sessionId: string)");
    expect(screen).toContain("optimisticPendingMessageId");
    expect(screen).toContain(
      "`optimistic-${liveStartedAt}-${optimisticPendingCounterRef.current}`"
    );
    expect(screen).toContain("clientPendingId: optimisticPendingMessageId");
    expect(api).toContain("clientPendingId?: string");
    expect(screen).toContain("mobilePendingMessageIsOptimistic(pendingMessage)");
    expect(screen).toContain("Array.isArray(result.pendingMessages)");
    expect(screen).toContain("result.interrupted");
    expect(screen).toContain("void hydratePendingMessages();");
    expect(screen).toContain("optimisticPendingGraceUntilRef.current = Date.now() + 30_000");
    expect(screen).toContain("preserveOptimistic: preserveOptimisticPending");
    expect(screen).toContain("api.reorderPendingMessages(");
    expect(screen).toContain("api.updatePendingMessage(");
    expect(screen).toContain("api.deletePendingMessage(");
    expect(screen).toContain("mobilePreSteerProcessActivities(liveAssistant)");
    expect(screen).toContain("await loadSession(false);");
    expect(api).toContain("options?: MobileSteerPendingMessageOptions");
    expect(api).toContain("JSON.stringify({ processActivities })");
    expect(screen).toContain('accessibilityLabel="Move pending message up"');
    expect(screen).toContain('accessibilityLabel="Move pending message down"');
    expect(screen).toContain('accessibilityLabel="Edit pending message"');
    expect(screen).toContain('accessibilityLabel="Delete pending message"');
    expect(screen).toContain('accessibilityLabel="Steer pending message"');
    expect(screen).toContain('? "Stop response"');
    expect(screen).toContain("api.stopChatSession(sessionId)");
    expect(screen).toContain("<Square");
    expect(screen).toContain("Edit queued message");
    expect(styles).toContain("pendingQueueActions:");
    expect(styles).toContain("pendingEditCard:");
    expect(styles).toContain("pendingOrderControls:");
  });

  test("active messages and live work survive chat navigation", () => {
    const liveCache = read("screens/dashboardLiveChat.ts");
    const optimisticTranscript = read("screens/dashboardOptimisticTranscript.ts");

    expect(screen).toContain("writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic)");
    expect(screen).toContain("mergeCachedMobileOptimisticTranscript(");
    expect(screen).toContain("nextDetail.messages");
    expect(screen).toContain("const existing = sessionRefreshInFlight.current");
    expect(screen).toContain("return existing.promise");
    expect(liveCache).toContain("mergeMobileLiveActivities(currentActivities, incomingActivities)");
    expect(read("lib/mobileStatusStream.ts")).toContain("replayBuffer.consume(");
    expect(read("screens/useMobileSessionRuntime.ts")).toContain("replayBufferedEvents: true");
    expect(read("screens/dashboardChat.tsx")).toContain(
      "<MobileThinkingOrb reduceMotion={reduceMotion} state={statusState}"
    );
    expect(read("screens/dashboardChat.tsx")).toContain(
      'statusState || activity.phase === "start"'
    );
    expect(liveCache).not.toContain("return next.slice(-12)");
    expect(optimisticTranscript).toContain("acknowledgedByPersistedHistory");
    expect(read("lib/api.ts")).not.toContain("calls.slice(0, 20)");
    expect(read("screens/useMobileSessionRuntime.ts")).toContain("}, [loadSession, sessionId]);");
    expect(read("screens/useMobileSessionRuntime.ts")).not.toContain(
      "}, [loadSession, sessionId, sessionSummary]);"
    );
  });

  test("live chat follows new content only while the reader remains near the bottom", () => {
    const screen = read("screens/dashboardSessionDetail.tsx");
    const runtime = read("screens/useMobileSessionRuntime.ts");

    expect(screen).toContain("followChatBottomRef.current = true;");
    expect(screen).toContain("if (!followChatBottomRef.current) return;");
    expect(screen).toContain("if (!chatScrollGestureActiveRef.current) return;");
    expect(screen).toContain("onScrollBeginDrag={() => {");
    expect(screen).toContain("followChatBottomRef.current = false;");
    expect(screen).toContain("Math.max(composerBarHeight, MOBILE_CHAT_CHROME.composerHeight)");
    expect(runtime).not.toContain("scrollToEnd");
    expect(runtime).not.toContain("requestAnimationFrame");
  });

  test("chat composer uses measured keyboard avoidance on both mobile platforms", () => {
    const screen = read("screens/dashboardSessionDetail.tsx");

    expect(screen).toContain("KeyboardAvoidingView");
    expect(screen).toContain('if (Platform.OS === "android")');
    expect(screen).toContain('behavior="height"');
    expect(screen).toContain("keyboardVerticalOffset={keyboardVerticalOffset}");
    expect(screen).toContain(
      "<ChatKeyboardContainer keyboardVerticalOffset={insets.top + spacing.xs}>"
    );
    expect(screen).toContain("const [keyboardVisible, setKeyboardVisible]");
    expect(screen).toContain("const [keyboardHeight, setKeyboardHeight]");
    expect(screen).toContain(
      'const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"'
    );
    expect(screen).toContain(
      'const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"'
    );
    expect(screen).toContain("Keyboard.addListener(showEvent");
    expect(screen).toContain("Keyboard.addListener(hideEvent");
    expect(screen).toContain("setKeyboardVisible(nextKeyboardHeight > 0)");
    expect(screen).toContain('"keyboardDidShow"');
    expect(screen).toContain('"keyboardDidHide"');
    expect(screen).toContain('const keyboardOffset = Platform.OS === "ios" ? keyboardHeight : 0');
    expect(screen).toContain("keyboardOffset + spacing.xs");
  });

  test("saved reduce-motion settings disable live indicators", () => {
    const chat = read("screens/dashboardChat.tsx");
    const runtime = read("screens/useMobileSessionRuntime.ts");
    const indicator = read("components/MobileThinkingOrb.tsx");

    expect(chat).toContain("reduceMotion={appearance.reduceMotion}");
    expect(indicator).toContain("reduceMotionOverride ?? systemReduceMotion");
    expect(runtime).not.toContain("animated: true");
  });

  test("persisted screenshot markdown uses the authenticated mobile media gallery", () => {
    const chat = read("screens/dashboardChat.tsx");
    const formatter = read("lib/chat-format.ts");

    expect(formatter).toContain("export function extractMobileMarkdownImages");
    expect(chat).toContain('presentProviderProtocolText(message.content || "").content');
    expect(chat).toContain("const markdown = extractMobileMarkdownImages(presentedContent)");
    expect(chat).toContain("mediaUrl(image.filePath)");
    expect(chat).toContain("new Set([...markdownImageUris, ...toolImageUris])");
    expect(chat).toContain("content = markdown.content");
  });

  test("mobile code blocks match desktop metadata without stretching message bubbles", () => {
    const chat = read("screens/dashboardChat.tsx");
    const styles = readStyles();

    expect(chat).toContain("mobileCodeLineCount(content)");
    expect(chat).toContain('accessibilityLabel={copied ? "Code copied" : "Copy code"}');
    expect(chat).toContain("style={styles.codeScroll}");
    expect(styles).toContain("codeScroll:");
    expect(styles).toContain("flexGrow: 0");
    expect(styles).toContain("flexShrink: 1");
  });

  test("chat images open in an in-app preview without sending bearer URLs to another app", () => {
    const chat = read("screens/dashboardChat.tsx");

    expect(chat).toContain('accessibilityLabel="Preview image"');
    expect(chat).toContain("setPreviewVisible(true)");
    expect(chat).toContain('<Modal\n        animationType="fade"');
    expect(chat).toContain('accessibilityLabel="Close image preview"');
    expect(chat).not.toContain("openAllowedExternalUrl(uri)");
  });

  test("queued follow-ups stay above the composer instead of entering the message transcript", () => {
    const messageLoop = screen.indexOf("{visibleMessages.map((message, index) => (");
    const pendingQueue = screen.indexOf("{pendingMessages.length > 0 ? (");
    const composer = screen.indexOf("<LiquidGlass", pendingQueue);
    const optimisticUserAppend = screen.indexOf("messages: [...current.messages, optimistic]");

    expect(messageLoop).toBeGreaterThan(0);
    expect(pendingQueue).toBeGreaterThan(messageLoop);
    expect(composer).toBeGreaterThan(pendingQueue);
    expect(optimisticUserAppend).toBeGreaterThan(0);
    expect(screen.indexOf("if (!queuedSend)", optimisticUserAppend - 700)).toBeGreaterThan(0);
  });

  test("mobile chat renders active session plans above messages and keeps chat text selectable", () => {
    const api = readApi();
    const chat = read("screens/dashboardChat.tsx");
    const styles = readStyles();
    const planCard = screen.indexOf("<MobilePlanSummaryCard plan={detail.plan} />");
    const messageLoop = screen.indexOf("{visibleMessages.map((message, index) => (");

    expect(api).toContain("interface SessionPlanSnapshot");
    expect(api).toContain("plan?: SessionPlanSnapshot | null");
    expect(api).toContain("plan: normalizeSessionPlan(record?.plan)");
    expect(api).toContain("content: content.slice(0, 500)");
    expect(api).toContain(".slice(0, 50)");
    expect(chat).toContain("export function MobilePlanSummaryCard");
    expect(chat).toContain("mobilePlanProgressLabel(plan)");
    expect(chat).toContain("mobileCurrentPlanItem(plan)");
    expect(chat).toContain("Latest plan update");
    expect(screen).toContain("sessionActive && detail.plan");
    expect(planCard).toBeGreaterThan(0);
    expect(messageLoop).toBeGreaterThan(planCard);
    expect(chat).toContain("selectable?: boolean;");
    expect(chat).toContain("<Text key={index} selectable={selectable} style={styles.mdBold}>");
    expect(chat).toContain("<Text key={index} selectable={selectable} style={styles.mdItalic}>");
    expect(chat).toContain("<Text key={index} selectable={selectable} style={styles.mdStrike}>");
    expect(chat).toContain("styles.mdInlineCode,");
    expect(chat).toContain("selectable={selectable}");
    expect(chat).toContain("getChatCodeFontSizePixels(appearance.codeFontSize)");
    expect(chat).toContain("<Text key={index} selectable={selectable}>");
    expect(chat).toContain("<Text selectable style={[styles.mdListMarker, bodyStyle]}>");
    expect(chat).toContain("<Text selectable style={[styles.mdListText, bodyStyle]}>");
    expect(chat).toContain("<Text selectable style={[styles.mdQuoteText, bodyStyle]}>");
    expect(chat).toContain("<Text selectable style={styles.mdTableHeaderText}>");
    expect(chat).toContain("<Text selectable style={styles.mdTableCellText}>");
    expect(chat).toContain("<Text selectable style={[styles.workedForText, activityStyle]}>");
    expect(chat).toContain(
      "<Text selectable style={[styles.messageActivityGroupLabel, activityStyle]}>"
    );
    expect(chat).toContain("selectable = true");
    expect(chat).toContain('accessibilityLabel="Add message to chat"');
    expect(chat).toContain("onAddToChat?: (content: string) => void");
    expect(screen).toContain("onAddToChat={appendTextToComposer}");
    expect(screen).toContain("contextMenuHidden={false}");
    expect(screen).toContain("selectionColor={accentColor}");
    expect(styles).toContain("mobilePlanCard:");
    expect(styles).toContain("mobilePlanProgressFill:");
  });

  test("chat composer exposes agent switching and context usage", () => {
    const api = readApi();
    const newChat = read("components/NewChatPanel.tsx");
    const metricsPanels = read("screens/dashboardMetricsPanels.tsx");
    const styles = readStyles();
    expect(api).toContain("interface SessionContextUsage");
    expect(api).toContain("interface SessionTokenUsage");
    expect(api).toContain("tokenUsage?: SessionTokenUsage");
    expect(api).toContain("normalizeSessionTokenUsage(");
    expect(api).toContain("updateSessionAgent(");
    expect(api).toContain("useModelRouter?: boolean");
    expect(api).toContain("if (input.useModelRouter === true)");
    expect(api).toContain("body.useModelRouter = true");
    expect(api).toContain("/api/sessions/${encodeURIComponent(id)}/agent");
    expect(newChat).toContain("Model Router");
    expect(newChat).toContain(".routerConfig()");
    expect(newChat).toContain("useModelRouter");
    expect(newChat).toContain("mobileSupportedReasoningEfforts(");
    expect(newChat).toContain("selectedAgent?.reasoning_mode");
    expect(newChat).toContain("selectedAgent?.reasoning_efforts");
    expect(newChat).toContain("api.updateAgentReasoning(selectedAgent.id, effort)");
    expect(newChat).toContain("Reasoning effort:");
    expect(newChat).toContain("ActionSheetIOS.showActionSheetWithOptions(");
    expect(screen).toContain("const changeSessionAgent");
    expect(screen).toContain("selectedAgent?.reasoning_mode");
    expect(screen).toContain("selectedAgent?.reasoning_efforts");
    expect(screen).toContain("const openAgentSelector");
    expect(screen).toContain("MOBILE_MODEL_ROUTER_SELECTOR_VALUE");
    expect(screen).toContain("setUseModelRouter(true)");
    expect(screen).toContain("useModelRouter,");
    expect(screen).toContain("const openToolApprovalSelector");
    expect(screen).toContain("function ChatSettingsSheet(");
    expect(screen).toContain("PanResponder.create");
    expect(screen).toContain("useWindowDimensions");
    expect(screen).toContain("const [expanded, setExpanded] = useState(true)");
    expect(screen).toContain("setExpanded(true)");
    expect(screen).toContain("setExpanded(false)");
    expect(screen).toContain("height: sheetHeight");
    expect(screen).toContain("styles.chatSettingsDragHandle");
    expect(screen).toContain("styles.chatSettingsScroll");
    expect(screen).toContain("const chatSettingsRows");
    expect(screen).toContain('label: "Tool approvals"');
    expect(screen).toContain('label: "Reasoning"');
    expect(screen).toContain('label: "Reasoning effort"');
    expect(screen).toContain("api.updateAgentReasoning(selectedAgent.id, effort)");
    expect(screen).toContain("mobileContextUsageDetail(");
    expect(screen).toContain("mobileSessionTokenUsageDetail(");
    expect(screen).toContain('label: "Context"');
    expect(screen).toContain("mobileProviderPlanFor(providerPlanStatus");
    expect(screen).toContain("mobileProviderPlanDetail(activeProviderPlan)");
    expect(metricsPanels).toContain("!plan?.managedAutomatically");
    expect(metricsPanels).toContain("Plan usage: 5h");
    expect(metricsPanels).toContain('percentFor("rolling_5h")');
    expect(metricsPanels).toContain('percentFor("rolling_week")');
    expect(metricsPanels).toContain("mobileProviderPlanResetLabel");
    expect(metricsPanels).toContain('window.unlimited ? "∞"');
    expect(metricsPanels).toContain("Math.ceil(window.usedPercent ?? 0)");
    expect(screen).toContain('label: "Change agent"');
    expect(screen).toContain('label: "Tool approvals"');
    expect(screen).toContain("setPendingSessionAgentId(agentId)");
    expect(screen).toContain("contextUsage: result.contextUsage ?? current.contextUsage");
    expect(newChat).toContain("<Text style={styles.sectionTitle}>Permissions</Text>");
    expect(newChat).toContain("api.updateConfig({ tool_approval_mode: nextMode })");
    expect(newChat).toContain("Set tool approvals to");
    expect(newChat).toContain("CircleHelp");
    expect(newChat).toContain("ShieldAlert");
    expect(newChat).toContain('const tone = mode === "ask" ? colors.blueText : colors.amber');
    expect(screen).toContain("<ShieldAlert color={colors.amber}");
    expect(styles).not.toContain("composerSettingsButton:");
    expect(styles).not.toContain("contextUsageDot:");
  });

  test("new chats navigate immediately and hydrate from optimistic state", () => {
    const newChat = read("components/NewChatPanel.tsx");
    const detail = readMobileChatSource();
    const dashboard = read("screens/DashboardScreen.tsx");
    const startedIndex = newChat.indexOf("onCreated(sessionId)");
    const requestIndex = newChat.indexOf(".sendChat({", startedIndex);

    expect(startedIndex).toBeGreaterThan(0);
    expect(requestIndex).toBeGreaterThan(startedIndex);
    expect(newChat).toContain("const sessionId = createMobileSessionId()");
    expect(newChat).toContain("writeCachedMobileOptimisticTranscriptMessage(sessionId");
    expect(newChat).toContain("writeCachedMobileLiveAssistant(");
    expect(newChat).toContain("sessionId,");
    expect(dashboard).toContain("onSettled={refreshSummary}");
    expect(detail).toContain("optimisticMobileSessionDetail(sessionId, sessionSummary)");
    expect(detail).toContain("current?.id === sessionId");
    expect(detail).toContain("setLoadError(null)");
  });

  test("stopping a response reloads persisted activity before clearing the live overlay", () => {
    const detail = read("screens/dashboardSessionDetail.tsx");
    const reloadIndex = detail.indexOf("await loadSession(false);", detail.indexOf("stopResponse"));
    const refreshIndex = detail.indexOf("refreshSummary();", reloadIndex);
    const clearIndex = detail.indexOf("commitLiveAssistant(() => null);", reloadIndex);
    expect(reloadIndex).toBeGreaterThan(0);
    expect(refreshIndex).toBeGreaterThan(reloadIndex);
    expect(clearIndex).toBeGreaterThan(reloadIndex);
  });

  test("completed turns refresh the shared session summary", () => {
    const detail = read("screens/dashboardSessionDetail.tsx");
    const runtime = read("screens/useMobileSessionRuntime.ts");
    const dashboard = read("screens/DashboardScreen.tsx");

    expect(detail).toContain("onSessionUpdated,");
    expect(detail).toContain("await loadSession(false);\n      refreshSummary();");
    expect(runtime).toContain("onSessionUpdatedRef.current(reconciledDetail)");
    expect(dashboard).toContain("mergeSessionDetailIntoSummary(current, detail)");
  });

  test("uses authoritative active state for queueing and live timing", () => {
    const detail = read("screens/dashboardSessionDetail.tsx");
    const runtime = read("screens/useMobileSessionRuntime.ts");
    expect(detail).toContain(
      "const chatBusy = sending || sessionActive || pendingMessages.length > 0;"
    );
    expect(detail).toContain("message.id === liveAssistant?.id && sessionActive");
    expect(detail).toContain("? liveNowMs");
    expect(detail).not.toContain(
      "const chatBusy = sending || !!liveAssistant || pendingMessages.length > 0;"
    );
    expect(runtime).toContain("const active = serverReportsActive;");
    expect(runtime).not.toContain("snapshotStatus ===");
  });
});
