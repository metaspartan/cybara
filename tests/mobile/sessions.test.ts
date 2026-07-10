import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: chat management", () => {
  const screen =
    read("screens/DashboardScreen.tsx") +
    read("screens/dashboardSessionDetail.tsx") +
    read("screens/dashboardSurfaceData.ts");

  test("long-pressing a chat offers a native delete confirmation", () => {
    expect(screen).toContain("onLongPress={() => confirmDeleteSession(session)}");
    expect(screen).toContain("const confirmDeleteSession");
    // native destructive action sheet on iOS, Alert on Android
    expect(screen).toContain("destructiveButtonIndex: 0");
    expect(screen).toContain('style: "destructive"');
  });

  test("delete calls the gateway deleteSession and refreshes", () => {
    const api = read("lib/api.ts");
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
    const api = read("lib/api.ts");
    const styles = read("screens/dashboardStyles.ts");
    expect(api).toContain("interrupted?: boolean");
    expect(api).toContain("pendingChatMessages(sessionId: string)");
    expect(api).toContain("reorderPendingMessages(");
    expect(api).toContain("updatePendingMessage(");
    expect(api).toContain("deletePendingMessage(");
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
    expect(screen).toContain("Edit queued message");
    expect(styles).toContain("pendingQueueActions:");
    expect(styles).toContain("pendingEditCard:");
    expect(styles).toContain("pendingOrderControls:");
  });

  test("active messages and live work survive chat navigation", () => {
    const liveCache = read("screens/dashboardLiveChat.ts");
    const optimisticTranscript = read("screens/dashboardOptimisticTranscript.ts");

    expect(screen).toContain("writeCachedMobileOptimisticTranscriptMessage(sessionId, optimistic)");
    expect(screen).toContain(
      "mergeCachedMobileOptimisticTranscript(sessionId, nextDetail.messages)"
    );
    expect(screen).toContain("const existing = sessionRefreshInFlight.current");
    expect(screen).toContain("return existing.promise");
    expect(liveCache).toContain(
      "mergeMobileLiveActivities(currentActivities, snapshot.activities)"
    );
    expect(liveCache).not.toContain("return next.slice(-12)");
    expect(optimisticTranscript).toContain("acknowledgedByPersistedHistory");
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

  test("mobile chat renders session plans above messages and keeps chat text selectable", () => {
    const api = read("lib/api.ts");
    const chat = read("screens/dashboardChat.tsx");
    const styles = read("screens/dashboardStyles.ts");
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
    expect(planCard).toBeGreaterThan(0);
    expect(messageLoop).toBeGreaterThan(planCard);
    expect(chat).toContain("selectable?: boolean;");
    expect(chat).toContain("<Text key={index} selectable={selectable} style={styles.mdBold}>");
    expect(chat).toContain("<Text key={index} selectable={selectable} style={styles.mdItalic}>");
    expect(chat).toContain("<Text key={index} selectable={selectable} style={styles.mdStrike}>");
    expect(chat).toContain(
      "<Text key={index} selectable={selectable} style={styles.mdInlineCode}>"
    );
    expect(chat).toContain("<Text key={index} selectable={selectable}>");
    expect(chat).toContain("<Text selectable style={styles.mdListMarker}>");
    expect(chat).toContain("<Text selectable style={styles.mdListText}>");
    expect(chat).toContain("<Text selectable style={styles.mdQuoteText}>");
    expect(chat).toContain("<Text selectable style={styles.mdTableHeaderText}>");
    expect(chat).toContain("<Text selectable style={styles.mdTableCellText}>");
    expect(chat).toContain("<Text selectable style={styles.workedForText}>");
    expect(chat).toContain("<Text selectable style={styles.messageActivityGroupLabel}>");
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
    const api = read("lib/api.ts");
    const newChat = read("components/NewChatPanel.tsx");
    const metricsPanels = read("screens/dashboardMetricsPanels.tsx");
    const styles = read("screens/dashboardStyles.ts");
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
    expect(screen).toContain("const changeSessionAgent");
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
});
