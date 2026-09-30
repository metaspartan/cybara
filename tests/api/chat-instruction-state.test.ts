import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  applyActiveAgentToSession,
  sessionPromptUsesTools,
  refreshSessionAgentSystemPromptIfNeeded,
} from "../../src/api/chat-agent-prompt";
import db from "../../src/core/database";
import {
  deletePersistedSession,
  loadPersistedSession,
  persistSession,
  persistSessionContextState,
} from "../../src/core/session-context";

const agent = (id: string, instruction = id) => ({
  id,
  name: id,
  type: "main" as const,
  model: null,
  provider_id: null,
  tools: [],
  config: {},
  system_prompt: instruction,
});

describe("durable instruction transitions", () => {
  test("preserves baseline, appends latest authority and deduplicates refresh", async () => {
    const session = {
      agentId: "a",
      messages: [{ role: "system" as const, content: "Baseline safety instructions" }],
      updatedAt: "",
    };
    await applyActiveAgentToSession(session, agent("b"));
    expect(session.messages[0].content).toBe("Baseline safety instructions");
    expect(session.messages.at(-1)?.content).toContain("supersedes earlier agent-specific");
    expect(session.messages.at(-1)?.content).toContain("agent=b");
    const count = session.messages.length;
    await refreshSessionAgentSystemPromptIfNeeded(session, agent("b"));
    expect(session.messages.length).toBe(count);
    await refreshSessionAgentSystemPromptIfNeeded(
      session,
      agent("b", "Updated approved instructions")
    );
    expect(session.messages.length).toBe(count);
    expect(session.messages.at(-1)?.content).toContain("Updated approved instructions");
    expect(
      session.messages.filter((message) => message.instructionUpdate !== undefined)
    ).toHaveLength(1);
  });
  test("replaces only pending switches at the same boundary and uses latest tools and instructions", async () => {
    const session: {
      agentId: string;
      messages: import("../../src/api/chat-types").ChatMessage[];
      updatedAt: string;
    } = {
      agentId: "a",
      messages: [{ role: "system", content: "Baseline safety", timestamp: "" }],
      updatedAt: "",
    };
    await applyActiveAgentToSession(session, agent("b"), undefined, {
      useTools: false,
      pendingTransition: true,
    });
    expect(sessionPromptUsesTools(session.messages)).toBe(false);
    await applyActiveAgentToSession(session, agent("c", "latest approved instruction"), undefined, {
      useTools: sessionPromptUsesTools(session.messages),
      pendingTransition: true,
    });
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].content).toBe("Baseline safety");
    expect(session.messages[1].content).toContain("latest approved instruction");
    expect(session.messages[1].content).toContain("Available tools: none");
    await refreshSessionAgentSystemPromptIfNeeded(
      session,
      agent("c", "latest approved instruction"),
      undefined,
      { useTools: true }
    );
    expect(session.messages).toHaveLength(2);
    expect(sessionPromptUsesTools(session.messages)).toBe(true);
    expect(session.messages[1].instructionUpdate?.pending).not.toBe(true);
    const consumed = session.messages[1];
    await applyActiveAgentToSession(session, agent("d"), undefined, {
      useTools: false,
      pendingTransition: true,
    });
    expect(session.messages).toHaveLength(3);
    expect(session.messages[1]).toEqual(consumed);
    session.messages.push({ role: "user", content: "boundary", timestamp: "" });
    await applyActiveAgentToSession(session, agent("e"), undefined, {
      useTools: false,
      pendingTransition: true,
    });
    expect(session.messages).toHaveLength(5);
    expect(session.messages[2].content).toContain("agent=d");
  });
  test("unchanged refresh consumes pending transition and does not hide later instruction edits", async () => {
    const session = {
      agentId: "a",
      messages: [{ role: "system" as const, content: "Baseline" }],
      updatedAt: "",
    };
    await applyActiveAgentToSession(session, agent("b"), undefined, {
      useTools: false,
      pendingTransition: true,
    });
    await refreshSessionAgentSystemPromptIfNeeded(session, agent("b"), undefined, {
      useTools: false,
    });
    await applyActiveAgentToSession(session, agent("b", "new instruction"), undefined, {
      useTools: false,
      pendingTransition: true,
    });
    expect(session.messages).toHaveLength(2);
    expect(session.messages.at(-1)?.content).toContain("new instruction");
    expect(
      session.messages.filter((message) => message.instructionUpdate !== undefined)
    ).toHaveLength(1);
  });
  test("atomic instruction update preserves unrelated context state", async () => {
    const id = `instruction-context-${randomUUID()}`;
    await persistSession(id, "a", [{ role: "system", content: "Baseline" }]);
    try {
      db.prepare("UPDATE chat_sessions SET context_state = ? WHERE id = ?").run(
        JSON.stringify({
          readonlyVerification: { verified: true },
          compactionCount: 4,
        }),
        id
      );
      const session = {
        id,
        agentId: "a",
        messages: [{ role: "system" as const, content: "Baseline" }],
        updatedAt: "",
      };
      await applyActiveAgentToSession(session, agent("b"), undefined, {
        useTools: false,
        pendingTransition: true,
      });
      const row = db.prepare("SELECT context_state FROM chat_sessions WHERE id = ?").get(id) as {
        context_state: string;
      };
      const state = JSON.parse(row.context_state);
      expect(state.readonlyVerification).toEqual({ verified: true });
      expect(state.compactionCount).toBe(4);
      expect(state.instructions).toHaveLength(2);
    } finally {
      await deletePersistedSession(id);
    }
  });
  test("agent ownership does not change before asynchronous preparation completes", async () => {
    const session = { agentId: "a", messages: [], updatedAt: "" };
    const pending = applyActiveAgentToSession(session, agent("b"));
    expect(session.agentId).toBe("a");
    await pending;
    expect(session.agentId).toBe("b");
  });
  test("restores baseline and latest authority after restart and compaction", async () => {
    const id = `instruction-test-${randomUUID()}`;
    const session = {
      id,
      agentId: "a",
      messages: [{ role: "system" as const, content: "Baseline safety instructions" }],
      updatedAt: "",
    };
    try {
      await persistSession(id, "a", session.messages);
      await applyActiveAgentToSession(session, agent("b"));
      const persisted = await loadPersistedSession(id);
      expect(persisted?.agentId).toBe("b");
      expect(persisted?.messages.filter((message) => message.role === "system")).toEqual(
        session.messages
      );
      expect(
        persistSessionContextState(
          id,
          [...session.messages, { role: "user", content: "summary" }],
          1
        )
      ).toBe(true);
      const restored = await loadPersistedSession(id);
      expect(restored?.contextMessages?.filter((message) => message.role === "system")).toEqual(
        session.messages
      );
      const restarted = { ...session, messages: restored!.contextMessages! };
      const count = restarted.messages.length;
      await refreshSessionAgentSystemPromptIfNeeded(restarted, agent("b"));
      expect(restarted.messages.length).toBe(count);
    } finally {
      await deletePersistedSession(id);
    }
  });
  test("restart preserves A B A ledger positions around persisted user messages", async () => {
    const id = `instruction-test-${crypto.randomUUID()}`;
    const session = {
      id,
      agentId: "a",
      messages: [
        { role: "system" as const, content: "Baseline" },
      ] as import("../../src/api/chat-types").ChatMessage[],
      updatedAt: "",
    };
    try {
      session.messages.push(
        { role: "user", content: "Question A" },
        { role: "assistant", content: "Answer A" }
      );
      await persistSession(id, "a", session.messages);
      await applyActiveAgentToSession(session, agent("b"));
      session.messages.push(
        { role: "user", content: "Question B" },
        { role: "assistant", content: "Answer B" }
      );
      await persistSession(id, "b", session.messages);
      await applyActiveAgentToSession(session, agent("a"));
      for (const message of session.messages.filter((message) => message.role !== "system")) {
        db.prepare(
          "INSERT INTO session_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)"
        ).run(crypto.randomUUID(), id, message.role, message.content);
      }
      const loaded = await loadPersistedSession(id);
      expect(loaded?.messages.map((message) => message.content)).toEqual(
        session.messages.map((message) => message.content)
      );
      expect(
        loaded?.messages
          .filter((message) => message.instructionUpdate)
          .map((message) => message.instructionUpdate?.agentId)
      ).toEqual(["b", "a"]);
    } finally {
      await deletePersistedSession(id);
    }
  });
  test("database failure leaves ownership and baseline untouched", async () => {
    const id = `instruction-test-${randomUUID()}`;
    const session = {
      id,
      agentId: "a",
      messages: [{ role: "system" as const, content: "Baseline" }],
      updatedAt: "",
    };
    try {
      await persistSession(id, "a", session.messages);
      db.prepare("UPDATE chat_sessions SET context_state = 'malformed' WHERE id = ?").run(id);
      await expect(applyActiveAgentToSession(session, agent("b"))).rejects.toThrow();
      expect(session.agentId).toBe("a");
      expect(session.messages).toEqual([{ role: "system", content: "Baseline" }]);
      expect(
        (
          db.prepare("SELECT agent_id FROM chat_sessions WHERE id = ?").get(id) as {
            agent_id: string;
          }
        ).agent_id
      ).toBe("a");
    } finally {
      await deletePersistedSession(id);
    }
  });
  test("external switches abort and serialize with active turns", () => {
    const source = readFileSync(
      new URL("../../src/api/chat-session-api.ts", import.meta.url),
      "utf8"
    );
    const start = source.indexOf("export async function updateSessionAgent(");
    const end = source.indexOf("async function updateSessionAgentAtTurnBoundary(", start);
    const entrypoint = source.slice(start, end);
    expect(entrypoint).toContain("activeChatTurnAbortControllers.get(sessionId)?.abort()");
    expect(entrypoint).toContain("chatTurnMutex.run(sessionId");
  });
});
