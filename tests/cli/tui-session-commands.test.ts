import { describe, expect, test } from "bun:test";
import {
  backupNotice,
  costNotice,
  countTuiTurns,
  doctorNotice,
  forkRequestBody,
  healthNotice,
  keybindNotice,
  parseTurnIndex,
  readForkSessionId,
  resolveRewindTarget,
  revertRequestBody,
  runTuiSessionCommand,
  themeNotice,
  type TuiRewindMessage,
} from "../../src/cli/tui/tui-session-commands";
import { TUI_CHAT_COMMANDS } from "../../src/cli/tui/commands";

const TURNS: TuiRewindMessage[] = [
  { role: "user", content: "first", timestamp: "2026-01-01T00:00:00.000Z" },
  { role: "assistant", content: "second", timestamp: "2026-01-01T00:00:01.000Z" },
  { role: "user", content: "third", timestamp: "2026-01-01T00:00:02.000Z" },
];

function fakeFetch(response: unknown): {
  fetchAPI: <T>(path: string, init?: RequestInit) => Promise<T>;
  calls: Array<{ body?: string; init?: RequestInit; path: string }>;
} {
  const calls: Array<{ body?: string; init?: RequestInit; path: string }> = [];
  return {
    calls,
    fetchAPI: (async (path: string, init?: RequestInit) => {
      calls.push({ path, init, body: init?.body as string | undefined });
      return response as never;
    }) as never,
  };
}

describe("tui turn index parsing", () => {
  test("accepts 1-based turn numbers only", () => {
    expect(parseTurnIndex("1")).toBe(1);
    expect(parseTurnIndex(" 12 ")).toBe(12);
    expect(parseTurnIndex("0")).toBeNull();
    expect(parseTurnIndex("abc")).toBeNull();
    expect(parseTurnIndex("-3")).toBeNull();
    expect(parseTurnIndex("")).toBeNull();
  });

  test("counts turns by user message, not by raw message count", () => {
    expect(countTuiTurns(TURNS)).toBe(2);
    expect(countTuiTurns([])).toBe(0);
    expect(countTuiTurns([{ role: "assistant", content: "orphan" }])).toBe(0);
  });

  test("anchors each turn on the user message that starts it", () => {
    expect(resolveRewindTarget(TURNS, 1)?.index).toBe(2);
    expect(resolveRewindTarget(TURNS, 2)?.index).toBe(0);
    expect(resolveRewindTarget(TURNS, 3)).toBeNull();
    expect(resolveRewindTarget([], 1)).toBeNull();
  });

  test("never targets an assistant message, which the gateway rejects", () => {
    for (const turn of [1, 2]) {
      const target = resolveRewindTarget(TURNS, turn);
      expect(target?.message.role).toBe("user");
    }
  });

  test("tolerates a trailing assistant message with no following user turn", () => {
    const target = resolveRewindTarget(
      [
        { role: "user", content: "only request" },
        { role: "assistant", content: "only answer" },
        { role: "assistant", content: "follow up" },
      ],
      1
    );
    expect(target?.index).toBe(0);
    expect(target?.message.content).toBe("only request");
  });

  test("sends role, index, and identifying fields for an exact revert match", () => {
    const target = resolveRewindTarget(TURNS, 2);
    expect(target).not.toBeNull();
    expect(revertRequestBody(target!)).toEqual({
      messageIndex: 0,
      messageRole: "user",
      messageContent: "first",
      messageTimestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  test("omits empty optional fields so the gateway falls back to its own matching", () => {
    expect(revertRequestBody({ index: 4, message: { role: "user", content: "" } })).toEqual({
      messageIndex: 4,
      messageRole: "user",
    });
  });

  test("forks through a turn and omits the index when forking the whole session", () => {
    expect(forkRequestBody({ index: 2 })).toEqual({ throughMessageIndex: 2 });
    expect(forkRequestBody(null)).toEqual({});
    expect(forkRequestBody(null, "  my fork  ")).toEqual({ title: "my fork" });
    expect(forkRequestBody(null, "   ")).toEqual({});
  });
});

describe("tui diagnostic notices", () => {
  test("health reports status, uptime, and subsystem checks", () => {
    const notice = healthNotice({
      status: "ok",
      version: "1.0.0",
      uptime: 7325,
      checks: { database: { status: "ok" }, channels: { status: "degraded", running: 2 } },
    });
    expect(notice).toContain("Gateway status: ok");
    expect(notice).toContain("Uptime: 2.0h");
    expect(notice).toContain("Version: 1.0.0");
    expect(notice).toContain("database: ok");
    expect(notice).toContain("channels: degraded (2 running)");
  });

  test("health and doctor degrade safely on unreadable payloads", () => {
    expect(healthNotice(null)).toContain("unreadable");
    expect(doctorNotice("nope")).toContain("unreadable");
    expect(healthNotice({})).toContain("Gateway status: unknown");
  });

  test("doctor surfaces driver readiness and the permission hint", () => {
    const notice = doctorNotice({
      ready: false,
      version: "0.7.1",
      driverSource: "bundled",
      message: "Accessibility grants are missing.",
      checks: { binary: { status: "ok", message: "cua-driver 0.7.1" } },
    });
    expect(notice).toContain("Computer use: not ready");
    expect(notice).toContain("driver: 0.7.1 (bundled)");
    expect(notice).toContain("Accessibility grants are missing.");
    expect(notice).toContain("binary: ok");
  });

  test("cost reports cached and cache-write tokens and never invents money", () => {
    const notice = costNotice(
      {
        inputTokens: 19_253,
        outputTokens: 77,
        totalTokens: 19_330,
        cachedInputTokens: 8192,
        cacheWriteTokens: 512,
        callCount: 1,
        firstTokenMs: 2461,
      },
      "abc"
    );
    expect(notice).toContain("Tokens for abc");
    expect(notice).toContain("Input: 19k (8k cached)");
    expect(notice).toContain("Output: 77");
    expect(notice).toContain("1 call");
    expect(notice).toContain("Cache write: 512");
    expect(notice).toContain("First token: 2.5s");
    expect(notice).toContain("provider dashboard");
    expect(notice).not.toMatch(/\$\d/);
  });

  test("cost degrades to a clear message with no recorded usage", () => {
    expect(costNotice(null, "abc")).toContain("No token usage recorded");
    expect(costNotice({}, "abc")).toContain("Tokens for abc");
  });

  test("theme reports the current scheme and validates the argument", () => {
    expect(themeNotice("dark", null)).toContain("/theme [dark|light]");
    expect(themeNotice("dark", "light")).toContain("set to light");
  });

  test("keybinds lists bindings plus the full command catalog", () => {
    const notice = keybindNotice(TUI_CHAT_COMMANDS);
    expect(notice).toContain("Key bindings");
    expect(notice).toContain(`Commands (${TUI_CHAT_COMMANDS.length})`);
    expect(notice).toContain("/help");
    expect(notice).toContain("/keybinds");
  });

  test("checkpoints list entries and report an empty store honestly", () => {
    const notice = backupNotice({
      backups: [{ id: "cp-1", createdAt: "2026-01-01T00:00:00.000Z" }, { label: "before deploy" }],
    });
    expect(notice).toContain("Checkpoints (2)");
    expect(notice).toContain("cp-1 — 2026-01-01T00:00:00.000Z");
    expect(notice).toContain("before deploy");
    expect(backupNotice({ backups: [] })).toBe("No checkpoints found.");
    expect(backupNotice(null)).toBe("No checkpoints found.");
  });
});

describe("runTuiSessionCommand dispatch", () => {
  const base = {
    fetchAPI: fakeFetch({}).fetchAPI,
    localSessionId: "session-1",
    messages: TURNS,
    commands: TUI_CHAT_COMMANDS,
    theme: "dark",
  };

  test("ignores commands it does not own", async () => {
    const result = await runTuiSessionCommand({ ...base, argument: "", command: "status" });
    expect(result.handled).toBe(false);
  });

  test("/keybinds and /health answer without a session", async () => {
    const noSession = { ...base, localSessionId: "" };
    const keys = await runTuiSessionCommand({ ...noSession, argument: "", command: "keybinds" });
    expect(keys.handled).toBe(true);
    const health = await runTuiSessionCommand({
      ...noSession,
      argument: "",
      command: "health",
      fetchAPI: fakeFetch({ status: "ok", uptime: 30 }).fetchAPI,
    });
    expect(health.notice).toContain("Uptime: 30s");
  });

  test("/theme rejects a value it cannot apply", async () => {
    const result = await runTuiSessionCommand({
      ...base,
      argument: "solarized",
      command: "theme",
    });
    expect(result.handled).toBe(true);
    expect(result.notice).toContain("Usage: /theme [dark|light]");
  });

  test("/cost refuses to guess usage without a session", async () => {
    const result = await runTuiSessionCommand({
      ...base,
      argument: "",
      command: "cost",
      localSessionId: "",
    });
    expect(result.notice).toBe("No active session.");
  });

  test("/cost reads token usage off the session detail", async () => {
    const { fetchAPI, calls } = fakeFetch({ tokenUsage: { inputTokens: 10, outputTokens: 2 } });
    const result = await runTuiSessionCommand({ ...base, argument: "", command: "cost", fetchAPI });
    expect(calls[0]?.path).toBe("/api/chat/sessions/session-1");
    expect(result.notice).toContain("Input: 10");
  });

  test("/undo defaults to the newest turn and posts a revert", async () => {
    const { fetchAPI, calls } = fakeFetch({ success: true });
    const result = await runTuiSessionCommand({ ...base, argument: "", command: "undo", fetchAPI });
    expect(calls[0]?.path).toBe("/api/sessions/session-1/revert");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body || "{}")).toEqual({
      messageIndex: 2,
      messageRole: "user",
      messageContent: "third",
      messageTimestamp: "2026-01-01T00:00:02.000Z",
    });
    expect(result.notice).toContain("Rewound to before turn 1");
  });

  test("/rewind is an alias for /undo", async () => {
    const { fetchAPI, calls } = fakeFetch({ success: true });
    const result = await runTuiSessionCommand({
      ...base,
      argument: "2",
      command: "rewind",
      fetchAPI,
    });
    expect(calls[0]?.path).toBe("/api/sessions/session-1/revert");
    expect(JSON.parse(calls[0]?.body || "{}").messageIndex).toBe(0);
    expect(JSON.parse(calls[0]?.body || "{}").messageRole).toBe("user");
    expect(result.notice).toContain("Rewound to before turn 2");
  });

  test("/undo surfaces a gateway rejection instead of claiming success", async () => {
    const { fetchAPI } = fakeFetch({ success: false, error: "Can only revert to a user message" });
    const result = await runTuiSessionCommand({ ...base, argument: "", command: "undo", fetchAPI });
    expect(result.notice).toBe("Can only revert to a user message");
  });

  test("/fork returns the new session id so the TUI can switch to it", async () => {
    const { fetchAPI, calls } = fakeFetch({
      success: true,
      fork: { sessionId: "forked-1", sourceSessionId: "session-1", messageCount: 3 },
    });
    const result = await runTuiSessionCommand({
      ...base,
      argument: "2",
      command: "fork",
      fetchAPI,
    });
    expect(calls[0]?.path).toBe("/api/sessions/session-1/fork");
    expect(JSON.parse(calls[0]?.body || "{}")).toEqual({ throughMessageIndex: 0 });
    expect(result.sessionId).toBe("forked-1");
    expect(result.notice).toContain("Forked 2 turns");
  });

  test("/fork reads the gateway's nested fork envelope and tolerates a flat one", () => {
    expect(readForkSessionId({ success: true, fork: { sessionId: "a" } })).toBe("a");
    expect(readForkSessionId({ fork: { session_id: "b" } })).toBe("b");
    expect(readForkSessionId({ sessionId: "c" })).toBe("c");
    expect(readForkSessionId({ fork: { id: "d" } })).toBe("d");
    expect(readForkSessionId({ success: true })).toBe("");
    expect(readForkSessionId(null)).toBe("");
  });

  test("/fork reports failure when the gateway returns no fork", async () => {
    const { fetchAPI } = fakeFetch({ success: true });
    const result = await runTuiSessionCommand({ ...base, argument: "", command: "fork", fetchAPI });
    expect(result.notice).toBe("Fork failed.");
    expect(result.sessionId).toBeUndefined();
  });

  test("/undo and /fork reject a malformed or out-of-range turn", async () => {
    const bad = await runTuiSessionCommand({ ...base, argument: "last", command: "undo" });
    expect(bad.notice).toBe("Usage: /undo <turn number>");

    const outOfRange = await runTuiSessionCommand({ ...base, argument: "9", command: "fork" });
    expect(outOfRange.notice).toContain("Turn 9 does not exist");
    expect(outOfRange.notice).toContain("This session has 2");
  });

  test("/undo and /fork refuse to act without a session or turns", async () => {
    const noSession = await runTuiSessionCommand({
      ...base,
      argument: "",
      command: "undo",
      localSessionId: "",
    });
    expect(noSession.notice).toBe("No active session.");

    const noTurns = await runTuiSessionCommand({
      ...base,
      argument: "",
      command: "fork",
      messages: [],
    });
    expect(noTurns.notice).toBe("No turns to act on yet.");
  });
});

describe("tui command catalog", () => {
  const names = TUI_CHAT_COMMANDS.map((command) => command.name);

  test("exposes the new session and diagnostic commands", () => {
    for (const name of [
      "/undo",
      "/rewind",
      "/fork",
      "/checkpoint",
      "/theme",
      "/doctor",
      "/health",
      "/cost",
      "/keybinds",
    ]) {
      expect(names).toContain(name);
    }
  });

  test("every command has a detail and no duplicate names", () => {
    for (const command of TUI_CHAT_COMMANDS) {
      expect(command.detail.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
