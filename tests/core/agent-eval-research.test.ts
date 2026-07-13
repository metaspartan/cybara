import { describe, expect, test } from "bun:test";
import {
  exportResearchTraces,
  researchDatasetSplit,
  summarizeResearchTrace,
  summarizeResearchTraces,
} from "../../src/core/agent-eval/research";
import type { AgentTrajectory } from "../../src/core/agent-eval/types";

function trajectory(overrides: Partial<AgentTrajectory> = {}): AgentTrajectory {
  return {
    id: "trajectory_research_example",
    sessionId: "session-research",
    turnIndex: 2,
    agentId: "agent-research",
    provider: "openai",
    model: "research-model",
    request: {
      messages: [],
      userMessage: { role: "user", content: "Inspect /private/workspace and summarize it" },
      userMessageIndex: 0,
      contextMessageCount: 1,
      contextHash: "context-hash",
      workspaceDir: "/private/workspace",
    },
    response: {
      role: "assistant",
      content: "The project is healthy.",
      thinking: "I inspected the relevant files.",
      tool_calls: [
        {
          id: "tool-1",
          name: "read_file",
          status: "completed",
          args: { path: "/private/workspace/secret.txt" },
          result: { content: "private result" },
        },
      ],
    },
    structure: {
      tools: [
        {
          name: "read_file",
          status: "completed",
          argumentKeys: ["path"],
          resultKeys: ["content"],
          resultKinds: { content: "string" },
        },
      ],
      response: { hasContent: true, hasThinking: true, contentKind: "text" },
    },
    createdAt: "2026-07-11T12:00:00.000Z",
    ...overrides,
  };
}

describe("research trajectory datasets", () => {
  test("summarizes quality, tools, reasoning availability, and a stable split", () => {
    const value = trajectory();
    const first = summarizeResearchTrace(value);
    const second = summarizeResearchTrace(value);

    expect(first.toolCallCount).toBe(1);
    expect(first.toolNames).toEqual(["read_file"]);
    expect(first.failedToolCallCount).toBe(0);
    expect(first.hasObservableReasoning).toBe(true);
    expect(first.qualityScore).toBe(100);
    expect(first.qualityFlags).toEqual([]);
    expect(first.split).toBe(second.split);
    expect(first.split).toBe(researchDatasetSplit(value.id));
  });

  test("flags incomplete and failed trajectories without requiring reasoning", () => {
    const value = trajectory({
      response: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tool-failed",
            name: "fetch",
            status: "failed",
            args: {},
            error: "network unavailable",
          },
        ],
      },
    });
    const summary = summarizeResearchTrace(value);

    expect(summary.hasObservableReasoning).toBe(false);
    expect(summary.qualityFlags).toContain("missing_final_response");
    expect(summary.qualityFlags).toContain("failed_tools");
    expect(summary.qualityScore).toBeLessThan(60);
  });

  test("exports conversational SFT with reconstructed tool turns and provenance", () => {
    const exported = exportResearchTraces([trajectory()], {
      format: "trl_sft",
      sanitize: false,
    });
    const record = JSON.parse(exported.content) as {
      messages: Array<Record<string, unknown>>;
      metadata: Record<string, unknown>;
    };

    expect(record.messages[0]).toEqual({
      role: "user",
      content: "Inspect /private/workspace and summarize it",
    });
    expect(Array.isArray(record.messages[1]?.tool_calls)).toBe(true);
    expect(record.messages[2]?.role).toBe("tool");
    expect(record.messages.at(-1)).toEqual({
      role: "assistant",
      content: "The project is healthy.",
    });
    expect(record.metadata.observable_reasoning).toEqual({
      kind: "provider_exposed",
      content: "I inspected the relevant files.",
    });
  });

  test("exports tool observations for long-context training", () => {
    const exported = exportResearchTraces([trajectory()], {
      format: "long_context",
      sanitize: false,
    });
    const record = JSON.parse(exported.content) as {
      prompt: string;
      context: Array<Record<string, unknown>>;
      completion: string;
    };

    expect(record.prompt).toContain("Inspect");
    expect(record.context).toHaveLength(1);
    expect(record.context[0]?.tool).toBe("read_file");
    expect(record.completion).toBe("The project is healthy.");
  });

  test("redacts prompts, reasoning, workspace paths, tool arguments, and results", () => {
    const exported = exportResearchTraces([trajectory()], {
      format: "cybara_trace",
      sanitize: true,
    });

    expect(exported.content).not.toContain("/private/workspace");
    expect(exported.content).not.toContain("private result");
    expect(exported.content).not.toContain("I inspected the relevant files");
    expect(exported.content).toContain("[redacted]");
  });

  test("aggregates dataset readiness metrics", () => {
    const result = summarizeResearchTraces([
      trajectory(),
      trajectory({
        id: "trajectory_failed",
        response: {
          role: "assistant",
          content: "Fallback answer",
          tool_calls: [
            {
              id: "failed",
              name: "fetch",
              status: "failed",
              args: {},
              error: "failed",
            },
          ],
        },
      }),
    ]);

    expect(result.stats.total).toBe(2);
    expect(result.stats.toolCalls).toBe(2);
    expect(result.stats.failedToolCalls).toBe(1);
    expect(result.stats.reasoningTraces).toBe(1);
    expect(result.stats.cleanTraces).toBe(1);
    expect(result.stats.train + result.stats.validation + result.stats.test).toBe(2);
  });
});
