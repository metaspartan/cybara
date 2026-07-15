import { describe, expect, test } from "bun:test";
import {
  persistIdeChatSessionId,
  readPersistedIdeChatSessionId,
} from "../../ui/src/pages/ide/idePersistence";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("IDE chat parity", () => {
  test("persists independent chat sessions by normalized workspace", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const storage = createStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    });
    try {
      persistIdeChatSessionId("/workspace/alpha/", "session-alpha");
      persistIdeChatSessionId("/workspace/beta", "session-beta");
      expect(readPersistedIdeChatSessionId("/workspace/alpha")).toBe("session-alpha");
      expect(readPersistedIdeChatSessionId("/workspace/beta/")).toBe("session-beta");
      persistIdeChatSessionId("/workspace/alpha", null);
      expect(readPersistedIdeChatSessionId("/workspace/alpha")).toBeNull();
      expect(readPersistedIdeChatSessionId("/workspace/beta")).toBe("session-beta");
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("shares composer capabilities and rich message rendering", async () => {
    const panel = await Bun.file("ui/src/pages/ide/IDEChatPanel.tsx").text();
    const composer = await Bun.file("ui/src/pages/ide/IDEChatComposer.tsx").text();
    expect(panel).toContain("readPersistedIdeChatSessionId(workspaceDir)");
    expect(panel).toContain("<MessageContent");
    expect(panel).toContain("<ChatImageLightbox");
    expect(composer).toContain("<ChatComposer");
    expect(composer).toContain("useChatAttachments");
    expect(composer).toContain("useChatCapabilityPicker");
    expect(composer).toContain("useChatDictation");
    expect(composer).toContain("chatApi.steerPendingMessage");
    expect(composer).toContain("chatApi.reorderPendingMessages");
  });

  test("loads the chat panel on demand and provides a narrow-screen overlay", async () => {
    const ide = await Bun.file("ui/src/pages/IDE.tsx").text();
    expect(ide).toContain("const IDEChatPanel = lazy(() =>");
    expect(ide).toContain("<Suspense");
    expect(ide).toContain("absolute inset-0 z-40 h-full w-full");
    expect(ide).toContain("bg-[var(--surface-panel)]");
    expect(ide).toContain("md:w-[min(var(--ide-chat-width),48%)]");
  });
});
