import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

// A single malformed tool call (missing required args) must NOT terminate the
// whole agentic run. The error is fed back so the model self-corrects on the
// next turn — matching openclaw/opencode/hermes. Regression for runs that bailed
// with "produced tool calls without the required arguments".
describe("malformed tool-call recovery (Anthropic loop)", () => {
  test("feeds the missing-args error back and lets the model finish", async () => {
    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        // Turn 1: model emits a `read` tool_use with NO path (missing required arg).
        return new Response(
          JSON.stringify({
            id: "msg-1",
            type: "message",
            role: "assistant",
            content: [
              { type: "text", text: "Let me read the file." },
              { type: "tool_use", id: "toolu_1", name: "read", input: {} },
            ],
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // Turn 2: after seeing the error, the model finishes with a normal answer.
      return new Response(
        JSON.stringify({
          id: "msg-2",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "RECOVERED-OK" }],
          usage: { input_tokens: 8, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "synthetic",
      name: "Malformed Recovery Provider",
      api_key: "synthetic-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Malformed Recovery Agent",
      type: "main",
      provider_id: provider.id,
      model: "hf:MiniMaxAI/MiniMax-M2.1",
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "read a file" }],
      { useTools: true, sessionId: "malformed-recovery-session" }
    );

    // The run continued to a real answer instead of bailing early.
    expect(result.content).toBe("RECOVERED-OK");
    expect(result.content).not.toContain("without the required arguments");
    // Two turns happened: the malformed call was fed back, not fatal.
    expect(call).toBe(2);
  });
});
