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
    expect(screen).toContain("pendingMessageIsOptimistic(pendingMessage)");
    expect(screen).toContain("result.interrupted");
    expect(screen).toContain("void hydratePendingMessages();");
    expect(screen).toContain("api.reorderPendingMessages(");
    expect(screen).toContain("api.updatePendingMessage(");
    expect(screen).toContain("api.deletePendingMessage(");
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
});
