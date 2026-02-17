import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  agentsApi,
  chatApi,
  channelsApi,
  logsApi,
  memoryApi,
  providersApi,
  skillsApi,
  sessionsApi,
  subagentApi,
  tasksApi,
} from "../../ui/src/lib/api";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: Window }).window;

type StorageMap = Map<string, string>;

function createWindow(search: string, initialStorage: Record<string, string> = {}) {
  const store: StorageMap = new Map(Object.entries(initialStorage));
  return {
    location: { search },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  };
}

describe("UI API client wiring", () => {
  let calls: FetchCall[] = [];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = originalWindow;
    }
  });

  test("injects Authorization header from UI token", async () => {
    (globalThis as unknown as { window: Window }).window = createWindow(
      "?token=ui-token"
    ) as unknown as Window;

    await agentsApi.list();

    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer ui-token");
  });

  test("agentsApi.chat uses POST /api/agents/:id/chat", async () => {
    const res = await agentsApi.chat("agent-1", "hello", "session-1");

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/agents/agent-1/chat");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      message: "hello",
      sessionId: "session-1",
    });
  });

  test("channelsApi.setupTelegram uses botToken payload", async () => {
    await channelsApi.setupTelegram("123:abc", "https://example.com/webhook");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/channels/telegram/setup");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      botToken: "123:abc",
      webhookUrl: "https://example.com/webhook",
    });
  });

  test("memoryApi.list encodes query params", async () => {
    await memoryApi.list({
      agentId: "agent 1",
      userId: "user@example.com",
      search: "error + logs",
      limit: 25,
    });

    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0].url, "http://localhost");
    expect(parsed.pathname).toBe("/api/memory");
    expect(parsed.searchParams.get("agentId")).toBe("agent 1");
    expect(parsed.searchParams.get("userId")).toBe("user@example.com");
    expect(parsed.searchParams.get("search")).toBe("error + logs");
    expect(parsed.searchParams.get("limit")).toBe("25");
  });

  test("memoryApi.search uses GET query params", async () => {
    await memoryApi.search("needles + haystack", 10);

    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0].url, "http://localhost");
    expect(parsed.pathname).toBe("/api/memory/search");
    expect(parsed.searchParams.get("query")).toBe("needles + haystack");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(calls[0].init?.method).toBeUndefined();
  });

  test("logsApi.search encodes query", async () => {
    await logsApi.search("agent failed? channel=discord");

    expect(calls).toHaveLength(1);
    const parsed = new URL(calls[0].url, "http://localhost");
    expect(parsed.pathname).toBe("/api/logs/search");
    expect(parsed.searchParams.get("q")).toBe("agent failed? channel=discord");
  });

  test("chatApi uses expected chat/session endpoints", async () => {
    await chatApi.send("hi", "agent-1", "session-1");
    await chatApi.getSessions();
    await chatApi.getSession("session-1");
    await chatApi.deleteSession("session-1");

    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe("/api/chat");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      message: "hi",
      agentId: "agent-1",
      sessionId: "session-1",
    });

    expect(calls[1].url).toBe("/api/sessions");
    expect(calls[1].init?.method).toBeUndefined();

    expect(calls[2].url).toBe("/api/sessions/session-1");
    expect(calls[2].init?.method).toBeUndefined();

    expect(calls[3].url).toBe("/api/sessions/session-1");
    expect(calls[3].init?.method).toBe("DELETE");
  });

  test("logsApi activity/stats attach query params", async () => {
    await logsApi.getActivity(30);
    await logsApi.getStats(12);

    expect(calls).toHaveLength(2);

    const activity = new URL(calls[0].url, "http://localhost");
    expect(activity.pathname).toBe("/api/logs/activity");
    expect(activity.searchParams.get("minutes")).toBe("30");

    const stats = new URL(calls[1].url, "http://localhost");
    expect(stats.pathname).toBe("/api/logs/stats");
    expect(stats.searchParams.get("hours")).toBe("12");
  });

  test("skillsApi.test uses execute endpoint", async () => {
    await skillsApi.test("skill-1", { input: "hello" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/skills/skill-1/execute");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ input: "hello" });
  });

  test("providers/tasks/sessions/subagents hit expected endpoints", async () => {
    await providersApi.test("prov-1");
    await tasksApi.run("task-1");
    await sessionsApi.delete("session-1");
    await subagentApi.kill("sub-1");

    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe("/api/providers/prov-1/test");
    expect(calls[0].init?.method).toBe("POST");

    expect(calls[1].url).toBe("/api/tasks/task-1/run");
    expect(calls[1].init?.method).toBe("POST");

    expect(calls[2].url).toBe("/api/sessions/session-1");
    expect(calls[2].init?.method).toBe("DELETE");

    expect(calls[3].url).toBe("/api/subagents/sub-1/kill");
    expect(calls[3].init?.method).toBe("POST");
  });

  test("returns success=false with text error body on non-OK response", async () => {
    globalThis.fetch = (async () => {
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;

    const res = await providersApi.test("prov-1");

    expect(res.success).toBe(false);
    expect(res.error).toBe("bad request");
  });
});
