import { afterEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../../src/api/chat-types";
import { buildChatExecutionMessagesForAgent } from "../../src/api/chat-execution-messages";
import db from "../../src/core/database";
import { trackContextCompaction, trackToolTranscriptCompaction } from "../../src/core/metrics";
import { compactOpenAILoopMessagesForContext } from "../../src/core/agent-context-guard";
import {
  anchorActiveContextUsage,
  clearActiveContextUsage,
  loadActiveContextUsage,
  recordActiveContextUsage,
} from "../../src/core/llm/session-active-context";
import {
  estimateMessagesRequestVisibleTokens,
  estimateMessagesTranscriptTokens,
  estimateSessionContextUsage,
  persistSession,
  persistSessionContextState,
  loadPersistedSession,
  upsertPersistedSessionMessage,
  clearSessionContextState,
  deletePersistedSession,
} from "../../src/core/session-context";
import { onStatus, type StatusPayload } from "../../src/core/status";

const ids: string[] = [];
async function session(messages: ChatMessage[]): Promise<string> {
  const id = `active-usage-${crypto.randomUUID()}`;
  ids.push(id);
  await persistSession(id, "fixture-agent", messages);
  return id;
}
afterEach(async () => {
  for (const id of ids.splice(0)) await deletePersistedSession(id);
});

describe("active context after compaction", () => {
  test("a full million-token transcript drops to actual compacted usage without losing transcript or cumulative usage", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "x".repeat(4_000_000) },
      { role: "assistant", content: "Earlier response" },
    ];
    const id = await session(messages);
    const before = estimateSessionContextUsage(messages, "space-bunny-free", {
      sessionId: id,
      contextWindowTokens: 1_000_000,
    });
    expect(before.usedTokens).toBeGreaterThan(1_000_000);
    const events: StatusPayload[] = [];
    const unsubscribe = onStatus((event) => {
      if (event.sessionId === id) events.push(event);
    });
    try {
      recordActiveContextUsage(id, 32_000, 1_000_000);
      anchorActiveContextUsage(id, estimateMessagesRequestVisibleTokens(messages));
      const after = estimateSessionContextUsage(messages, "space-bunny-free", {
        sessionId: id,
        contextWindowTokens: 1_000_000,
      });
      expect(after.usedTokens).toBe(32_000);
      expect(after.remainingTokens).toBe(968_000);
      expect(after.usedPercent).toBe(3.2);
      expect(after.transcriptTokens).toBeGreaterThan(1_000_000);
      expect(messages[0]?.content).toHaveLength(4_000_000);
      expect(events.at(-1)?.contextUsage?.usedTokens).toBe(32_000);
      expect(events.at(-1)?.contextUsage?.limitTokens).toBe(1_000_000);
      const row = db
        .query<{ value: string }, [string]>(
          "SELECT json_extract(context_state, '$.activeUsage') AS value FROM chat_sessions WHERE id = ?"
        )
        .get(id);
      expect(JSON.parse(row?.value ?? "{}").usedTokens).toBe(32_000);
    } finally {
      unsubscribe();
    }
  });

  test("subsequent appended turns add only their new tokens and summary replacement clears old anchors", async () => {
    const messages: ChatMessage[] = [{ role: "user", content: "old ".repeat(20_000) }];
    const id = await session(messages);
    const baseline = estimateMessagesRequestVisibleTokens(messages);
    recordActiveContextUsage(id, 2000, 1_000_000);
    anchorActiveContextUsage(id, baseline);
    const extra: ChatMessage = { role: "user", content: "new request" };
    messages.push(extra);
    expect(estimateSessionContextUsage(messages, undefined, { sessionId: id }).usedTokens).toBe(
      2000 + estimateMessagesRequestVisibleTokens([extra])
    );
    expect(persistSessionContextState(id, messages, 1)).toBe(true);
    expect(loadActiveContextUsage(id)?.usedTokens).toBe(2000);
    expect(clearSessionContextState(id)).toBe(true);
    expect(loadActiveContextUsage(id)).toBeNull();
    expect(estimateSessionContextUsage(messages, undefined, { sessionId: id }).usedTokens).toBe(
      estimateMessagesRequestVisibleTokens(messages)
    );
  });

  test("nested tool argument/result mutation invalidates estimates without replacing the array", () => {
    const call = {
      id: "call",
      name: "read",
      args: { path: "fixture.txt" },
      result: { value: "x".repeat(4000) },
      status: "completed" as const,
    };
    const messages: ChatMessage[] = [{ role: "assistant", content: "", tool_calls: [call] }];
    const before = estimateMessagesRequestVisibleTokens(messages);
    const transcriptBefore = estimateMessagesTranscriptTokens(messages);
    call.result.value = "x";
    expect(estimateMessagesRequestVisibleTokens(messages)).toBeLessThan(before);
    expect(estimateMessagesTranscriptTokens(messages)).toBeLessThan(transcriptBefore);
    const executionBefore = buildChatExecutionMessagesForAgent(messages);
    call.result.value = "different";
    const executionAfter = buildChatExecutionMessagesForAgent(messages);
    expect(executionAfter.find((message) => message.role === "tool")?.content).not.toBe(
      executionBefore.find((message) => message.role === "tool")?.content
    );
  });

  test("real request compaction reports reduced usage while keeping a separate canonical transcript", async () => {
    const id = await session([{ role: "user", content: "original" }]);
    const wire: Record<string, unknown>[] = [
      { role: "system", content: "fixture" },
      { role: "user", content: "read" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "x".repeat(4_000_000) },
      { role: "assistant", content: "received" },
      { role: "user", content: "continue" },
      { role: "assistant", content: "working" },
      { role: "user", content: "next" },
    ];
    const before = JSON.stringify(wire).length;
    expect(
      compactOpenAILoopMessagesForContext(wire, 120_000, false, {
        toolContext: { sessionId: id, maxContextTokens: 1_000_000 },
      })
    ).toBe(true);
    expect(JSON.stringify(wire).length).toBeLessThan(before);
    expect(loadActiveContextUsage(id)?.usedTokens).toBeLessThan(100_000);
    clearActiveContextUsage(id);
    expect(loadActiveContextUsage(id)).toBeNull();
  });

  test("live and loaded counters exclude request-only legacy reductions and preserve provider source", async () => {
    const id = await session([{ role: "user", content: "fixture" }]);
    trackContextCompaction(id, {
      messagesBefore: 10,
      messagesAfter: 2,
      tokensBefore: 1_000_000,
      tokensAfter: 32_000,
    });
    db.query("INSERT INTO metrics(id,type,key,value,metadata) VALUES(?,?,?,?,?)").run(
      crypto.randomUUID(),
      "context_compaction",
      id,
      100,
      JSON.stringify({ scope: "request_only", messagesBefore: 2, messagesAfter: 2 })
    );
    const captured: StatusPayload[] = [];
    const unsubscribe = onStatus((event) => {
      if (event.sessionId === id) captured.push(event);
    });
    try {
      recordActiveContextUsage(id, 32000, 1_000_000, 2, "provider");
      anchorActiveContextUsage(
        id,
        estimateMessagesRequestVisibleTokens([{ role: "user", content: "fixture" }]),
        1
      );
      const loaded = estimateSessionContextUsage(
        [{ role: "user", content: "fixture" }],
        undefined,
        { sessionId: id }
      );
      expect(loaded.compactionCount).toBe(1);
      expect(
        estimateSessionContextUsage([
          { role: "user", content: "[Context Summary: same]" },
          { role: "user", content: "[Context Summary: same]" },
        ]).compactionCount
      ).toBe(1);
      expect(captured.at(-1)?.contextUsage?.compactionCount).toBe(1);
      expect(loaded.source).toBe("provider");
      expect(loaded.limitTokens).toBe(1_000_000);
      trackToolTranscriptCompaction(id, {
        messagesBefore: 2,
        messagesAfter: 2,
        tokensBefore: 32000,
        tokensAfter: 30000,
      });
      recordActiveContextUsage(id, 30000, 1_000_000);
      expect(captured.at(-1)?.contextUsage?.compactionCount).toBe(2);
      expect(estimateSessionContextUsage([], undefined, { sessionId: id }).compactionCount).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  test("reload restores each retained user checkpoint once instead of counting it as multiple compactions", async () => {
    const user: ChatMessage = { role: "user", content: "Original user instruction" };
    const id = await session([user]);
    await upsertPersistedSessionMessage(id, "fixture-agent", user, { stableKey: "original-user" });
    const summary: ChatMessage = {
      role: "user",
      content: "[Context Summary: retained checkpoint]",
    };
    const instruction: ChatMessage = {
      role: "system",
      content: "Current instructions",
      instructionUpdate: { kind: "agent-transition", agentId: "fixture-agent", historyOffset: 0 },
    };
    expect(await persistSession(id, "fixture-agent", [instruction, user])).toBe(true);
    expect(persistSessionContextState(id, [instruction, summary], 1)).toBe(true);
    const loaded = await loadPersistedSession(id);
    expect(
      loaded?.contextMessages?.filter((message) => message.content === summary.content)
    ).toHaveLength(1);
    expect(
      estimateSessionContextUsage(loaded?.contextMessages ?? [], undefined, {
        sessionId: id,
        compactionCount: loaded?.compactionCount,
      }).compactionCount
    ).toBe(1);
  });

  test("invalid snapshots never corrupt estimates", async () => {
    const id = await session([]);
    recordActiveContextUsage(id, Number.NaN, 1_000_000);
    expect(loadActiveContextUsage(id)).toBeNull();
    recordActiveContextUsage(id, -1, 1_000_000);
    expect(loadActiveContextUsage(id)).toBeNull();
    recordActiveContextUsage(id, 0, 1_000_000);
    expect(loadActiveContextUsage(id)?.usedTokens).toBe(0);
    db.query(
      "UPDATE chat_sessions SET context_state = json_set(context_state, '$.activeUsage.usedTokens', 'bad') WHERE id = ?"
    ).run(id);
    expect(loadActiveContextUsage(id)).toBeNull();
  });
});
