import { afterEach, describe, expect, test } from "bun:test";
import { recoverInterruptedSessionMessages } from "../../src/api/chat-run-recovery";
import type { ChatMessage } from "../../src/api/chat-types";
import { tables } from "../../src/core/database";
import {
  deletePersistedSession,
  loadPersistedSession,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";
import {
  completeSessionRun,
  getActiveSessionRunId,
  listAllRunEvents,
  listIncompleteSessionRuns,
} from "../../src/core/session-event-ledger";
import { broadcastStatus } from "../../src/core/status";

const sessionIds: string[] = [];

function createSession(label: string): { sessionId: string; agentId: string } {
  const sessionId = `${label}-${crypto.randomUUID()}`;
  const agentId = "recovery-agent";
  sessionIds.push(sessionId);
  tables.chatSessions.upsert({
    id: sessionId,
    agent_id: agentId,
    title: "Recovery test",
    messages: "[]",
    created_at: new Date().toISOString(),
  });
  return { sessionId, agentId };
}

function broadcastTool(sessionId: string, index: number, timestamp: number): void {
  const toolCallId = `read-${index}`;
  broadcastStatus({
    status: "tool_executing",
    timestamp,
    detail: `Reading file ${index}`,
    sessionId,
    toolName: "read",
    toolCallId,
    toolPhase: "start",
  });
  broadcastStatus({
    status: "tool_completed",
    timestamp: timestamp + 1,
    detail: `Read file ${index}`,
    sessionId,
    toolName: "read",
    toolCallId,
    toolPhase: "result",
  });
}

afterEach(async () => {
  for (const sessionId of sessionIds.splice(0)) {
    if (getActiveSessionRunId(sessionId)) {
      broadcastStatus({ status: "idle", timestamp: Date.now(), sessionId });
    }
    tables.sessionEvents.deleteBySession(sessionId);
    await deletePersistedSession(sessionId);
  }
});

describe("chat run recovery", () => {
  test("does not mark an active in-process run as interrupted", async () => {
    const { sessionId, agentId } = createSession("active-run");
    broadcastTool(sessionId, 0, Date.now());

    const messages = await recoverInterruptedSessionMessages(sessionId, agentId, []);

    expect(messages).toEqual([]);
    expect(getActiveSessionRunId(sessionId)).toBeString();
  });

  test("rehydrates a completed long run beyond persisted metadata limits", async () => {
    const { sessionId, agentId } = createSession("completed-run");
    const timestamp = Date.now();
    for (let index = 0; index < 600; index += 1) {
      broadcastTool(sessionId, index, timestamp + index * 2);
    }
    const runId = getActiveSessionRunId(sessionId);
    expect(runId).toBeString();
    const assistant: ChatMessage = {
      role: "assistant",
      content: "Completed the long audit.",
      timestamp: new Date(timestamp + 1201).toISOString(),
      run_id: runId,
      process_activities: [
        {
          id: "stored-tail",
          phase: "result",
          text: "Only the final activity fit in metadata",
          timestamp: timestamp + 1200,
          toolName: "read",
          toolCallId: "read-599",
        },
      ],
    };
    await upsertPersistedSessionMessage(sessionId, agentId, assistant, {
      stableKey: "completed-assistant",
    });
    broadcastStatus({ status: "idle", timestamp: timestamp + 1202, sessionId });

    const persisted = await loadPersistedSession(sessionId);
    expect(persisted).not.toBeNull();
    const recovered = await recoverInterruptedSessionMessages(
      sessionId,
      agentId,
      persisted?.messages || []
    );
    const activities = recovered[0]?.process_activities || [];

    expect(activities).toHaveLength(600);
    expect(activities[0]).toMatchObject({
      phase: "result",
      text: "Read file 0",
      toolCallId: "read-0",
    });
    expect(activities[599]).toMatchObject({
      phase: "result",
      text: "Read file 599",
      toolCallId: "read-599",
    });
  });

  test("closes a recovered run so later restarts do not keep it active", async () => {
    const { sessionId, agentId } = createSession("closed-recovery-run");
    const timestamp = Date.now();
    broadcastTool(sessionId, 0, timestamp);
    broadcastTool(sessionId, 1, timestamp + 10);
    const runId = getActiveSessionRunId(sessionId);
    expect(runId).toBeString();
    completeSessionRun(sessionId);

    const recovered = await recoverInterruptedSessionMessages(sessionId, agentId, []);

    expect(recovered.some((message) => message.run_id === runId && message.interrupted)).toBe(true);
    expect(listIncompleteSessionRuns(sessionId)).toEqual([]);
    expect(listAllRunEvents(runId || "").at(-1)?.type).toBe("run_completed");
  });

  test("repairs a completed generating run that persisted no assistant response", async () => {
    const { sessionId, agentId } = createSession("completed-empty-run");
    const timestamp = Date.now();
    broadcastStatus({
      status: "thinking",
      timestamp,
      detail: "Thinking...",
      sessionId,
      agentId,
    });
    const runId = getActiveSessionRunId(sessionId);
    broadcastStatus({
      status: "generating",
      timestamp: timestamp + 1,
      detail: "Generating response...",
      sessionId,
      agentId,
    });
    broadcastStatus({ status: "idle", timestamp: timestamp + 2, sessionId, agentId });

    const firstRecovery = await recoverInterruptedSessionMessages(sessionId, agentId, []);
    const secondRecovery = await recoverInterruptedSessionMessages(
      sessionId,
      agentId,
      (await loadPersistedSession(sessionId))?.messages || []
    );

    expect(firstRecovery).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("interrupted before completion"),
        interrupted: true,
        run_id: runId,
      }),
    ]);
    expect(secondRecovery).toHaveLength(1);
    expect(secondRecovery[0]?.process_activities || []).not.toContainEqual(
      expect.objectContaining({ text: "Turn interrupted when the gateway stopped." })
    );
  });
});
