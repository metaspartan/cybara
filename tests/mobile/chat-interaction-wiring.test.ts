import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("../../apps/mobile/src/screens/dashboardSessionDetail.tsx", import.meta.url)
).text();
const dashboard = await Bun.file(
  new URL("../../apps/mobile/src/screens/DashboardScreen.tsx", import.meta.url)
).text();

describe("mobile chat interaction wiring", () => {
  test("only an explicit recovery action can restore a failed send to the composer", () => {
    const send = source.slice(
      source.indexOf("const sendMessage = async () =>"),
      source.indexOf("const steerPendingMessage = async")
    );
    expect(send).not.toContain("setComposerDraft(message);");
    expect(send).not.toContain("setPendingImages(attachments);");
    expect(send).toContain("const message = draftRef.current.trim();");
    expect(send.indexOf("resetComposerDraft();")).toBeLessThan(send.indexOf("await api.sendChat("));
    expect(send).toContain("await recoverMobileChatSubmission(");
    expect(send).toContain('text: "Restore prompt", onPress: restore');
    expect(send).toContain("restoreText: appendTextToComposer");
    expect(send).toContain("restoreImages: appendPendingImages");
  });

  test("an unconfirmed delivery reports the failure and ends the live indicator", () => {
    const send = source.slice(
      source.indexOf("const sendMessage = async () =>"),
      source.indexOf("const steerPendingMessage = async")
    );
    const unconfirmed = send.slice(send.indexOf("if (!received) {"));
    expect(send).toContain("} catch (error) {");
    expect(send).toContain("if (!received) {");
    expect(unconfirmed).toContain("setLoadError(failureText);");
    expect(unconfirmed).toContain('phase: "error"');
    expect(unconfirmed).toContain("text: failureText");
    expect(unconfirmed).toContain("clearCachedMobileOptimisticTranscript(sessionId");
    expect(send.indexOf('phase: "error"')).toBeGreaterThan(send.indexOf("if (!received) {"));
  });

  test("switching sessions resets the scroll and composer state", () => {
    expect(dashboard).toContain("key={detailRoute.id}");
    expect(dashboard).toContain("key={route.id}");
    expect(source).toContain("() => chatScroll.dispose()");
  });
});
