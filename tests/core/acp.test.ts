import { describe, expect, test } from "bun:test";
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
    expect(parseJsonRpc('{"jsonrpc":"2.0","id":1,"method":"initialize"}')?.method).toBe("initialize");
    expect(parseJsonRpc("not json")).toBeNull();
    expect(parseJsonRpc('{"id":1}')).toBeNull();
    expect(parseJsonRpc("   ")).toBeNull();
  });

  test("initializeResult advertises the protocol version and capabilities", () => {
    const r = initializeResult();
    expect(r.protocolVersion).toBe(ACP_PROTOCOL_VERSION);
    expect(r.agentCapabilities.promptCapabilities.image).toBe(true);
  });

  test("agentMessageChunk is a session/update notification (no id)", () => {
    const n = agentMessageChunk("sess1", "hello");
    expect(n.method).toBe("session/update");
    expect((n.params as { update: { content: { text: string } } }).update.content.text).toBe("hello");
    expect((n as { id?: unknown }).id).toBeUndefined();
  });

  test("extractPromptText joins text blocks and ignores non-text", () => {
    expect(
      extractPromptText({ prompt: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] })
    ).toBe("a\nb");
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
    const prompts: Array<{ agentId: string; text: string }> = [];
    const dispatch = createAcpDispatcher({
      write: (m) => out.push(m),
      resolveAgentId: () => agentId ?? undefined,
      sendMessage: async (id, text) => {
        prompts.push({ agentId: id, text });
        return `echo:${text}`;
      },
      newSessionId: () => "fixed-session",
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

    expect(prompts).toEqual([{ agentId: "agent-1", text: "hi" }]);
    const chunk = out[2] as JsonRpcRequest;
    expect(chunk.method).toBe("session/update");
    const done = out[3] as JsonRpcResponse;
    expect((done.result as { stopReason: string }).stopReason).toBe("end_turn");
  });

  test("session/prompt on unknown session errors", async () => {
    const { out, dispatch } = harness();
    await dispatch(
      '{"jsonrpc":"2.0","id":9,"method":"session/prompt","params":{"sessionId":"nope","prompt":[{"type":"text","text":"x"}]}}'
    );
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32602);
  });

  test("session/new with no agent configured errors", async () => {
    const { out, dispatch } = harness(null);
    await dispatch('{"jsonrpc":"2.0","id":1,"method":"session/new"}');
    expect((out[0] as JsonRpcResponse).error?.code).toBe(-32603);
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
