import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { applyActiveAgentToSession } from "../../src/api/chat-agent-prompt";
import {
  collapseInstructionLedger,
  restoreInstructionLedger,
  type AgentInstructionUpdate,
} from "../../src/core/agent-instruction-update";
import db from "../../src/core/database";
import {
  collapseInstructionLedgerJson,
  selectCollapsibleInstructionLedgers,
} from "../../src/core/instruction-ledger-repair";
import { estimateSessionContextUsage, loadPersistedSession } from "../../src/core/session-context";

interface LedgerMessage {
  role: string;
  content: string;
  instructionUpdate?: AgentInstructionUpdate;
}

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

function transition(content: string, historyOffset: number, agentId = "a"): LedgerMessage {
  return {
    role: "system",
    content,
    instructionUpdate: { kind: "agent-transition", agentId, historyOffset },
  };
}

describe("instruction ledger collapse", () => {
  test("collapses repeated same-agent transitions and preserves baseline and summaries", () => {
    const ledger: LedgerMessage[] = [
      { role: "system", content: "Baseline safety" },
      transition("update-1", 0),
      { role: "system", content: "[Context Summary: earlier work]" },
      transition("update-2", 1),
      transition("update-3", 2),
    ];
    const collapsed = collapseInstructionLedger(ledger);
    expect(collapsed.map((message) => message.content)).toEqual([
      "Baseline safety",
      "[Context Summary: earlier work]",
      "update-3",
    ]);
  });

  test("preserves distinct agent transitions in chronological order", () => {
    const ledger: LedgerMessage[] = [
      { role: "system", content: "Baseline safety" },
      transition("to-b", 0, "b"),
      transition("back-to-a", 1, "a"),
      transition("to-b-again", 2, "b"),
      transition("to-c", 3, "c"),
    ];
    const collapsed = collapseInstructionLedger(ledger);
    expect(collapsed.map((message) => message.content)).toEqual([
      "Baseline safety",
      "to-b",
      "back-to-a",
      "to-b-again",
      "to-c",
    ]);
  });

  test("returns the ledger untouched when no transitions are present", () => {
    const ledger: LedgerMessage[] = [
      { role: "system", content: "Baseline safety" },
      { role: "system", content: "[Context Summary: earlier work]" },
    ];
    expect(collapseInstructionLedger(ledger)).toBe(ledger);
  });

  test("restore drops superseded same-agent transitions loaded from disk", () => {
    const history = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "again" },
    ];
    const instructions: LedgerMessage[] = [
      { role: "system", content: "Baseline safety" },
      transition("x".repeat(100_000), 0),
      transition("y".repeat(100_000), 1),
      transition("z".repeat(100_000), 3),
    ];
    const restored = restoreInstructionLedger(history, instructions);
    const totalChars = JSON.stringify(restored).length;
    expect(totalChars).toBeLessThan(200_000);
    expect(restored.some((message) => message.content === "x".repeat(100_000))).toBe(false);
    expect(restored.some((message) => message.content === "y".repeat(100_000))).toBe(false);
    expect(restored.at(-1)?.content).toBe("z".repeat(100_000));
  });
});

describe("persisted instruction ledger repair", () => {
  test("collapses a bloated ledger and reports no change for healthy ones", () => {
    const bloated = JSON.stringify([
      { role: "system", content: "Baseline" },
      { ...transition("old-1", 0) },
      { ...transition("old-2", 1) },
      { ...transition("old-3", 2) },
    ]);
    const collapsed = collapseInstructionLedgerJson(bloated);
    expect(collapsed).not.toBeNull();
    expect(JSON.parse(collapsed ?? "[]")).toHaveLength(2);

    const healthy = JSON.stringify([{ role: "system", content: "Baseline" }]);
    expect(collapseInstructionLedgerJson(healthy)).toBeNull();
    expect(collapseInstructionLedgerJson(null)).toBeNull();
    expect(collapseInstructionLedgerJson("not json")).toBeNull();
    expect(collapseInstructionLedgerJson("{}")).toBeNull();
  });

  test("selects only sessions that need repair", () => {
    const targets = [
      {
        id: "a",
        instructions: JSON.stringify([
          { role: "system", content: "Baseline" },
          { ...transition("old-1", 0) },
          { ...transition("old-2", 1) },
        ]),
      },
      { id: "b", instructions: JSON.stringify([{ role: "system", content: "Baseline" }]) },
      { id: "c", instructions: null },
    ];
    expect(selectCollapsibleInstructionLedgers(targets).map((target) => target.id)).toEqual(["a"]);
  });
});

describe("agent prompt application stays bounded across repeated updates", () => {
  test("does not accumulate superseded instruction updates", async () => {
    const session = {
      agentId: "a",
      messages: [{ role: "system" as const, content: "Baseline safety instructions" }],
      updatedAt: "",
    };
    await applyActiveAgentToSession(session, agent("b", "revision 0"));
    const bounded = session.messages.length;
    for (let revision = 1; revision <= 4; revision += 1) {
      await applyActiveAgentToSession(session, agent("b", `revision ${revision}`));
      expect(session.messages.length).toBe(bounded);
    }
    const transitions = session.messages.filter(
      (message) => message.instructionUpdate?.kind === "agent-transition"
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0].content).toContain("revision 4");
    expect(session.messages[0].content).toBe("Baseline safety instructions");
  }, 60_000);
});

describe("context usage recovers after ledger repair", () => {
  test("a bloated persisted ledger is bounded on load and in storage", async () => {
    const sessionId = randomUUID();
    const bloatedInstructions = [
      { role: "system", content: "Baseline safety instructions" },
      ...Array.from({ length: 30 }, (_, index) =>
        transition(`PADDING_${index}_${"x".repeat(4_000)}`, index)
      ),
    ];
    const bloatedChars = JSON.stringify(bloatedInstructions).length;
    expect(bloatedChars).toBeGreaterThan(100_000);

    db.prepare(
      "INSERT INTO chat_sessions (id, agent_id, title, messages, workspace_dir, context_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    ).run(
      sessionId,
      "agent-a",
      "ledger repair fixture",
      JSON.stringify([{ role: "system", content: "Baseline safety instructions" }]),
      null,
      JSON.stringify({ instructions: bloatedInstructions, compactionCount: 1 })
    );

    const usage = estimateSessionContextUsage(
      (await loadPersistedSession(sessionId))?.messages ?? [],
      undefined,
      { sessionId, contextWindowTokens: 128_000 }
    );
    const loadedChars = JSON.stringify(
      (await loadPersistedSession(sessionId))?.messages ?? []
    ).length;

    expect(loadedChars).toBeLessThan(bloatedChars / 4);
    expect(usage.usedPercent).toBeLessThan(50);

    const collapsedJson = collapseInstructionLedgerJson(JSON.stringify(bloatedInstructions));
    expect(collapsedJson).not.toBeNull();
    expect((JSON.parse(collapsedJson ?? "[]") as unknown[]).length).toBe(2);

    db.prepare(
      "UPDATE chat_sessions SET context_state = json_set(context_state, '$.instructions', json(?)) WHERE id = ?"
    ).run(collapsedJson ?? "[]", sessionId);

    const storedChars = JSON.stringify(
      (
        db
          .prepare(
            "SELECT json_extract(context_state, '$.instructions') AS instructions FROM chat_sessions WHERE id = ?"
          )
          .get(sessionId) as { instructions: string }
      ).instructions
    ).length;
    expect(storedChars).toBeLessThan(bloatedChars / 4);

    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
  });
});
