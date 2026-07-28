import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseJsonRpc,
  initializeResult,
  agentMessageChunk,
  extractPromptText,
  jsonRpcError,
  ACP_PROTOCOL_VERSION,
} from "../../src/core/acp/protocol";
import { createAcpDispatcher } from "../../src/core/acp/server";
import type { JsonRpcRequest, JsonRpcResponse } from "../../src/core/acp/protocol";

describe("ACP protocol helpers", () => {
  test("parseJsonRpc accepts valid requests, rejects junk", () => {
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":1,"method":"initialize"}')?.method).toBe(
      "initialize"
    );
    expect(parseJsonRpc("not json")).toBeNull();
    expect(parseJsonRpc('{"id":1}')).toBeNull();
    expect(parseJsonRpc("   ")).toBeNull();
  });

  test("initializeResult advertises the protocol version and capabilities", () => {
    const r = initializeResult("1.2.3");
    expect(r.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(r.agentCapabilities.promptCapabilities.image).toBe(false);
    expect(r.agentCapabilities.promptCapabilities.embeddedContext).toBe(true);
    expect(r.agentCapabilities.sessionCapabilities.close).toEqual({});
    expect(r.agentInfo).toEqual({ name: "cybara", title: "Cybara", version: "1.2.3" });
  });

  test("agentMessageChunk is a session/update notification (no id)", () => {
    const n = agentMessageChunk("sess1", "hello");
    expect(n.method).toBe("session/update");
    expect((n.params as { update: { content: { text: string } } }).update.content.text).toBe(
      "hello"
    );
    expect((n as { id?: unknown }).id).toBeUndefined();
  });

  test("extractPromptText joins text, embedded resources, and resource links", () => {
    expect(
      extractPromptText({
        prompt: [
          { type: "text", text: "a" },
          { type: "image" },
          {
            type: "resource",
            resource: {
              uri: "file:///workspace/main.ts",
              text: "export const value = 1;",
            },
          },
          {
            type: "resource_link",
            uri: "file:///workspace/notes.md",
            name: "notes.md",
            description: "Project notes",
          },
          { type: "text", text: "b" },
        ],
      })
    ).toBe(
      "a\nEmbedded resource: file:///workspace/main.ts\nexport const value = 1;\nReferenced resource: notes.md (file:///workspace/notes.md)\nProject notes\nb"
    );
    expect(extractPromptText({})).toBe("");
  });

  test("jsonRpcError shapes a JSON-RPC error", () => {
    const e = jsonRpcError(5, -32601, "nope");
    expect(e.error?.code).toBe(-32601);
    expect(e.id).toBe(5);
  });
});

describe("ACP dispatcher", () => {
  function harness(agentId: string | null = "agent-1") {
    const out: (JsonRpcRequest | JsonRpcResponse)[] = [];
    const prompts: Array<{
      agentId: string;
      sessionId: string;
      text: string;
      cwd: string;
      messages: Array<{ role: string; content: string }>;
    }> = [];
    let sessionCount = 0;
    const dispatch = createAcpDispatcher({
      write: (m) => out.push(m),
      resolveAgentId: () => agentId ?? undefined,
      sendMessage: async (request) => {
        prompts.push({
          agentId: request.agentId,
          sessionId: request.sessionId,
          text: request.text,
          cwd: request.cwd,
          messages: request.messages,
        });
        return `echo:${request.text}`;
      },
      newSessionId: () => (sessionCount++ === 0 ? "fixed-session" : `session-${sessionCount}`),
    });
    return { out, prompts, dispatch };
  }

  test("initialize → session/new → session/prompt end-to-end", async () => {
    const { out, prompts, dispatch } = harness();
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await dispatch('{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/x"}}');
    await dispatch(
      '{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"fixed-session","prompt":[{"type":"text","text":"hi"}]}}'
    );

    const init = out[0] as JsonRpcResponse;
    expect((init.result as { protocolVersion: number }).protocolVersion).toBe(ACP_PROTOCOL_VERSION);

    const newSess = out[1] as JsonRpcResponse;
    expect((newSess.result as { sessionId: string }).sessionId).toBe("fixed-session");

    expect(prompts).toEqual([
      {
        agentId: "agent-1",
        sessionId: "fixed-session",
        text: "hi",
        cwd: "/x",
        messages: [{ role: "user", content: "hi" }],
      },
    ]);
    const chunk = out[2] as JsonRpcRequest;
    expect(chunk.method).toBe("session/update");
    const done = out[3] as JsonRpcResponse;
    expect((done.result as { stopReason: string }).stopReason).toBe("end_turn");
  });

  test("session/prompt on unknown session errors", async () => {
    const { out, dispatch } = harness();
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    out.length = 0;
    await dispatch(
      '{"jsonrpc":"2.0","id":9,"method":"session/prompt","params":{"sessionId":"nope","prompt":[{"type":"text","text":"x"}]}}'
    );
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32602);
  });

  test("session/new with no agent configured errors", async () => {
    const { out, dispatch } = harness(null);
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    out.length = 0;
    await dispatch('{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/x"}}');
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32603);
  });

  test("session/new requires initialization and an absolute workspace", async () => {
    const { out, dispatch } = harness();
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/x"}}');
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32002);
    out.length = 0;
    await dispatch('{"jsonrpc":"2.0","id":2,"method":"initialize"}');
    out.length = 0;
    await dispatch('{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"relative"}}');
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32602);
  });

  test("sessions retain independent conversation histories", async () => {
    const { prompts, dispatch } = harness();
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await dispatch('{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/one"}}');
    await dispatch('{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"/two"}}');
    await dispatch(
      '{"jsonrpc":"2.0","id":4,"method":"session/prompt","params":{"sessionId":"fixed-session","prompt":[{"type":"text","text":"first"}]}}'
    );
    await dispatch(
      '{"jsonrpc":"2.0","id":5,"method":"session/prompt","params":{"sessionId":"session-2","prompt":[{"type":"text","text":"second"}]}}'
    );
    await dispatch(
      '{"jsonrpc":"2.0","id":6,"method":"session/prompt","params":{"sessionId":"fixed-session","prompt":[{"type":"text","text":"follow up"}]}}'
    );

    expect(prompts[1]?.messages).toEqual([{ role: "user", content: "second" }]);
    expect(prompts[2]?.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "echo:first" },
      { role: "user", content: "follow up" },
    ]);
  });

  test("session/cancel aborts an active prompt", async () => {
    const out: (JsonRpcRequest | JsonRpcResponse)[] = [];
    let signal: AbortSignal | undefined;
    const dispatch = createAcpDispatcher({
      write: (message) => out.push(message),
      resolveAgentId: () => "agent-1",
      newSessionId: () => "session-1",
      sendMessage: (request) => {
        signal = request.signal;
        return new Promise<string>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      },
    });
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await dispatch('{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/x"}}');
    const pending = dispatch(
      '{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"session-1","prompt":[{"type":"text","text":"wait"}]}}'
    );
    await Promise.resolve();
    await dispatch(
      '{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"session-1"}}'
    );
    await pending;

    expect(signal?.aborted).toBe(true);
    const done = out.find((message) => "id" in message && message.id === 3) as JsonRpcResponse;
    expect(done.result).toEqual({ stopReason: "cancelled" });
  });

  test("session/close cancels work and releases the session", async () => {
    const out: (JsonRpcRequest | JsonRpcResponse)[] = [];
    const dispatch = createAcpDispatcher({
      write: (message) => out.push(message),
      resolveAgentId: () => "agent-1",
      newSessionId: () => "session-1",
      sendMessage: (request) =>
        new Promise<string>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        }),
    });
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    await dispatch('{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/x"}}');
    const pending = dispatch(
      '{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"session-1","prompt":[{"type":"text","text":"wait"}]}}'
    );
    await Promise.resolve();
    await dispatch(
      '{"jsonrpc":"2.0","id":4,"method":"session/close","params":{"sessionId":"session-1"}}'
    );
    await pending;
    await dispatch(
      '{"jsonrpc":"2.0","id":5,"method":"session/prompt","params":{"sessionId":"session-1","prompt":[{"type":"text","text":"again"}]}}'
    );

    const close = out.find((message) => "id" in message && message.id === 4) as JsonRpcResponse;
    const rejected = out.find((message) => "id" in message && message.id === 5) as JsonRpcResponse;
    expect(close.result).toEqual({});
    expect(rejected.error?.code).toBe(-32602);
  });

  test("authenticate with no methodId succeeds (no auth required over stdio)", async () => {
    const { out, dispatch } = harness();
    await dispatch('{"jsonrpc":"2.0","id":5,"method":"authenticate"}');
    const res = out[0] as JsonRpcResponse;
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({});
  });

  test("authenticate with an unsupported methodId is rejected", async () => {
    const { out, dispatch } = harness();
    await dispatch(
      '{"jsonrpc":"2.0","id":6,"method":"authenticate","params":{"methodId":"oauth"}}'
    );
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32602);
  });

  test("unknown method returns method-not-found; notifications are ignored", async () => {
    const { out, dispatch } = harness();
    await dispatch('{"jsonrpc":"2.0","id":7,"method":"bogus"}');
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32601);
    out.length = 0;
    await dispatch('{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"x"}}');
    expect(out).toHaveLength(0);
  });
});

describe("ACP stdio server", () => {
  test("keeps stdout limited to JSON-RPC frames", async () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-acp-"));
    try {
      const input =
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}\n';
      const child = Bun.spawn({
        cmd: [process.execPath, "run", "src/main.ts", "acp"],
        cwd: process.cwd(),
        env: { ...process.env, CYBARA_HOME: home },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stdin.write(input);
      child.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0 || !stdout.trim()) {
        throw new Error(
          `ACP stdio process failed with exit ${exitCode}: ${stderr.trim() || "no diagnostics"}`
        );
      }
      const lines = stdout.trim().split("\n");

      expect(exitCode).toBe(0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: ACP_PROTOCOL_VERSION },
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);
});
