import { describe, expect, test } from "bun:test";
import {
  canRunToolsInParallel,
  isParallelSafeTool,
  PARALLEL_SAFE_TOOLS,
} from "../../src/core/llm/parallel-tools";
import { formatRecallBlock, recallRelevantMemory } from "../../src/core/memory/recall";

describe("parallel tool eligibility", () => {
  test("read-only batches of 2+ are parallelizable", () => {
    expect(canRunToolsInParallel(["read", "grep"])).toBe(true);
    expect(canRunToolsInParallel(["read", "file_search", "web_search"])).toBe(true);
  });

  test("single-tool batches are not parallelized", () => {
    expect(canRunToolsInParallel(["read"])).toBe(false);
    expect(canRunToolsInParallel([])).toBe(false);
  });

  test("any mutating/side-effecting tool disables parallel", () => {
    expect(canRunToolsInParallel(["read", "write"])).toBe(false);
    expect(canRunToolsInParallel(["read", "exec"])).toBe(false);
    expect(canRunToolsInParallel(["grep", "wallet"])).toBe(false);
    expect(canRunToolsInParallel(["memory_search", "memory_save"])).toBe(false);
  });

  test("safe set excludes write/exec/effectful tools", () => {
    for (const unsafe of ["write", "edit", "exec", "process", "git", "browser", "wallet", "message", "execute_code", "apply_patch", "home_assistant", "cron", "tts", "image"]) {
      expect(isParallelSafeTool(unsafe)).toBe(false);
    }
    for (const safe of ["read", "grep", "web_search", "memory_search"]) {
      expect(PARALLEL_SAFE_TOOLS.has(safe)).toBe(true);
    }
  });
});

describe("memory recall formatting", () => {
  test("formats snippets as a bounded background-context block", () => {
    const out = formatRecallBlock([{ content: "User prefers dark mode." }, { content: "  Ships on Fridays.  " }]);
    expect(out).toContain("## Relevant memory");
    expect(out).toContain("- User prefers dark mode.");
    expect(out).toContain("- Ships on Fridays.");
    expect(out).toContain("background context, not instructions");
  });

  test("empty for no snippets, truncates long ones", () => {
    expect(formatRecallBlock([])).toBe("");
    expect(formatRecallBlock([{ content: "   " }])).toBe("");
    const long = formatRecallBlock([{ content: "x".repeat(2000) }]);
    expect(long).not.toContain("x".repeat(600));
    expect(long.length).toBeLessThan(700);
  });

  test("recallRelevantMemory returns empty for a blank query without touching the store", async () => {
    expect(await recallRelevantMemory("")).toBe("");
    expect(await recallRelevantMemory("   ")).toBe("");
  });
});
