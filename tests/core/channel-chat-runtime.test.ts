import { afterEach, describe, expect, test } from "bun:test";
import {
  configureChannelChatRuntime,
  resetChannelChatRuntime,
  listChannelRuntimeSessions,
  sendChannelRuntimeMessage,
  searchChannelRuntimeMemory,
  getChannelRuntimeMemoryContext,
  listChannelRuntimeMemoryFiles,
  listChannelRuntimeTools,
} from "../../src/core/channels/chat-runtime";
import type {
  ChannelRuntimeMessage,
  ChannelRuntimeSessionSummary,
} from "../../src/core/channels/types";

afterEach(() => {
  resetChannelChatRuntime();
});

const sampleMessage: ChannelRuntimeMessage = {
  role: "user",
  content: "hello",
  timestamp: "2026-07-01T00:00:00.000Z",
};

describe("chat-runtime unconfigured defaults", () => {
  test("listChannelRuntimeSessions returns [] before configure", async () => {
    expect(await listChannelRuntimeSessions()).toEqual([]);
  });

  test("sendChannelRuntimeMessage returns false before configure", () => {
    expect(sendChannelRuntimeMessage("s1", sampleMessage)).toBe(false);
  });

  test("searchChannelRuntimeMemory returns unavailable shape before configure", async () => {
    const out = await searchChannelRuntimeMemory({ query: "abc" });
    expect(out).toEqual({ results: [], query: "abc", searchMethod: "unavailable" });
  });

  test("searchChannelRuntimeMemory coerces a missing query to empty string", async () => {
    const out = await searchChannelRuntimeMemory({});
    expect(out.query).toBe("");
    expect(out.searchMethod).toBe("unavailable");
  });

  test("getChannelRuntimeMemoryContext returns empty context before configure", async () => {
    expect(await getChannelRuntimeMemoryContext({})).toEqual({ context: "", lines: 0 });
  });

  test("listChannelRuntimeMemoryFiles returns empty file list before configure", async () => {
    expect(await listChannelRuntimeMemoryFiles()).toEqual({ files: [] });
  });

  test("listChannelRuntimeTools returns [] before configure", () => {
    expect(listChannelRuntimeTools()).toEqual([]);
  });
});

describe("chat-runtime configure -> dispatch", () => {
  test("sendChannelRuntimeMessage dispatches to injected handler with exact args", () => {
    const calls: Array<{ sessionId: string; message: ChannelRuntimeMessage }> = [];
    configureChannelChatRuntime({
      sendToSession: (sessionId, message) => {
        calls.push({ sessionId, message });
        return true;
      },
    });

    const result = sendChannelRuntimeMessage("session-42", sampleMessage);
    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sessionId).toBe("session-42");
    expect(calls[0]!.message).toBe(sampleMessage);
  });

  test("sendChannelRuntimeMessage propagates a false return", () => {
    configureChannelChatRuntime({ sendToSession: () => false });
    expect(sendChannelRuntimeMessage("s", sampleMessage)).toBe(false);
  });

  test("listChannelRuntimeSessions returns handler results", async () => {
    const sessions: ChannelRuntimeSessionSummary[] = [
      { id: "a", messageCount: 2, createdAt: "2026-07-01T00:00:00.000Z" },
    ];
    configureChannelChatRuntime({ listSessions: async () => sessions });
    expect(await listChannelRuntimeSessions()).toEqual(sessions);
  });

  test("listChannelRuntimeTools reflects configured tool list", () => {
    configureChannelChatRuntime({ listTools: () => ["read", "write", "grep"] });
    expect(listChannelRuntimeTools()).toEqual(["read", "write", "grep"]);
  });

  test("memory handlers are dispatched with the passed args", async () => {
    let searchArgs: Record<string, unknown> | undefined;
    let contextArgs: Record<string, unknown> | undefined;
    configureChannelChatRuntime({
      memorySearch: async (args) => {
        searchArgs = args;
        return { results: [], query: "q", searchMethod: "semantic" };
      },
      memoryContext: async (args) => {
        contextArgs = args;
        return { context: "ctx", lines: 3 };
      },
      memoryList: async () => ({
        files: [{ name: "MEMORY.md", date: "2026-07-01", size: 100 }],
      }),
    });

    const search = await searchChannelRuntimeMemory({ query: "needle", limit: 5 });
    expect(search.searchMethod).toBe("semantic");
    expect(searchArgs).toEqual({ query: "needle", limit: 5 });

    const context = await getChannelRuntimeMemoryContext({ file: "MEMORY.md" });
    expect(context).toEqual({ context: "ctx", lines: 3 });
    expect(contextArgs).toEqual({ file: "MEMORY.md" });

    const files = await listChannelRuntimeMemoryFiles();
    expect(files.files).toHaveLength(1);
    expect(files.files[0]!.name).toBe("MEMORY.md");
  });

  test("configure merges partial handler sets without clobbering others", () => {
    configureChannelChatRuntime({ listTools: () => ["one"] });
    configureChannelChatRuntime({ sendToSession: () => true });
    expect(listChannelRuntimeTools()).toEqual(["one"]);
    expect(sendChannelRuntimeMessage("s", sampleMessage)).toBe(true);
  });
});

describe("chat-runtime error resilience", () => {
  test("a throwing sendToSession is caught and yields false", () => {
    configureChannelChatRuntime({
      sendToSession: () => {
        throw new Error("boom");
      },
    });
    expect(sendChannelRuntimeMessage("s", sampleMessage)).toBe(false);
  });

  test("a rejecting listSessions is caught and yields []", async () => {
    configureChannelChatRuntime({
      listSessions: async () => {
        throw new Error("boom");
      },
    });
    expect(await listChannelRuntimeSessions()).toEqual([]);
  });

  test("a throwing listTools is caught and yields []", () => {
    configureChannelChatRuntime({
      listTools: () => {
        throw new Error("boom");
      },
    });
    expect(listChannelRuntimeTools()).toEqual([]);
  });

  test("a rejecting memorySearch is caught and reports error method", async () => {
    configureChannelChatRuntime({
      memorySearch: async () => {
        throw new Error("boom");
      },
    });
    const out = await searchChannelRuntimeMemory({ query: "x" });
    expect(out.searchMethod).toBe("error");
    expect(out.query).toBe("x");
  });

  test("a rejecting memoryContext is caught and yields empty context", async () => {
    configureChannelChatRuntime({
      memoryContext: async () => {
        throw new Error("boom");
      },
    });
    expect(await getChannelRuntimeMemoryContext({})).toEqual({ context: "", lines: 0 });
  });

  test("a rejecting memoryList is caught and yields empty files", async () => {
    configureChannelChatRuntime({
      memoryList: async () => {
        throw new Error("boom");
      },
    });
    expect(await listChannelRuntimeMemoryFiles()).toEqual({ files: [] });
  });
});

describe("chat-runtime reset lifecycle", () => {
  test("resetChannelChatRuntime restores every unconfigured default", async () => {
    configureChannelChatRuntime({
      listSessions: async () => [{ id: "a", messageCount: 1, createdAt: "x" }],
      sendToSession: () => true,
      listTools: () => ["t"],
      memorySearch: async () => ({ results: [], query: "q", searchMethod: "semantic" }),
      memoryContext: async () => ({ context: "c", lines: 1 }),
      memoryList: async () => ({ files: [{ name: "f", date: "d", size: 1 }] }),
    });

    resetChannelChatRuntime();

    expect(await listChannelRuntimeSessions()).toEqual([]);
    expect(sendChannelRuntimeMessage("s", sampleMessage)).toBe(false);
    expect(listChannelRuntimeTools()).toEqual([]);
    expect((await searchChannelRuntimeMemory({ query: "q" })).searchMethod).toBe("unavailable");
    expect(await getChannelRuntimeMemoryContext({})).toEqual({ context: "", lines: 0 });
    expect(await listChannelRuntimeMemoryFiles()).toEqual({ files: [] });
  });
});
