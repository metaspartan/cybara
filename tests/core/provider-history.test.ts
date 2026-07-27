import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../../src/core/agent";
import {
  toAnthropicHistory,
  toBedrockHistory,
  toGoogleHistory,
  toOpenAIChatHistory,
} from "../../src/core/llm/provider-history";

const switchedProviderHistory: AgentMessage[] = [
  { role: "system", content: "Use tools when needed." },
  { role: "user", content: "Inspect the project." },
  {
    role: "assistant",
    content: "I will inspect the manifest.",
    tool_calls: [
      {
        id: "call_package",
        name: "read_file",
        arguments: { path: "package.json" },
      },
    ],
  },
  {
    role: "tool",
    content: '{"name":"cybara","version":"1.2.3"}',
    tool_call_id: "call_package",
  },
  { role: "assistant", content: "The package is Cybara 1.2.3." },
  { role: "user", content: "Continue." },
];

describe("provider history conversion", () => {
  test("preserves canonical tool history when switching to Anthropic", () => {
    expect(toAnthropicHistory(switchedProviderHistory)).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Inspect the project." }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect the manifest." },
          {
            type: "tool_use",
            id: "call_package",
            name: "read_file",
            input: { path: "package.json" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_package",
            content: '{"name":"cybara","version":"1.2.3"}',
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The package is Cybara 1.2.3." }],
      },
      { role: "user", content: [{ type: "text", text: "Continue." }] },
    ]);
  });

  test("preserves canonical tool history when switching to Google", () => {
    expect(toGoogleHistory(switchedProviderHistory)).toEqual([
      { role: "user", parts: [{ text: "Inspect the project." }] },
      {
        role: "model",
        parts: [
          { text: "I will inspect the manifest." },
          {
            functionCall: {
              name: "read_file",
              args: { path: "package.json" },
            },
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "read_file",
              response: { name: "cybara", version: "1.2.3" },
            },
          },
        ],
      },
      { role: "model", parts: [{ text: "The package is Cybara 1.2.3." }] },
      { role: "user", parts: [{ text: "Continue." }] },
    ]);
  });

  test("drops empty assistant records and retains orphan tool output as user context", () => {
    const history: AgentMessage[] = [
      { role: "assistant", content: "" },
      { role: "tool", content: "orphaned result", tool_call_id: "missing" },
    ];

    expect(toAnthropicHistory(history)).toEqual([
      { role: "user", content: [{ type: "text", text: "orphaned result" }] },
    ]);
    expect(toGoogleHistory(history)).toEqual([
      { role: "user", parts: [{ text: "orphaned result" }] },
    ]);
  });

  test("preserves canonical tool history when switching to Bedrock", () => {
    expect(toBedrockHistory(switchedProviderHistory)).toEqual([
      { role: "user", content: [{ text: "Inspect the project." }] },
      {
        role: "assistant",
        content: [
          { text: "I will inspect the manifest." },
          {
            toolUse: {
              toolUseId: "call_package",
              name: "read_file",
              input: { path: "package.json" },
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "call_package",
              content: [{ json: { name: "cybara", version: "1.2.3" } }],
            },
          },
        ],
      },
      { role: "assistant", content: [{ text: "The package is Cybara 1.2.3." }] },
      { role: "user", content: [{ text: "Continue." }] },
    ]);
  });

  test("preserves canonical tool history when switching to OpenAI chat completions", () => {
    const historyWithLateSystem = [
      switchedProviderHistory[1],
      switchedProviderHistory[0],
      ...switchedProviderHistory.slice(2),
    ];
    expect(toOpenAIChatHistory(historyWithLateSystem)).toEqual([
      { role: "system", content: "Use tools when needed." },
      { role: "user", content: "Inspect the project." },
      {
        role: "assistant",
        content: "I will inspect the manifest.",
        tool_calls: [
          {
            id: "call_package",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"package.json"}',
            },
          },
        ],
      },
      {
        role: "tool",
        content: '{"name":"cybara","version":"1.2.3"}',
        tool_call_id: "call_package",
      },
      { role: "assistant", content: "The package is Cybara 1.2.3." },
      { role: "user", content: "Continue." },
    ]);
  });

  test("adds interleaved reasoning content when switching into Moonshot K3", () => {
    const history = toOpenAIChatHistory(switchedProviderHistory, "moonshot", "kimi-k3");
    const assistantToolMessage = history.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls)
    );
    expect(assistantToolMessage?.reasoning_content).toBe("");
  });
});
