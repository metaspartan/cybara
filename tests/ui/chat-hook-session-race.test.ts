import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const hookPath = join(process.cwd(), "ui", "src", "hooks", "useChat.ts");

describe("useChat session race guards", () => {
  test("ignores stale in-flight responses after a session switch", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("if (!queuedSend && activeRequestAbortRef.current !== controller)");
    expect(source).toContain("prev.sessionId !== requestSessionId");
  });

  test("does not abort the active request when queueing a follow-up", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("const queuedSend = !!queueMode");
    expect(source).toContain("if (!queuedSend) {");
    expect(source).toContain("activeRequestAbortRef.current?.abort();");
  });

  test("assigns a session id before the first response so follow-ups can queue", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("!queuedSend ? crypto.randomUUID() : null");
    expect(source).toContain("sessionId: requestSessionId ?? prev.sessionId");
    expect(source).toContain("requestSessionId || undefined");
    expect(source).toContain("clientPendingId?: string");
    expect(source).toContain("options?.clientPendingId");
  });

  test("does not optimistically add queued follow-ups to the transcript", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain(
      "messages: queuedSend ? prev.messages : [...prev.messages, userMessage]"
    );
    expect(source).toContain("queuedSend ? prev.messages");
    expect(source).toContain(
      "queuedSend\n                  ? [...prev.messages, userMessage, response.data!.message]"
    );
  });

  test("keeps in-flight requests alive when loading another session", () => {
    const source = readFileSync(hookPath, "utf8");
    const loadSessionBlock = source.slice(source.indexOf("const loadSession = useCallback"));
    expect(loadSessionBlock).toContain("setState((prev)");
    expect(loadSessionBlock).toContain("readCachedSessionMessages(sessionId)");
    expect(loadSessionBlock).toContain("enrichReloadedMessages(reference, messages)");
    expect(loadSessionBlock).not.toContain("activeRequestAbortRef.current?.abort();");
  });

  test("can append a steered user message without ending the active run", () => {
    const source = readFileSync(hookPath, "utf8");
    const appendStart = source.indexOf("const appendSessionMessage = useCallback");
    const appendEnd = source.indexOf("const setWorkspaceDir = useCallback", appendStart);
    const appendBlock = source.slice(appendStart, appendEnd);
    expect(appendBlock).toContain("prev.sessionId !== sessionId");
    expect(appendBlock).toContain(
      "messages: alreadyPresent ? prev.messages : [...prev.messages, message]"
    );
    expect(appendBlock).not.toContain("isLoading: false");
  });
});
