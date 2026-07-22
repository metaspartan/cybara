import { describe, expect, test } from "bun:test";
import db from "../../src/core/database";
import { listSessionRuntimeMetrics } from "../../src/core/session-runtime-metrics";

describe("session runtime metrics", () => {
  test("aggregates persisted chat usage, cache, latency, throughput, and compaction", () => {
    const sessionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO chat_sessions (id, agent_id, title, messages, workspace_dir)
       VALUES (?, ?, ?, '[]', ?)`
    ).run(sessionId, "agent-1", "Metrics chat", "/tmp/project");
    for (const [index, usage] of [
      {
        input: 100,
        output: 50,
        cached: 25,
        write: 5,
        duration: 1000,
        generationDuration: 500,
        first: 300,
      },
      {
        input: 200,
        output: 150,
        cached: 50,
        write: 10,
        duration: 3000,
        generationDuration: 1500,
        first: 500,
      },
    ].entries()) {
      db.prepare(
        `INSERT INTO metrics (id, type, key, value, metadata)
         VALUES (?, 'token_usage_by_session', ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        sessionId,
        usage.input + usage.output,
        JSON.stringify({
          model: index === 1 ? "model-b" : "model-a",
          provider: "provider-a",
          inputTokens: usage.input,
          outputTokens: usage.output,
          cachedInputTokens: usage.cached,
          cacheWriteTokens: usage.write,
          durationMs: usage.duration,
          generationDurationMs: usage.generationDuration,
          firstTokenMs: usage.first,
        })
      );
    }
    db.prepare(
      `INSERT INTO metrics (id, type, key, value, metadata)
       VALUES (?, 'context_compaction', ?, 700, '{}')`
    ).run(crypto.randomUUID(), sessionId);
    db.prepare(
      `INSERT INTO metrics (id, type, key, value, metadata)
       VALUES (?, 'token_usage_by_session', ?, 0, ?)`
    ).run(
      crypto.randomUUID(),
      sessionId,
      JSON.stringify({
        model: "model-b",
        provider: "provider-a",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        firstTokenMs: 0,
      })
    );
    db.prepare(
      `INSERT INTO metrics (id, type, key, value, metadata)
       VALUES (?, 'token_usage_by_session', ?, 10, ?)`
    ).run(
      crypto.randomUUID(),
      sessionId,
      JSON.stringify({
        model: "model-b",
        provider: "provider-a",
        inputTokens: 0,
        outputTokens: 10,
        durationMs: 1000,
        generationDurationMs: 1,
      })
    );
    db.prepare(
      `INSERT INTO metrics (id, type, key, value, metadata)
       VALUES (?, 'token_usage_by_session', ?, 999, '{}')`
    ).run(crypto.randomUUID(), "agent:subagent:ignored");

    const result = listSessionRuntimeMetrics();
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId,
      model: "model-b",
      provider: "provider-a",
      inputTokens: 300,
      outputTokens: 210,
      cachedInputTokens: 75,
      cacheWriteTokens: 15,
      totalTokens: 510,
      callCount: 4,
      durationMs: 5000,
      tokensPerSecond: 100,
      firstTokenMs: 400,
      latencyCallCount: 2,
      compactionCount: 1,
      compactedTokens: 700,
    });
    expect(result.totals).toMatchObject({
      sessions: 1,
      totalTokens: 510,
      callCount: 4,
      tokensPerSecond: 100,
      firstTokenMs: 400,
    });
  });

  test("preserves missing first-token latency for legacy session metrics", () => {
    const sessionId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO chat_sessions (id, agent_id, title, messages)
       VALUES (?, ?, ?, '[]')`
    ).run(sessionId, "agent-legacy", "Legacy metrics chat");
    db.prepare(
      `INSERT INTO metrics (id, type, key, value, metadata)
       VALUES (?, 'token_usage_by_session', ?, 150, ?)`
    ).run(
      crypto.randomUUID(),
      sessionId,
      JSON.stringify({
        provider: "provider-legacy",
        model: "model-legacy",
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
        firstTokenMs: 0,
      })
    );

    const session = listSessionRuntimeMetrics().sessions.find((row) => row.sessionId === sessionId);
    expect(session?.firstTokenMs).toBeNull();
    expect(session?.latencyCallCount).toBe(0);
  });

  test("pages chat runtime rows while retaining lifetime totals", () => {
    const baseline = listSessionRuntimeMetrics(1, 100).totals.sessions;
    const sessionIds = Array.from({ length: 7 }, (_, index) => {
      const sessionId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO chat_sessions (id, agent_id, title, messages, updated_at)
         VALUES (?, ?, ?, '[]', ?)`
      ).run(
        sessionId,
        "agent-pagination",
        `Runtime page ${index + 1}`,
        `2099-01-${String(index + 1).padStart(2, "0")} 00:00:00`
      );
      db.prepare(
        `INSERT INTO metrics (id, type, key, value, metadata)
         VALUES (?, 'token_usage_by_session', ?, 15, ?)`
      ).run(
        crypto.randomUUID(),
        sessionId,
        JSON.stringify({ inputTokens: 10, outputTokens: 5, durationMs: 100 })
      );
      return sessionId;
    });

    const first = listSessionRuntimeMetrics(1, 5);
    const second = listSessionRuntimeMetrics(2, 5);

    expect(first.pagination).toMatchObject({ page: 1, pageSize: 5, hasNextPage: true });
    expect(first.totals.sessions).toBe(baseline + sessionIds.length);
    expect(first.sessions).toHaveLength(5);
    expect(second.pagination.page).toBe(2);
    expect(second.pagination.hasPreviousPage).toBe(true);
    expect(
      first.sessions.some((row) => second.sessions.some((next) => next.sessionId === row.sessionId))
    ).toBe(false);
  });
});
