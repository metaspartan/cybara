import { describe, expect, test } from "bun:test";
import type { Dispatch, SetStateAction } from "react";
import type { TUIFetchAPI } from "../../src/cli/tui/components/chat";
import { executePendingChatCommand } from "../../src/cli/tui/components/interactive-chat-pending-commands";
import type { PendingMessage } from "../../src/cli/tui/components/interactive-chat-view";

function setter<T>(initial: T): { get: () => T; set: Dispatch<SetStateAction<T>> } {
  let state = initial;
  return {
    get: () => state,
    set: (next) => {
      state = typeof next === "function" ? (next as (value: T) => T)(state) : next;
    },
  };
}

function commandInput(overrides: {
  command: string;
  argument?: string;
  fetchAPI?: TUIFetchAPI;
  localSessionId?: string;
  rest?: string[];
}): {
  input: Parameters<typeof executePendingChatCommand>[0];
  notice: () => string | null;
  pending: () => PendingMessage[];
} {
  const notice = setter<string | null>(null);
  const pending = setter<PendingMessage[]>([]);
  const sending = setter(true);
  const fetchAPI: TUIFetchAPI =
    overrides.fetchAPI ?? (async <T>() => ({ pendingMessages: [] }) as T);
  return {
    input: {
      argument: overrides.argument ?? "",
      command: overrides.command,
      fetchAPI,
      loadMessages: async () => {},
      loadPending: async () => {},
      localSessionId: overrides.localSessionId ?? "session-1",
      modelOverride: "",
      pendingMessages: [],
      rest: overrides.rest ?? [],
      selectedAgentId: "agent-1",
      setNotice: notice.set,
      setPendingMessages: pending.set,
      setSending: sending.set,
      useModelRouter: false,
      workspaceDir: "/tmp/project",
    },
    notice: notice.get,
    pending: pending.get,
  };
}

describe("TUI pending chat commands", () => {
  test("rejects queueing before a session exists without calling the gateway", async () => {
    let calls = 0;
    const setup = commandInput({
      command: "queue",
      argument: "continue",
      localSessionId: "",
      fetchAPI: async <T>() => {
        calls += 1;
        return null as T | null;
      },
    });
    expect(await executePendingChatCommand(setup.input)).toBe(true);
    expect(calls).toBe(0);
    expect(setup.notice()).toContain("first turn");
  });

  test("queues a follow-up and replaces the local pending snapshot", async () => {
    const calls: Array<{ endpoint: string; body: string }> = [];
    const setup = commandInput({
      command: "queue",
      argument: "run the tests",
      fetchAPI: async <T>(endpoint, options) => {
        calls.push({ endpoint, body: String(options?.body ?? "") });
        return {
          pendingMessages: [{ id: "pending-1", content: "run the tests", sequence: 1 }],
        } as T;
      },
    });
    expect(await executePendingChatCommand(setup.input)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.endpoint).toBe("/api/chat");
    expect(JSON.parse(calls[0]?.body || "{}")).toMatchObject({
      message: "run the tests",
      queueMode: "queue",
      sessionId: "session-1",
    });
    expect(setup.pending()).toEqual([{ id: "pending-1", content: "run the tests", sequence: 1 }]);
    expect(setup.notice()).toBe("Queued follow-up.");
  });
});
