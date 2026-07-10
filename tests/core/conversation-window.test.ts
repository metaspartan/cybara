import { describe, expect, test } from "bun:test";
import {
  buildCompactedConversation,
  conversationNeedsCompaction,
  estimateConversationChars,
  planCompactionCut,
  resolveCompactionTriggerRatio,
  type WindowMessage,
} from "../../src/core/conversation-window";

function turns(n: number): WindowMessage[] {
  // Alternating user/assistant starting with user, like a real chat history.
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));
}

function noConsecutiveDuplicateRoles(messages: WindowMessage[]): boolean {
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role !== "system" && messages[i].role === messages[i - 1].role) {
      return false;
    }
  }
  return true;
}

describe("conversation windowing", () => {
  test("estimateConversationChars counts content plus per-message overhead", () => {
    const convo: WindowMessage[] = [
      { role: "user", content: "abcd" },
      { role: "assistant", content: "ef" },
    ];
    expect(estimateConversationChars(convo)).toBe(4 + 2 + 64);
  });

  test("does not compact a short conversation", () => {
    expect(
      conversationNeedsCompaction({
        convoLength: 6,
        convoChars: 999_999,
        threshold: 10,
        maxMessages: 60,
        keepRecent: 16,
      })
    ).toBe(false);
  });

  test("compacts when characters exceed the threshold", () => {
    expect(
      conversationNeedsCompaction({
        convoLength: 40,
        convoChars: 5_000,
        threshold: 4_000,
        maxMessages: 60,
        keepRecent: 16,
      })
    ).toBe(true);
  });

  test("compacts when message count exceeds the cap even if small", () => {
    expect(
      conversationNeedsCompaction({
        convoLength: 80,
        convoChars: 100,
        threshold: 4_000,
        maxMessages: 60,
        keepRecent: 16,
      })
    ).toBe(true);
  });

  test("planCompactionCut keeps the last N and nudges off a user boundary", () => {
    // 20 turns, keepRecent 8 -> raw cut = 12. convo[12] is user (even index),
    // so it nudges to 13 (assistant) to keep alternation clean.
    const convo = turns(20);
    expect(convo[12].role).toBe("user");
    expect(planCompactionCut(convo, 8)).toBe(13);
  });

  test("planCompactionCut returns 0 when there is nothing older to cut", () => {
    expect(planCompactionCut(turns(8), 16)).toBe(0);
  });

  test("summary is inserted as its own user turn when the window opens on assistant", () => {
    const system: WindowMessage[] = [{ role: "system", content: "sys" }];
    const recent: WindowMessage[] = [
      { role: "assistant", content: "a10" },
      { role: "user", content: "u11" },
    ];
    const out = buildCompactedConversation(system, recent, "SUMMARY", "PREFIX");
    expect(out[0]).toEqual({ role: "system", content: "sys" });
    expect(out[1].role).toBe("user");
    expect(out[1].content).toBe("PREFIX\nSUMMARY");
    expect(out[2]).toEqual({ role: "assistant", content: "a10" });
    expect(noConsecutiveDuplicateRoles(out)).toBe(true);
  });

  test("summary folds into the first retained turn when the window opens on user", () => {
    const system: WindowMessage[] = [{ role: "system", content: "sys" }];
    const recent: WindowMessage[] = [
      { role: "user", content: "u10" },
      { role: "assistant", content: "a11" },
    ];
    const out = buildCompactedConversation(system, recent, "SUMMARY", "PREFIX");
    // No extra message added: summary is prepended into the first user turn.
    expect(out).toHaveLength(3);
    expect(out[1].role).toBe("user");
    expect(out[1].content).toContain("PREFIX\nSUMMARY");
    expect(out[1].content).toContain("u10");
    expect(noConsecutiveDuplicateRoles(out)).toBe(true);
  });

  test("end-to-end plan+build keeps alternation on a long history", () => {
    const messages = [{ role: "system", content: "sys" } as WindowMessage, ...turns(40)];
    const system = messages.slice(0, 1);
    const convo = messages.slice(1);
    const cut = planCompactionCut(convo, 16);
    const recent = convo.slice(cut);
    const out = buildCompactedConversation(system, recent, "SUMMARY", "PREFIX");
    expect(noConsecutiveDuplicateRoles(out)).toBe(true);
    expect(out[0].role).toBe("system");
    expect(out.length).toBeLessThan(messages.length);
  });
});

describe("model-aware compaction trigger ratio", () => {
  test("large-context models run closer to full before compacting", () => {
    // 272K (gpt-5.4-class) should compact at 85%, not the old ~41%.
    expect(resolveCompactionTriggerRatio(272_000)).toBe(0.85);
    expect(resolveCompactionTriggerRatio(200_000)).toBe(0.85);
    // 128K (spark-class) at 80%.
    expect(resolveCompactionTriggerRatio(128_000)).toBe(0.8);
    // Default/small windows keep headroom for the summary call.
    expect(resolveCompactionTriggerRatio(65_536)).toBe(0.72);
  });

  test("user override can only RAISE the model default, never lower it", () => {
    // A high user threshold is honored (never clamped down — the PR's bug 3).
    expect(resolveCompactionTriggerRatio(272_000, 0.9)).toBe(0.9);
    // A low user threshold cannot drag a large model below its safe default.
    expect(resolveCompactionTriggerRatio(272_000, 0.4)).toBe(0.85);
    // Out-of-range / invalid user values are ignored.
    expect(resolveCompactionTriggerRatio(65_536, 0)).toBe(0.72);
    expect(resolveCompactionTriggerRatio(65_536, Number.NaN)).toBe(0.72);
    // Clamped to the sane ceiling.
    expect(resolveCompactionTriggerRatio(65_536, 5)).toBe(0.95);
  });
});
