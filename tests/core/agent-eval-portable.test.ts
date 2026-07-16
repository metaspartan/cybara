import { describe, expect, test } from "bun:test";
import {
  createEvalSuiteBundle,
  deleteGolden,
  evalSuiteJsonl,
  importGoldens,
  parseEvalSuiteBundle,
  summarizeGolden,
} from "../../src/core/agent-eval";
import type { AgentEvalRun, AgentGolden } from "../../src/core/agent-eval/types";

function golden(): AgentGolden {
  return {
    id: "golden-1",
    trajectoryId: "trajectory-1",
    name: "Read package version",
    description: "Confirms the agent reads the requested file",
    tags: ["repository"],
    assertions: {
      response: { type: "normalized_text", expected: "Version 1.0.0" },
      tools: [{ index: 0, name: "read", args: { path: "package.json" } }],
    },
    baseline: {
      id: "trajectory-1",
      sessionId: "session-1",
      turnIndex: 0,
      agentId: "agent-1",
      provider: "provider-1",
      model: "model-1",
      request: {
        messages: [
          { role: "system", content: "Private system prompt" },
          { role: "user", content: "Read package.json" },
        ],
        userMessage: { role: "user", content: "Read package.json" },
        userMessageIndex: 1,
        contextMessageCount: 2,
        contextHash: "context-hash",
        workspaceDir: "/private/workspace",
      },
      response: {
        role: "assistant",
        content: "Version 1.0.0",
        thinking: "Private reasoning",
        tool_calls: [
          {
            id: "read-1",
            name: "read",
            status: "completed",
            args: { path: "package.json" },
            result: { content: "private file content" },
          },
        ],
      },
      structure: {
        tools: [
          {
            name: "read",
            status: "completed",
            argumentKeys: ["path"],
            resultKeys: ["content"],
            resultKinds: { content: "string" },
          },
        ],
        response: { hasContent: true, hasThinking: true, contentKind: "text" },
      },
      createdAt: "2026-07-11T00:00:00.000Z",
    },
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

describe("agent eval portability", () => {
  test("exports and validates a replayable versioned suite", () => {
    const bundle = createEvalSuiteBundle([golden()]);
    expect(bundle.format).toBe("cybara-agent-eval-suite");
    expect(bundle.version).toBe(1);
    expect(parseEvalSuiteBundle(bundle)[0]?.baseline.request.userMessage.content).toBe(
      "Read package.json"
    );
  });

  test("redacts prompts, paths, tool arguments, and tool results", () => {
    const bundle = createEvalSuiteBundle([golden()], { sanitize: true });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("Private system prompt");
    expect(serialized).not.toContain("/private/workspace");
    expect(serialized).not.toContain("package.json");
    expect(serialized).not.toContain("private file content");
    expect(() => parseEvalSuiteBundle(bundle)).toThrow("not replayable");
  });

  test("emits one analysis-ready JSONL trajectory per golden", () => {
    const run: AgentEvalRun = {
      id: "run-1",
      goldenId: "golden-1",
      replaySessionId: "replay-1",
      status: "failed",
      score: 82,
      comparison: {
        equivalent: false,
        score: 82,
        differences: [
          { path: "tools[0].name", expected: "read", actual: "exec", severity: "error" },
        ],
      },
      error: null,
      createdAt: "2026-07-11T00:01:00.000Z",
      completedAt: "2026-07-11T00:02:00.000Z",
    };
    const lines = evalSuiteJsonl([golden()], { runs: [run] }).split("\n");
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]) as {
      conversations: Array<{ from: string; value: string }>;
      metadata: {
        structure: { tools: Array<{ name: string }> };
        latestEval: { status: string; score: number; differences: Array<{ path: string }> };
      };
    };
    expect(row.conversations.map((message) => message.from)).toEqual(["system", "human", "gpt"]);
    expect(row.metadata.structure.tools[0]?.name).toBe("read");
    expect(row.metadata.latestEval).toMatchObject({ status: "failed", score: 82 });
    expect(row.metadata.latestEval.differences[0]?.path).toBe("tools[0].name");
  });

  test("imports replayable suites with fresh local identities", () => {
    const source = golden();
    const imported = importGoldens(parseEvalSuiteBundle(createEvalSuiteBundle([source])));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.id).not.toBe(source.id);
    expect(imported[0]?.baseline.sessionId).toStartWith("eval-import-");
    expect(imported[0]?.baseline.request.userMessage.content).toBe("Read package.json");
    expect(deleteGolden(imported[0]?.id || "")).toBe(true);
  });

  test("summarizes list payloads without full context or tool results", () => {
    const source = golden();
    const summary = summarizeGolden(source);
    expect(summary.baseline.request.userMessage.content).toBe("Read package.json");
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(source).length);
    expect("messages" in summary.baseline.request).toBe(false);
    expect("response" in summary.baseline).toBe(false);
  });

  test("rejects unsupported, oversized, and malformed suites", () => {
    expect(() => parseEvalSuiteBundle({ format: "unknown", version: 1, goldens: [] })).toThrow(
      "Unsupported"
    );
    expect(() =>
      parseEvalSuiteBundle({
        format: "cybara-agent-eval-suite",
        version: 1,
        goldens: Array.from({ length: 501 }, () => ({})),
      })
    ).toThrow("500 golden tests");
    expect(() =>
      parseEvalSuiteBundle({
        format: "cybara-agent-eval-suite",
        version: 1,
        goldens: [{ name: "Broken", baseline: null }],
      })
    ).toThrow("baseline");
  });
});
