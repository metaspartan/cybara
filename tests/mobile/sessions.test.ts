import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/src", import.meta.url));
const read = (rel: string) => readFileSync(`${root}/${rel}`, "utf8");

describe("mobile: chat management", () => {
  const screen = read("screens/DashboardScreen.tsx");

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

  test("chat composer exposes agent switching and context usage", () => {
    const api = read("lib/api.ts");
    const newChat = read("components/NewChatPanel.tsx");
    const styles = read("screens/dashboardStyles.ts");
    expect(api).toContain("interface SessionContextUsage");
    expect(api).toContain("updateSessionAgent(");
    expect(api).toContain("/api/sessions/${encodeURIComponent(id)}/agent");
    expect(screen).toContain("const changeSessionAgent");
    expect(screen).toContain("const openAgentSelector");
    expect(screen).toContain("const openToolApprovalSelector");
    expect(screen).toContain("Tool approvals: ${toolApprovalLabel}");
    expect(screen).toContain("mobileContextUsageDetail(");
    expect(screen).toContain("Context: ${mobileContextUsageDetail(contextUsage)}");
    expect(screen).toContain("mobileProviderPlanFor(providerPlanStatus");
    expect(screen).toContain("mobileProviderPlanDetail(activeProviderPlan)");
    expect(screen).toContain('text: "Change agent"');
    expect(screen).toContain('text: "Tool approvals"');
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
