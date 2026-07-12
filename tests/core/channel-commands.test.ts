import { afterEach, describe, expect, test } from "bun:test";
import {
  handleChannelManagementCommand,
  handleSharedChannelManagementCommand,
  setChannelSubagentSpawnHandler,
  clearChannelSubagentSpawnHandler,
  type ChannelCommandContext,
  type ChannelSubagentSpawnResult,
} from "../../src/core/channels/commands";
import { getSessionGoal, resetSessionGoalsForTests } from "../../src/core/session-goals";
import {
  configureChannelChatRuntime,
  resetChannelChatRuntime,
} from "../../src/core/channels/chat-runtime";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5eed42);
function randInt(max: number): number {
  return Math.floor(rand() * max);
}

function baseContext(overrides: Partial<ChannelCommandContext> = {}): ChannelCommandContext {
  return {
    channelId: "chan-1",
    chatId: "chat-1",
    platform: "telegram",
    ...overrides,
  };
}

afterEach(() => {
  clearChannelSubagentSpawnHandler();
  resetSessionGoalsForTests();
  resetChannelChatRuntime();
});

describe("channel follow-up controls", () => {
  test("queues, lists, steers, and stops through the shared runtime bridge", async () => {
    const pending = [
      {
        id: "pending-1",
        content: "focus on tests",
        mode: "queued",
        sequence: 1,
      },
    ];
    let stoppedSession = "";
    configureChannelChatRuntime({
      listPending: () => pending,
      queue: async (_sessionId, message) => ({
        queued: true,
        pendingMessages: [{ ...pending[0], content: message }],
      }),
      steer: async (_sessionId, pendingMessageId) => ({
        success: pendingMessageId === "pending-1",
        pendingMessages: [],
      }),
      stop: (sessionId) => {
        stoppedSession = sessionId;
        return { stopped: true };
      },
    });
    const context = baseContext({ sessionId: "session-1" });

    expect(await handleChannelManagementCommand("/queue focus on tests", context)).toContain(
      "Queued follow-up"
    );
    expect(await handleChannelManagementCommand("/pending", context)).toContain("focus on tests");
    expect(await handleChannelManagementCommand("/steer 1", context)).toContain(
      "Steered follow-up"
    );
    expect(await handleChannelManagementCommand("/stop", context)).toBe(
      "Stopped the active response."
    );
    expect(stoppedSession).toBe("session-1");
  });

  test("returns concise usage and inactive-session errors", async () => {
    expect(await handleChannelManagementCommand("/queue", baseContext())).toContain(
      "active session"
    );
    expect(
      await handleChannelManagementCommand("/steer missing", baseContext({ sessionId: "s" }))
    ).toContain("Usage: /steer");
    expect(await handleChannelManagementCommand("/stop", baseContext())).toContain(
      "active session"
    );
  });
});

describe("command parsing", () => {
  test("non-command input returns null", async () => {
    expect(await handleChannelManagementCommand("hello there", baseContext())).toBeNull();
    expect(await handleChannelManagementCommand("", baseContext())).toBeNull();
    expect(await handleChannelManagementCommand("   ", baseContext())).toBeNull();
  });

  test("a lone slash or bang with no token returns null", async () => {
    expect(await handleChannelManagementCommand("/", baseContext())).toBeNull();
    expect(await handleChannelManagementCommand("!   ", baseContext())).toBeNull();
  });

  test("unknown command returns null", async () => {
    expect(await handleChannelManagementCommand("/frobnicate xyz", baseContext())).toBeNull();
  });

  test("both / and ! prefixes are recognized", async () => {
    const slash = await handleChannelManagementCommand("/help", baseContext());
    const bang = await handleChannelManagementCommand("!help", baseContext());
    expect(slash).toBe(bang);
    expect(typeof slash).toBe("string");
  });

  test("bot @mention suffix is stripped from the command token", async () => {
    const out = await handleChannelManagementCommand("/help@cybara_bot", baseContext());
    expect(out).toContain("Cybara Commands");
  });

  test("command matching is case-insensitive", async () => {
    const out = await handleChannelManagementCommand("/HELP", baseContext());
    expect(out).toContain("Cybara Commands");
  });
});

describe("help command", () => {
  test("/help and /start both return the help text", async () => {
    const help = await handleChannelManagementCommand("/help", baseContext());
    const start = await handleChannelManagementCommand("/start", baseContext());
    expect(help).toBe(start);
    expect(help).toContain("Cybara Commands");
    expect(help).toContain("/new");
    expect(help).toContain("/switch");
    expect(help).toContain("/subagents spawn");
  });
});

describe("context-dependent session commands", () => {
  test("/new without a session factory reports unsupported", async () => {
    const out = await handleChannelManagementCommand("/new", baseContext());
    expect(out).toBe("Starting a fresh session is not supported in this channel context.");
  });

  test("/new with a factory rotates and reports the new session id prefix", async () => {
    let stored: string | undefined;
    const ctx = baseContext({
      createSessionId: () => "abcdef0123456789",
      setSessionId: (id) => {
        stored = id;
      },
    });
    const out = await handleChannelManagementCommand("/new", ctx);
    expect(stored).toBe("abcdef0123456789");
    expect(out).toBe("Started a new session: abcdef01...");
  });

  test("/session with no active session reports none", async () => {
    const out = await handleChannelManagementCommand("/session", baseContext());
    expect(out).toBe("No active session in this channel context.");
  });

  test("/session show reflects the active session id", async () => {
    const out = await handleChannelManagementCommand(
      "/session show",
      baseContext({ sessionId: "sess-xyz" })
    );
    expect(out).toBe("Current session: sess-xyz");
  });

  test("/switch with no args prompts for a target", async () => {
    const out = await handleChannelManagementCommand("/switch", baseContext());
    expect(out).toBe("Provide a session target. Use /switch <number|session_id_prefix>.");
  });

  test("/switch with a target but no setSessionId reports unsupported", async () => {
    const out = await handleChannelManagementCommand("/switch 1", baseContext());
    expect(out).toBe("Switching sessions is not supported in this channel context.");
  });

  test("/switch new rotates a session when a factory exists", async () => {
    const ctx = baseContext({
      createSessionId: () => "zzzzzzzz11112222",
      setSessionId: () => {},
    });
    const out = await handleChannelManagementCommand("/switch new", ctx);
    expect(out).toBe("Started a new session: zzzzzzzz...");
  });

  test("/goal is session-scoped and works from channel commands", async () => {
    const out = await handleChannelManagementCommand(
      "/goal start review mobile parity",
      baseContext({ sessionId: "channel-goal-session" })
    );
    expect(out).toBe("Goal started: review mobile parity");
    expect(getSessionGoal("channel-goal-session")?.objective).toBe("review mobile parity");

    const status = await handleChannelManagementCommand(
      "/goal status",
      baseContext({ sessionId: "channel-goal-session" })
    );
    expect(status).toContain("Goal: review mobile parity");
  });

  test("/loop creates a session when the channel supports session rotation", async () => {
    let stored: string | undefined;
    const out = await handleChannelManagementCommand(
      "/loop ship Android screenshots",
      baseContext({
        createSessionId: () => "loop-session-created",
        setSessionId: (id) => {
          stored = id;
        },
      })
    );
    expect(stored).toBe("loop-session-created");
    expect(out).toBe("Goal started: ship Android screenshots");
    expect(getSessionGoal("loop-session-created")?.status).toBe("active");
  });

  test("/goal without an active or creatable session returns a channel-safe message", async () => {
    const out = await handleChannelManagementCommand("/goal status", baseContext());
    expect(out).toBe("Goal mode needs an active session in this channel context. Use /new first.");
  });
});

describe("workspace command context guards", () => {
  test("/workspace without an active session reports it cannot be set", async () => {
    const out = await handleChannelManagementCommand("/workspace ~/somewhere", baseContext());
    expect(out).toBe("Workspace cannot be set: no active session in this context.");
  });

  test("/cwd and /dir alias the workspace command", async () => {
    const a = await handleChannelManagementCommand("/cwd", baseContext());
    const b = await handleChannelManagementCommand("/dir", baseContext());
    expect(a).toBe("Workspace cannot be set: no active session in this context.");
    expect(b).toBe(a);
  });
});

describe("permissions command (config-backed, read + restore)", () => {
  test("/permissions show returns the current mode without mutating it", async () => {
    const out = await handleChannelManagementCommand("/permissions", baseContext());
    expect(out).toContain("Tool permission mode:");
    expect(out).toContain("Use /permissions ask or /permissions allow.");
  });

  test("/permissions with an unknown mode returns usage and does not change state", async () => {
    const before = await handleChannelManagementCommand("/permissions show", baseContext());
    const bad = await handleChannelManagementCommand("/permissions banana", baseContext());
    expect(bad).toBe("Unknown permissions mode. Use /permissions ask or /permissions allow.");
    const after = await handleChannelManagementCommand("/permissions show", baseContext());
    expect(after).toBe(before);
  });

  test("approval and approvals are aliases for permissions", async () => {
    const a = await handleChannelManagementCommand("/approval", baseContext());
    const b = await handleChannelManagementCommand("/approvals", baseContext());
    expect(a).toContain("Tool permission mode:");
    expect(b).toContain("Tool permission mode:");
  });

  test("remote channels cannot change the global permission mode", async () => {
    const before = await handleChannelManagementCommand("/permissions show", baseContext());
    const out = await handleChannelManagementCommand("/permissions allow", baseContext());
    expect(out).toBe("Permission mode changes are only available from the local app.");
    const after = await handleChannelManagementCommand("/permissions show", baseContext());
    expect(after).toBe(before);
  });

  test("round-trip: setting ask then restoring the original mode", async () => {
    const localContext = baseContext({ allowSecuritySettings: true });
    const original = await handleChannelManagementCommand("/permissions show", localContext);
    const wasAsk = original!.includes("ask (dangerous");

    const setAsk = await handleChannelManagementCommand("/permissions ask", localContext);
    expect(setAsk).toContain("set to ask");
    const askShow = await handleChannelManagementCommand("/permissions show", localContext);
    expect(askShow).toContain("ask (dangerous");

    if (!wasAsk) {
      const setAllow = await handleChannelManagementCommand("/permissions allow", localContext);
      expect(setAllow).toContain("set to allow");
    }
    const restored = await handleChannelManagementCommand("/permissions show", localContext);
    expect(restored).toBe(original);
  });
});

describe("shared channel command fallback", () => {
  test("handles management commands for adapters without native command routing", async () => {
    const result = await handleSharedChannelManagementCommand("/status", {
      channelId: "matrix-command-fallback",
      chatId: "room-1",
      platform: "matrix",
      sessionId: "matrix:room-1",
    });
    expect(typeof result).toBe("string");
    expect(result?.length).toBeGreaterThan(0);
  });

  test("does not let a remote fallback change global permissions", async () => {
    const result = await handleSharedChannelManagementCommand("/permissions allow", {
      channelId: "zulip-command-fallback",
      chatId: "stream-1",
      platform: "zulip",
      sessionId: "zulip:stream-1",
    });
    expect(result).toContain("only available from the local app");
  });
});

describe("subagent command lifecycle", () => {
  test("/subagents help lists the spawn subcommand", async () => {
    const out = await handleChannelManagementCommand("/subagents", baseContext());
    expect(out).toContain("Subagent commands:");
    expect(out).toContain("/subagents spawn");
  });

  test("/subagent (singular) aliases /subagents", async () => {
    const out = await handleChannelManagementCommand("/subagent help", baseContext());
    expect(out).toContain("Subagent commands:");
  });

  test("unknown subagent action returns a clean error string", async () => {
    const out = await handleChannelManagementCommand("/subagents destroy world", baseContext());
    expect(out).toBe('Unsupported subagent action "destroy". Use /subagents spawn <task>.');
  });

  test("spawn without a task returns usage", async () => {
    const out = await handleChannelManagementCommand("/subagents spawn", baseContext());
    expect(out).toBe("Task is required. Usage: /subagents spawn <task>");
  });

  test("spawn without a configured handler reports not-configured", async () => {
    const out = await handleChannelManagementCommand(
      "/subagents spawn do the thing",
      baseContext()
    );
    expect(out).toBe("Subagent spawn is not configured for this runtime.");
  });

  test("spawn dispatches to the configured handler with task + label + requester key", async () => {
    const received: Array<Record<string, unknown>> = [];
    setChannelSubagentSpawnHandler(async (args) => {
      received.push(args);
      const result: ChannelSubagentSpawnResult = {
        status: "accepted",
        childSessionKey: "child-1",
        runId: "run-9",
        task: String(args.task),
      };
      return result;
    });

    const out = await handleChannelManagementCommand(
      "/subagents spawn summarize the logs",
      baseContext({ sessionId: "sess-abc" })
    );

    expect(received).toHaveLength(1);
    expect(received[0]!.task).toBe("summarize the logs");
    expect(received[0]!.label).toBe("channel:telegram");
    expect(received[0]!._requesterSessionKey).toBe("sess-abc");
    expect(out).toContain("Subagent spawned successfully.");
    expect(out).toContain("Run ID: run-9");
    expect(out).toContain("Session: child-1");
    expect(out).toContain("Task: summarize the logs");
  });

  test("requester key falls back to platform:channel:chat when no session id", async () => {
    let seen: Record<string, unknown> | undefined;
    setChannelSubagentSpawnHandler(async (args) => {
      seen = args;
      return {
        status: "accepted",
        childSessionKey: "c",
        runId: "r",
        task: String(args.task),
      };
    });

    await handleChannelManagementCommand(
      "/subagents spawn x",
      baseContext({ platform: "discord", channelId: "g1", chatId: 42 })
    );
    expect(seen!._requesterSessionKey).toBe("discord:g1:42");
  });

  test("a non-accepted spawn status surfaces the warning", async () => {
    setChannelSubagentSpawnHandler(async () => ({
      status: "rejected",
      childSessionKey: "",
      runId: "",
      task: "t",
      warning: "over capacity",
    }));
    const out = await handleChannelManagementCommand("/subagents spawn t", baseContext());
    expect(out).toBe("over capacity");
  });

  test("a non-accepted status without a warning reports the status", async () => {
    setChannelSubagentSpawnHandler(async () => ({
      status: "queued",
      childSessionKey: "",
      runId: "",
      task: "t",
    }));
    const out = await handleChannelManagementCommand("/subagents spawn t", baseContext());
    expect(out).toBe("Subagent spawn failed with status: queued");
  });

  test("clearChannelSubagentSpawnHandler reverts to not-configured", async () => {
    setChannelSubagentSpawnHandler(async () => ({
      status: "accepted",
      childSessionKey: "c",
      runId: "r",
      task: "t",
    }));
    clearChannelSubagentSpawnHandler();
    const out = await handleChannelManagementCommand("/subagents spawn t", baseContext());
    expect(out).toBe("Subagent spawn is not configured for this runtime.");
  });
});

describe("read-only DB-backed commands never throw and return strings", () => {
  const readOnly = ["/status", "/agents", "/providers", "/models", "/sessions"];
  for (const cmd of readOnly) {
    test(`${cmd} returns a string`, async () => {
      const out = await handleChannelManagementCommand(cmd, baseContext());
      expect(typeof out).toBe("string");
      expect((out as string).length).toBeGreaterThan(0);
    });
  }

  test("/agent show and /provider show and /model show return strings", async () => {
    for (const cmd of ["/agent", "/provider", "/model", "/agent show"]) {
      const out = await handleChannelManagementCommand(cmd, baseContext());
      expect(typeof out).toBe("string");
    }
  });
});

describe("fuzz: malformed command input never throws", () => {
  const VERBS = [
    "help",
    "new",
    "sessions",
    "switch",
    "session",
    "status",
    "agents",
    "providers",
    "models",
    "subagents",
    "bogus",
  ];
  const NOISE = ["", "   ", "@bot", "1", "-5", "🔥", "'; DROP TABLE agents;--", "a".repeat(300)];

  test("200 seeded malformed inputs resolve to string|null without throwing", async () => {
    for (let i = 0; i < 200; i++) {
      const prefix = rand() < 0.5 ? "/" : "!";
      const verb = VERBS[randInt(VERBS.length)];
      const noise = NOISE[randInt(NOISE.length)];
      const input = `${prefix}${verb} ${noise}`.trim();
      const out = await handleChannelManagementCommand(input, baseContext());
      expect(out === null || typeof out === "string").toBe(true);
    }
  });
});
