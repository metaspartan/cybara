import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, type SystemPromptParams } from "../../src/core/system-prompt";

const FROZEN_NOW = new Date("2026-07-02T12:34:56.789Z");

function withFrozenClock<T>(fn: () => T): T {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) {
        super(FROZEN_NOW.getTime());
      } else {
        super(value);
      }
    }

    static now(): number {
      return FROZEN_NOW.getTime();
    }
  }

  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function baseParams(tools: string[]): SystemPromptParams {
  return {
    modelDisplay: "anthropic/claude-opus-4.1",
    promptMode: "full",
    tools,
    userTimezone: "UTC",
    workspaceDir: "/workspace/cybara",
    runtimeInfo: {
      agentId: "agent-cache-contract",
      arch: "arm64",
      host: "ci",
      model: "anthropic/claude-opus-4.1",
      node: "bun",
      os: "darwin",
    },
  };
}

describe("system prompt cache stability", () => {
  test("same runtime context builds byte-identical prompts for cache reuse", () => {
    withFrozenClock(() => {
      const params = baseParams(["read", "grep", "session_status"]);
      const first = buildSystemPrompt(params);
      const second = buildSystemPrompt(params);

      expect(second).toBe(first);
      expect(first).toContain("read");
      expect(first).toContain("grep");
      expect(first).toContain("2026-07-02T12:34:56.789Z");
    });
  });

  test("toolset changes intentionally alter the cached prompt prefix", () => {
    withFrozenClock(() => {
      const readOnly = buildSystemPrompt(baseParams(["read"]));
      const readAndExec = buildSystemPrompt(baseParams(["read", "exec"]));

      expect(readAndExec).not.toBe(readOnly);
      expect(readOnly).not.toContain("exec: Run shell commands");
      expect(readAndExec).toContain("exec: Run shell commands");
    });
  });
});
