import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);

function createTestAgent(name: string): string {
  const provider = providerManager.create({
    provider: "minimax",
    name: `${name} Provider`,
    api_key: `test-${crypto.randomUUID()}`,
    base_url: "https://api.minimax.io/v1",
  });
  createdProviderIds.push(provider.id);
  const agent = agentManager.create({
    name,
    type: "main",
    provider_id: provider.id,
    model: "MiniMax-M3",
    memory_enabled: false,
  });
  createdAgentIds.push(agent.id);
  return agent.id;
}

afterEach(async () => {
  agentManager.execute = originalExecute;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("chat response recovery", () => {
  test("retries a bare completion without classifying the user's prompt", async () => {
    const agentId = createTestAgent("Bare Completion Recovery Agent");
    const sessionId = `bare-completion-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];
    const executionMessages: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, messages, options) => {
      callCount += 1;
      executionOptions.push(options);
      executionMessages.push(messages.map((message) => ({ ...message, images: undefined })));
      if (callCount === 1) return { content: "Completed" };
      return {
        content: "Imported the pasted data and verified that the item now contains 4 fields.",
        tool_calls: [
          {
            name: "read",
            args: { path: "/tmp/import.json" },
            result: { path: "/tmp/import.json", content: '{"fields":4}' },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message:
        "paste in then import and it shows up as an empty item, please stop going in circles",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionOptions[0]?.requireToolUse).toBe(false);
    expect(executionOptions[1]?.requireToolUse).toBe(false);
    expect(executionMessages[1]?.at(-2)).toEqual({
      role: "assistant",
      content: "Completed",
      images: undefined,
    });
    expect(executionMessages[1]?.at(-1)?.content).toContain("empty or only claimed completion");
    expect(result.message.content).toContain("verified that the item now contains 4 fields");
    expect(result.message.tool_calls).toHaveLength(1);
  });

  test("preserves an explicitly requested literal completion response", async () => {
    const agentId = createTestAgent("Literal Completion Agent");
    const sessionId = `literal-completion-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return { content: "Completed." };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Respond with exactly Completed.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(1);
    expect(result.message.content).toBe("Completed.");
  });

  test("reports an honest failure after a second empty response", async () => {
    const agentId = createTestAgent("Empty Completion Agent");
    const sessionId = `empty-completion-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return { content: "" };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Explain why this import produced an empty item.",
      agentId,
      sessionId,
      tools: false,
    });

    expect(callCount).toBe(2);
    expect(result.message.content).toContain("no usable response");
    expect(result.message.content).toContain("no tool actions were executed");
  });

  test("forces a tool-backed retry for unsupported implementation claims", async () => {
    const agentId = createTestAgent("Unsupported Claim Recovery Agent");
    const sessionId = `unsupported-claim-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, _messages, options) => {
      callCount += 1;
      executionOptions.push(options);
      if (callCount === 1) {
        return { content: "Done. I implemented the importer and all tests passed." };
      }
      return {
        content: "I fixed the importer and verified 4 focused tests pass.",
        tool_calls: [
          {
            name: "edit",
            args: { path: "/tmp/import.ts" },
            result: { filePath: "/tmp/import.ts" },
          },
          {
            name: "exec",
            args: { command: "bun test import" },
            result: { output: "4 pass", exitCode: 0 },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Fix the importer and test it.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionOptions[1]?.requireToolUse).toBe(true);
    expect(result.message.content).toContain("verified 4 focused tests pass");
    expect(result.message.tool_calls).toHaveLength(2);
  });

  test("does not accept failed tool execution as completion evidence", async () => {
    const agentId = createTestAgent("Failed Evidence Recovery Agent");
    const sessionId = `failed-evidence-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return {
        content: "All tests passed and the build is green.",
        tool_calls: [
          {
            name: "exec",
            args: { command: "bun test" },
            result: { output: "2 failed", exitCode: 1 },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Run the tests and tell me whether they pass.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(result.message.content).toContain("did not record a successful verification action");
    expect(result.message.tool_calls?.[0]?.status).toBe("failed");
  });

  test("renders the actual structured clarification instead of an invisible asked status", async () => {
    const agentId = createTestAgent("Visible Clarification Agent");
    const sessionId = `visible-clarification-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return {
        content: "Asked.",
        tool_calls: [
          {
            name: "clarify",
            args: { question: "Which data source should I use?" },
            result: {
              awaiting: "user",
              question: "Which data source should I use?",
              options: [
                { label: "API", description: "Official endpoint" },
                { label: "Files", description: "Checked-in data" },
              ],
            },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Make the data source configurable.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(1);
    expect(result.message.content).toContain("Which data source should I use?");
    expect(result.message.content).toContain("**API**");
    expect(result.message.content).not.toBe("Asked.");
  });
});
