import { describe, expect, test } from "bun:test";
import {
  buildCompactedConversation,
  conversationNeedsCompaction,
  estimateConversationChars,
  planCompactionCut,
  type WindowMessage,
} from "../../src/core/conversation-window";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xdecafbad);

function randInt(max: number): number {
  return Math.floor(rand() * max);
}

const ROLES = ["user", "assistant", "system", "tool"];

function randomContent(): string {
  return "x".repeat(randInt(10_000)) + `#${randInt(1_000_000)}`;
}

function randomConversation(maxLen = 200): WindowMessage[] {
  const len = randInt(maxLen + 1);
  return Array.from({ length: len }, () => ({
    role: ROLES[randInt(ROLES.length)],
    content: randomContent(),
  }));
}

function alternatingConversation(maxLen = 200): WindowMessage[] {
  const len = randInt(maxLen + 1);
  return Array.from({ length: len }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}-${randInt(1000)}`,
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

describe("planCompactionCut properties", () => {
  test("cut is always within [0, convo.length] and preserves keepRecent-ish tail", () => {
    for (let iter = 0; iter < 200; iter++) {
      const convo = randomConversation();
      const keepRecent = 1 + randInt(50);
      const cut = planCompactionCut(convo, keepRecent);
      expect(Number.isInteger(cut)).toBe(true);
      expect(cut).toBeGreaterThanOrEqual(0);
      expect(cut).toBeLessThanOrEqual(convo.length);
      const retained = convo.length - cut;
      if (cut > 0) {
        expect(retained).toBeGreaterThanOrEqual(1);
        expect(retained).toBeLessThanOrEqual(keepRecent);
      } else {
        expect(retained).toBe(convo.length);
      }
    }
  });

  test("on alternating conversations the cut never opens the window on a user turn", () => {
    for (let iter = 0; iter < 200; iter++) {
      const convo = alternatingConversation();
      const keepRecent = 1 + randInt(50);
      const cut = planCompactionCut(convo, keepRecent);
      if (cut > 0 && cut < convo.length && convo[cut].role === "user") {
        expect(cut + 1).toBe(convo.length);
      }
    }
  });
});

describe("buildCompactedConversation properties", () => {
  test("output preserves the system prefix and the retained tail in order", () => {
    for (let iter = 0; iter < 200; iter++) {
      const systemCount = randInt(3);
      const system: WindowMessage[] = Array.from({ length: systemCount }, (_, i) => ({
        role: "system",
        content: `sys${i}`,
      }));
      const convo = randomConversation(120);
      const keepRecent = 1 + randInt(50);
      const cut = planCompactionCut(convo, keepRecent);
      const recent = convo.slice(cut);

      const out = buildCompactedConversation(system, recent, `S${iter}`, "PREFIX");

      for (let i = 0; i < system.length; i++) {
        expect(out[i]).toEqual(system[i]);
      }

      if (recent.length === 0) {
        expect(out.length).toBe(system.length + 1);
        expect(out[system.length].role).toBe("user");
        expect(out[system.length].content).toBe(`PREFIX\nS${iter}`);
        continue;
      }

      const tail = out.slice(out.length - (recent.length - 1));
      expect(tail).toEqual(recent.slice(1));

      const firstRetained = out[out.length - recent.length];
      expect(firstRetained.role).toBe(recent[0].role === "user" ? "user" : recent[0].role);
      expect(firstRetained.content).toContain(recent[0].content);
      const summaryCarrier = out[system.length];
      expect(summaryCarrier.role).toBe("user");
      expect(summaryCarrier.content).toContain(`PREFIX\nS${iter}`);
    }
  });

  test("alternating input never compacts into two consecutive user messages", () => {
    for (let iter = 0; iter < 200; iter++) {
      const system: WindowMessage[] = [{ role: "system", content: "sys" }];
      const convo = alternatingConversation();
      const keepRecent = 1 + randInt(50);
      const cut = planCompactionCut(convo, keepRecent);
      const recent = convo.slice(cut);
      const out = buildCompactedConversation(system, recent, "SUMMARY", "PREFIX");
      expect(noConsecutiveDuplicateRoles(out)).toBe(true);
    }
  });
});

describe("estimateConversationChars properties", () => {
  test("non-negative and monotonic under append", () => {
    for (let iter = 0; iter < 100; iter++) {
      const convo = randomConversation(60);
      let prev = estimateConversationChars([]);
      expect(prev).toBe(0);
      for (let i = 1; i <= convo.length; i++) {
        const current = estimateConversationChars(convo.slice(0, i));
        expect(current).toBeGreaterThanOrEqual(0);
        expect(current).toBeGreaterThanOrEqual(prev);
        prev = current;
      }
      expect(prev).toBeGreaterThanOrEqual(convo.reduce((sum, m) => sum + m.content.length, 0));
    }
  });
});

describe("conversationNeedsCompaction properties", () => {
  test("returns a boolean and never compacts below keepRecent + 2 messages", () => {
    for (let iter = 0; iter < 300; iter++) {
      const opts = {
        convoLength: randInt(400),
        convoChars: randInt(5_000_000),
        threshold: randInt(1_000_000),
        maxMessages: randInt(300),
        keepRecent: 1 + randInt(50),
      };
      const result = conversationNeedsCompaction(opts);
      expect(typeof result).toBe("boolean");
      if (opts.convoLength <= opts.keepRecent + 2) {
        expect(result).toBe(false);
      }
      if (result) {
        expect(opts.convoChars > opts.threshold || opts.convoLength > opts.maxMessages).toBe(true);
      }
    }
  });
});
