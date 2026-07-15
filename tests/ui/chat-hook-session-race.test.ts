import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const hookPath = join(process.cwd(), "ui", "src", "hooks", "useChat.ts");
const chatPagePath = join(process.cwd(), "ui", "src", "pages", "Chat.tsx");

describe("useChat session race guards", () => {
  test("ignores stale in-flight responses after a session switch", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain(
      "activeRequestControllersRef.current.get(requestSessionId) !== controller"
    );
    expect(source).toContain("prev.sessionId !== requestSessionId");
  });

  test("keeps requests isolated by session while queueing follow-ups", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("const queuedSend = !!queueMode");
    expect(source).toContain("useRef<Map<string, AbortController>>(new Map())");
    expect(source).toContain("activeRequestControllersRef.current.get(requestSessionId)?.abort()");
    expect(source).toContain(
      "activeRequestControllersRef.current.set(requestSessionId, controller)"
    );
  });

  test("assigns a session id before the first response so follow-ups can queue", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain("!queuedSend ? crypto.randomUUID() : null");
    expect(source).toContain("sessionId: requestSessionId ?? prev.sessionId");
    expect(source).toContain("requestSessionId || undefined");
    expect(source).toContain("clientPendingId?: string");
    expect(source).toContain("options?.clientPendingId");
  });

  test("keeps the requested workspace visible while a new session is starting", () => {
    const source = readFileSync(hookPath, "utf8");
    expect(source).toContain(
      "options?.workspaceDir !== undefined ? options.workspaceDir : state.workspaceDir"
    );
    expect(source).toContain("workspaceDir: requestedWorkspaceDir ?? prev.workspaceDir");
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
    expect(loadSessionBlock).toContain(
      "enrichReloadedMessages(reference, messages, { preserveReferenceTail })"
    );
    expect(loadSessionBlock).not.toContain("activeRequestControllersRef.current.get");
  });

  test("clearing the visible chat does not abort background sessions", () => {
    const source = readFileSync(hookPath, "utf8");
    const clearStart = source.indexOf("const clearChat = () =>");
    const clearEnd = source.indexOf("const stopGenerating", clearStart);
    const clearBlock = source.slice(clearStart, clearEnd);
    expect(clearBlock).not.toContain("abort()");
    expect(clearBlock).not.toContain("activeRequestControllersRef");
  });

  test("stops only the selected session request", () => {
    const source = readFileSync(hookPath, "utf8");
    const stopStart = source.indexOf("const stopGenerating = useCallback");
    const stopEnd = source.indexOf("const loadSession", stopStart);
    const stopBlock = source.slice(stopStart, stopEnd);
    expect(stopBlock).toContain("targetSessionId?: string | null");
    expect(stopBlock).toContain(
      "activeRequestControllersRef.current.get(targetSessionId)?.abort()"
    );
    expect(stopBlock).toContain("activeRequestControllersRef.current.delete(targetSessionId)");
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

  test("does not apply a completed background response to the newly selected chat", () => {
    const source = readFileSync(chatPagePath, "utf8");
    const sendStart = source.indexOf("const handleSend = async () =>");
    const sendEnd = source.indexOf("const handleSteerPendingMessage", sendStart);
    const sendBlock = source.slice(sendStart, sendEnd);
    expect(sendBlock).toContain(
      "if (requestSessionId && activeSessionRef.current !== requestSessionId) return"
    );
    expect(sendBlock.indexOf("activeSessionRef.current !== requestSessionId")).toBeLessThan(
      sendBlock.indexOf("setSessionContextUsage")
    );
  });
});
