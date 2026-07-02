import { describe, expect, test } from "bun:test";
import {
  escapeMarkdown,
  formatToolCallsForTelegram,
  formatToolCallsForDiscord,
  formatToolCallsPlain,
} from "../../src/core/channels/formatting";
import type { ToolCallInfo } from "../../src/core/channels/types";

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

const rand = mulberry32(0xc0ffee);
function randInt(max: number): number {
  return Math.floor(rand() * max);
}

const POOLS = [
  "abcdefghijklmnopqrstuvwxyz0123456789 ",
  "[]()*_`{}|\\<>#-+=!@$%^&:;\"'",
  "日本語漢字😀🔥💀áéíóúßÆ  ",
];
function randString(maxLen: number): string {
  const pool = POOLS[randInt(POOLS.length)]!;
  const len = randInt(maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[randInt(pool.length)];
  return out;
}

const STATUSES = ["completed", "failed", "running", "queued", "", "weird-status"];
function randToolCall(): ToolCallInfo {
  const tc: ToolCallInfo = {
    name: randString(20) || "tool",
    status: STATUSES[randInt(STATUSES.length)]!,
  };
  if (rand() < 0.5) tc.id = randString(10);
  if (rand() < 0.3) tc.duration = randInt(100000);
  if (rand() < 0.4) tc.error = randString(200);
  if (rand() < 0.4) {
    const r = rand();
    tc.result =
      r < 0.4
        ? randString(200)
        : r < 0.7
          ? { nested: randString(50), n: randInt(1000) }
          : randInt(1000);
  }
  return tc;
}

describe("escapeMarkdown", () => {
  test("escapes [ and ] when the escape path is triggered", () => {
    expect(escapeMarkdown("[hello]")).toBe("\\[hello\\]");
  });

  test("triggers escaping via any of the trigger chars: [ ] ( ) * _ `", () => {
    for (const ch of ["[", "]", "(", ")", "*", "_", "`"]) {
      const input = `a${ch}b[x]c`;
      const out = escapeMarkdown(input);
      expect(out).toContain("\\[");
      expect(out).toContain("\\]");
    }
  });

  test("triggers escaping when length >= 50 even without trigger chars", () => {
    const long = "x".repeat(49) + "[y]";
    expect(long.length).toBeGreaterThanOrEqual(50);
    expect(escapeMarkdown(long)).toBe("x".repeat(49) + "\\[y\\]");
  });

  test("only escapes brackets, not other markdown chars", () => {
    const out = escapeMarkdown("*bold* _it_ `c` (p)");
    expect(out).toContain("*bold*");
    expect(out).toContain("_it_");
    expect(out).toContain("`c`");
    expect(out).toContain("(p)");
    expect(out).not.toContain("\\*");
    expect(out).not.toContain("\\_");
  });

  test("leaves short plain text intact (no trigger chars, length < 50)", () => {
    const plain = "hello world 123";
    expect(plain.length).toBeLessThan(50);
    expect(escapeMarkdown(plain)).toBe(plain);
  });

  test("empty string returns empty string", () => {
    expect(escapeMarkdown("")).toBe("");
  });

  test("unicode plain short text is untouched", () => {
    const u = "日本語😀";
    expect(escapeMarkdown(u)).toBe(u);
  });

  test("idempotency: bracket-free strings are fixed points", () => {
    const s = "no brackets but *stars* and _under_ here plus padding to exceed fifty chars long!!";
    expect(escapeMarkdown(escapeMarkdown(s))).toBe(escapeMarkdown(s));
  });

  test("50k input does not crash and escapes all brackets", () => {
    const big = "a[".repeat(25000);
    const out = escapeMarkdown(big);
    expect(typeof out).toBe("string");
    expect(out.match(/\\\[/g)!.length).toBe(25000);
    expect(out).toBe("a\\[".repeat(25000));
  });

  test("fuzz: never throws, only mutates brackets", () => {
    for (let i = 0; i < 200; i++) {
      const input = randString(120);
      const out = escapeMarkdown(input);
      expect(typeof out).toBe("string");
      const stripped = out.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
      expect(stripped).toBe(input);
    }
  });
});

const FORMATTERS: Array<[string, (tc: ToolCallInfo[]) => string]> = [
  ["telegram", formatToolCallsForTelegram],
  ["discord", formatToolCallsForDiscord],
  ["plain", formatToolCallsPlain],
];

describe("formatToolCalls (all variants)", () => {
  for (const [label, fn] of FORMATTERS) {
    test(`${label}: empty array returns empty string`, () => {
      expect(fn([])).toBe("");
    });

    test(`${label}: single call output is a string containing the tool name`, () => {
      const out = fn([{ name: "read_file", status: "completed" }]);
      expect(typeof out).toBe("string");
      expect(out).toContain("read_file");
      expect(out).toContain("Tool Execution");
    });

    test(`${label}: many calls all appear in the output`, () => {
      const calls: ToolCallInfo[] = Array.from({ length: 30 }, (_, i) => ({
        name: `tool_${i}`,
        status: i % 2 === 0 ? "completed" : "failed",
      }));
      const out = fn(calls);
      for (const c of calls) expect(out).toContain(c.name);
    });

    test(`${label}: renders status icons for completed/failed/other`, () => {
      const out = fn([
        { name: "a", status: "completed" },
        { name: "b", status: "failed" },
        { name: "c", status: "running" },
      ]);
      expect(out).toContain("✅");
      expect(out).toContain("❌");
      expect(out).toContain("⏳");
    });

    test(`${label}: duration is shown when present, absent otherwise`, () => {
      expect(fn([{ name: "t", status: "completed", duration: 1234 }])).toContain("1234ms");
      expect(fn([{ name: "t", status: "completed" }])).not.toContain("ms");
    });

    test(`${label}: error branch takes precedence and includes error text`, () => {
      const out = fn([{ name: "boom", status: "failed", error: "kaboom", result: "ignored" }]);
      expect(out).toContain("kaboom");
      expect(out).not.toContain("ignored");
    });

    test(`${label}: object result is JSON-stringified`, () => {
      const out = fn([{ name: "t", status: "completed", result: { ok: true, n: 7 } }]);
      expect(out).toContain("ok");
      expect(out).toContain("7");
    });

    test(`${label}: missing optional fields (id/duration/result/error) do not crash`, () => {
      const out = fn([{ name: "bare", status: "" }]);
      expect(typeof out).toBe("string");
      expect(out).toContain("bare");
    });

    test(`${label}: unicode tool names are preserved`, () => {
      const out = fn([{ name: "工具😀", status: "completed" }]);
      expect(out).toContain("工具😀");
    });
  }

  test("telegram wraps tool names in backticks and uses *bold* header", () => {
    const out = formatToolCallsForTelegram([{ name: "grep", status: "completed" }]);
    expect(out).toContain("*Tool Execution:*");
    expect(out).toContain("`grep`");
  });

  test("telegram escapes brackets in long result previews", () => {
    const out = formatToolCallsForTelegram([
      { name: "t", status: "completed", result: "[bracketed]".repeat(10) },
    ]);
    expect(out).toContain("\\[");
  });

  test("telegram italicizes error with underscores", () => {
    const out = formatToolCallsForTelegram([{ name: "t", status: "failed", error: "nope" }]);
    expect(out).toContain("_nope_");
  });

  test("discord uses **bold** header and triple-backtick result block", () => {
    const out = formatToolCallsForDiscord([
      { name: "t", status: "completed", result: "some output" },
    ]);
    expect(out).toContain("**Tool Execution:**");
    expect(out).toContain("```some output```");
  });

  test("discord italicizes error with single asterisks", () => {
    const out = formatToolCallsForDiscord([{ name: "t", status: "failed", error: "nope" }]);
    expect(out).toContain("*nope*");
  });

  test("plain uses no markdown markup around header", () => {
    const out = formatToolCallsPlain([{ name: "grep", status: "completed" }]);
    expect(out).toContain("Tool Execution:");
    expect(out).not.toContain("*Tool Execution*");
    expect(out).not.toContain("`grep`");
    expect(out).toContain("grep");
  });

  test("telegram truncates long results to 80 chars + ellipsis", () => {
    const out = formatToolCallsForTelegram([
      { name: "t", status: "completed", result: "z".repeat(200) },
    ]);
    expect(out).toContain("...");
  });

  test("discord truncates long results to 100 chars + ellipsis", () => {
    const out = formatToolCallsForDiscord([
      { name: "t", status: "completed", result: "z".repeat(200) },
    ]);
    expect(out).toContain("...");
  });

  test("fuzz: 200 seeded random ToolCallInfo arrays never throw across all three formatters", () => {
    for (let i = 0; i < 200; i++) {
      const n = randInt(12);
      const calls = Array.from({ length: n }, () => randToolCall());
      for (const [, fn] of FORMATTERS) {
        const out = fn(calls);
        expect(typeof out).toBe("string");
        if (n === 0) {
          expect(out).toBe("");
        } else {
          expect(out.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
