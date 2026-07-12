import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildTrajectoryForMessage,
  buildTrajectoryStructure,
  compareTrajectoryStructures,
  createEvalRun,
  deleteGolden,
  forkSession,
  getGolden,
  listEvalRuns,
  listGoldens,
  listSessionTrajectories,
  recordCompletedTrajectory,
  saveGolden,
  ensureSessionTrajectory,
} from "../../src/core/agent-eval";
import {
  loadPersistedSession,
  persistSession,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";
import type { ChatMessage } from "../../src/api/chat";

function sampleMessages(): ChatMessage[] {
  return [
    {
      role: "user",
      content: "Read package.json and report the version.",
      timestamp: "2026-07-11T20:00:00.000Z",
    },
    {
      role: "assistant",
      content: "The version is 1.2.3.",
      timestamp: "2026-07-11T20:00:01.000Z",
      tool_calls: [
        {
          id: "read-1",
          name: "read",
          args: { path: "package.json" },
          status: "completed",
          result: { content: '{"version":"1.2.3"}', lines: 1 },
        },
      ],
    },
  ];
}

describe("agent eval trajectories", () => {
  test("compares tool order and extracted result structure without exact response text", () => {
    const baseline = buildTrajectoryStructure(sampleMessages()[1]);
    const equivalent = buildTrajectoryStructure({
      ...sampleMessages()[1],
      content: "Current package version: 1.2.3",
      tool_calls: [
        {
          ...sampleMessages()[1].tool_calls?.[0],
          id: "read-2",
          name: "read",
          args: { path: "package.json" },
          status: "completed",
          result: { content: "different text", lines: 4 },
        },
      ],
    });
    const changed = buildTrajectoryStructure({
      role: "assistant",
      content: "Done",
      tool_calls: [
        {
          id: "exec-1",
          name: "exec",
          args: { command: "cat package.json" },
          status: "completed",
          result: { output: "1.2.3" },
        },
      ],
    });

    expect(compareTrajectoryStructures(baseline, equivalent).equivalent).toBe(true);
    expect(compareTrajectoryStructures(baseline, changed).equivalent).toBe(false);
  });

  test("records completed turns and saves immutable golden baselines", () => {
    const sessionId = `eval-session-${crypto.randomUUID()}`;
    const trajectory = recordCompletedTrajectory({
      sessionId,
      agentId: "agent-eval",
      messages: sampleMessages(),
      workspaceDir: "/tmp/eval-workspace",
      provider: "test-provider",
      model: "test-model",
    });
    expect(trajectory?.turnIndex).toBe(0);
    expect(listSessionTrajectories(sessionId)).toHaveLength(1);

    const golden = saveGolden({
      trajectory: trajectory as NonNullable<typeof trajectory>,
      name: "Package version",
      tags: ["repo", "read"],
    });
    expect(getGolden(golden.id)?.baseline.structure.tools.map((tool) => tool.name)).toEqual([
      "read",
    ]);
    expect(listGoldens().some((entry) => entry.id === golden.id)).toBe(true);
    expect(listEvalRuns().some((run) => run.goldenId === golden.id)).toBe(false);
    createEvalRun(golden.id);
    expect(listEvalRuns().some((run) => run.goldenId === golden.id)).toBe(true);
    expect(deleteGolden(golden.id)).toBe(true);
    expect(listEvalRuns().some((run) => run.goldenId === golden.id)).toBe(false);
  });

  test("captures provider and model from the persisted assistant response", () => {
    const messages = sampleMessages();
    messages[1] = {
      ...messages[1],
      provider: "response-provider",
      model: "response-model",
    };
    const trajectory = recordCompletedTrajectory({
      sessionId: `eval-response-metadata-${crypto.randomUUID()}`,
      agentId: "agent-eval",
      messages,
    });

    expect(trajectory?.provider).toBe("response-provider");
    expect(trajectory?.model).toBe("response-model");
  });

  test("keeps captured provider and model when expanding a compact trajectory", async () => {
    const sessionId = `eval-metadata-${crypto.randomUUID()}`;
    const messages = sampleMessages();
    expect(await persistSession(sessionId, "agent-eval", messages, null, "Metadata chat")).toBe(
      true
    );
    for (const [index, message] of messages.entries()) {
      await upsertPersistedSessionMessage(sessionId, "agent-eval", message, {
        stableKey: `metadata:${index}`,
        createdAtOffsetMs: index,
      });
    }
    recordCompletedTrajectory({
      sessionId,
      agentId: "agent-eval",
      messages,
      provider: "minimax",
      model: "MiniMax-M3",
    });

    const expanded = await ensureSessionTrajectory(sessionId);
    expect(expanded.provider).toBe("minimax");
    expect(expanded.model).toBe("MiniMax-M3");
    expect(expanded.request.messages).toHaveLength(1);
  });

  test("forks a persisted session through an exact message boundary", async () => {
    const sourceSessionId = `fork-source-${crypto.randomUUID()}`;
    const messages = sampleMessages();
    messages[1] = {
      ...messages[1],
      provider: "fork-provider",
      model: "fork-model",
    };
    const workspace = mkdtempSync(join(tmpdir(), "cybara-eval-fork-"));
    try {
      expect(
        await persistSession(sourceSessionId, "agent-source", messages, workspace, "Source chat")
      ).toBe(true);
      for (const [index, message] of messages.entries()) {
        await upsertPersistedSessionMessage(sourceSessionId, "agent-source", message, {
          stableKey: `source:${index}`,
          createdAtOffsetMs: index,
        });
      }

      const fork = await forkSession({
        sourceSessionId,
        throughMessageIndex: 0,
        agentId: "agent-fork",
      });
      const loaded = await loadPersistedSession(fork.sessionId);
      expect(loaded?.agentId).toBe("agent-fork");
      expect(loaded?.workspaceDir).toBe(workspace);
      expect(loaded?.messages.map((message) => message.content)).toEqual([messages[0].content]);

      const completeFork = await forkSession({ sourceSessionId });
      const completeLoaded = await loadPersistedSession(completeFork.sessionId);
      expect(completeLoaded?.messages[1]?.provider).toBe("fork-provider");
      expect(completeLoaded?.messages[1]?.model).toBe("fork-model");
      const trajectory = await ensureSessionTrajectory(completeFork.sessionId);
      expect(trajectory.provider).toBe("fork-provider");
      expect(trajectory.model).toBe("fork-model");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("builds a selected-turn trajectory from the nearest user request", () => {
    const trajectory = buildTrajectoryForMessage({
      sessionId: "selected-turn",
      agentId: "agent",
      messages: [
        ...sampleMessages(),
        { role: "user", content: "Now summarize it." },
        { role: "assistant", content: "Summary complete." },
      ],
      messageIndex: 3,
    });
    expect(trajectory.turnIndex).toBe(1);
    expect(trajectory.request.userMessage.content).toBe("Now summarize it.");
    expect(trajectory.response.content).toBe("Summary complete.");
  });
});
