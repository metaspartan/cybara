import { describe, expect, test } from "bun:test";
import { resolveTurnContextWindow } from "../../src/api/chat-turn-context";
import { tables } from "../../src/core/database";
import {
  compactOpenAIChatTranscriptInPlace,
  MESSAGE_CONTENT_COMPACTION_NOTICE,
} from "../../src/core/llm/tool-transcript";
import {
  compactContext,
  estimateMessagesRequestVisibleTokens,
  estimateMessagesTranscriptTokens,
  estimateSessionContextUsage,
  shouldCompactContext,
  type ChatMessage,
} from "../../src/core/session-context";

const BIG_TOOL_SESSION: ChatMessage[] = Array.from({ length: 600 }, (_, index) => ({
  role: index % 2 === 0 ? "assistant" : "user",
  content: index % 2 === 0 ? "" : `request ${index}`,
  tool_calls:
    index % 2 === 0
      ? [
          {
            id: `t-${index}`,
            name: "exec",
            args: { command: "echo hi" },
            status: "completed",
            result: "y".repeat(200_000),
          },
        ]
      : undefined,
}));

describe("agent switch context window", () => {
  test("resolves the new agent's smaller window after a switch", () => {
    const switchedAgent = {
      config: { max_context_tokens: 131072 },
      provider_id: "5bc50c26-aec3-41d8-a9b2-0b7d66d10a07",
      model: "deepseek-v4-flash-0731",
    };
    const resolved = resolveTurnContextWindow(switchedAgent, switchedAgent.model);
    expect(resolved.contextWindow).toBe(131072);
    expect(resolved.contextWindowTokens).toBe(131072);
  });

  test("resolves provider-scoped window for a new agent on the same model", () => {
    const providerId = `switch-provider-${crypto.randomUUID()}`;
    const model = "switched-model-1";
    try {
      tables.providers.create({
        id: providerId,
        provider: "inference",
        name: "Switch Test Provider",
        base_url: "https://test.invalid/v1",
        is_default: false,
      });
      tables.providerModels.upsert({
        id: `pm-${crypto.randomUUID()}`,
        provider_id: providerId,
        model_id: model,
        model_name: model,
        context_window: 786432,
        max_tokens: 65536,
        reasoning: false,
        input_types: ["text"],
        cost_input: 0,
        cost_output: 0,
        cost_cache_read: 0,
        cost_cache_write: 0,
      });
      const switchedAgent = { config: {}, provider_id: providerId, model };
      const resolved = resolveTurnContextWindow(switchedAgent, model);
      expect(resolved.contextWindow).toBe(786432);
    } finally {
      tables.providerModels.deleteByProvider(providerId);
      tables.providers.delete(providerId);
    }
  });

  test("compaction triggers immediately when switching to a smaller window", () => {
    const check = shouldCompactContext(BIG_TOOL_SESSION, "deepseek-v4-flash", undefined, 131072);
    expect(check.needed).toBe(true);
  });

  test("compacted transcript fits the new smaller window budget", async () => {
    const compaction = await compactContext(BIG_TOOL_SESSION, "deepseek-v4-flash", undefined, {
      contextWindowTokens: 131072,
      force: true,
    });
    expect(compaction.wasCompacted).toBe(true);
    const compactedTokens = estimateMessagesRequestVisibleTokens(compaction.messages);
    const budget = Math.floor(131072 / 1.2);
    expect(compactedTokens).toBeLessThanOrEqual(budget);
  });

  test("request-visible estimate reflects replayed tool results after a switch", () => {
    const before = estimateMessagesRequestVisibleTokens(BIG_TOOL_SESSION);
    const after = estimateMessagesRequestVisibleTokens(BIG_TOOL_SESSION.slice(0, 4));
    expect(before).toBeGreaterThan(after);
    expect(before).toBeGreaterThan(1000);
  });
});

describe("system prompt truncation under a small window", () => {
  const HUGE_SYSTEM_PROMPT = "x".repeat(200_000);

  test("truncates an oversized system prompt to fit the budget", () => {
    const messages = [
      { role: "system", content: HUGE_SYSTEM_PROMPT },
      { role: "user", content: "continue" },
    ];
    const budgetChars = 50_000;
    const elided = compactOpenAIChatTranscriptInPlace(messages, budgetChars, { aggressive: true });
    expect(elided).toBeGreaterThan(0);
    const totalChars = messages.reduce((sum, m) => sum + String(m.content).length, 0);
    expect(totalChars).toBeLessThanOrEqual(budgetChars);
    expect(messages[0].content).not.toBe(HUGE_SYSTEM_PROMPT);
  });

  test("keeps both the head and the tail of a truncated system prompt", () => {
    const prompt = `HEAD-START ${"m".repeat(100_000)} TAIL-END`;
    const messages = [
      { role: "system", content: prompt },
      { role: "user", content: "go" },
    ];
    compactOpenAIChatTranscriptInPlace(messages, 30_000, { aggressive: true });
    const content = String(messages[0].content);
    expect(content).toContain("HEAD-START");
    expect(content).toContain("TAIL-END");
  });

  test("does not touch the system prompt when the transcript fits", () => {
    const messages = [
      { role: "system", content: "short prompt" },
      { role: "user", content: "hello" },
    ];
    const elided = compactOpenAIChatTranscriptInPlace(messages, 100_000);
    expect(elided).toBe(0);
    expect(messages[0].content).toBe("short prompt");
  });

  test("existing message elision still works without a system prompt", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "user", content: "a".repeat(20_000) },
      { role: "user", content: "b".repeat(20_000) },
      { role: "user", content: "c".repeat(20_000) },
      { role: "user", content: "recent" },
    ];
    const elided = compactOpenAIChatTranscriptInPlace(messages, 30_000);
    expect(elided).toBeGreaterThan(0);
    expect(
      messages.some((m) => String(m.content).includes(MESSAGE_CONTENT_COMPACTION_NOTICE))
    ).toBe(true);
  });
});

describe("process activity estimation safety", () => {
  test("does not throw on circular process_activities", () => {
    const circular: Record<string, unknown> = { phase: "result", text: "read a file" };
    circular.self = circular;
    const messages = [
      {
        role: "assistant",
        content: "Done.",
        process_activities: [circular],
      },
    ] as ChatMessage[];
    expect(() => estimateMessagesTranscriptTokens(messages)).not.toThrow();
  });

  test("estimates process_activities tokens normally", () => {
    const messages = [
      {
        role: "assistant",
        content: "Done.",
        process_activities: [{ phase: "result", text: "read a file", timestamp: Date.now() }],
      },
    ] as ChatMessage[];
    const estimate = estimateMessagesTranscriptTokens(messages);
    expect(estimate).toBeGreaterThan(0);
  });
});

describe("context usage estimate reflects what is sent", () => {
  test("usedTokens counts replayed tool results at the request-visible cap", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "t1",
            name: "exec",
            args: { command: "cat big.txt" },
            status: "completed",
            result: "z".repeat(40_000),
          },
        ],
      },
    ];
    const usage = estimateSessionContextUsage(messages, "deepseek-v4-flash", {
      contextWindowTokens: 786432,
    });
    expect(usage.usedTokens).toBeGreaterThan(100);
    expect(usage.usedTokens).toBeLessThan(5000);
    expect(usage.transcriptTokens).toBeGreaterThan(usage.usedTokens);
    expect(usage.usedPercent).toBeLessThan(1);
  });
});
