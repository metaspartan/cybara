import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, type SystemPromptParams } from "../../src/core/system-prompt";

const FROZEN_NOW = new Date("2026-07-02T12:34:56.789Z");

function withFrozenClock<T>(now: Date, fn: () => T): T {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (value === undefined) {
        super(now.getTime());
      } else {
        super(value);
      }
    }

    static now(): number {
      return now.getTime();
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
    withFrozenClock(FROZEN_NOW, () => {
      const params = baseParams(["read", "grep", "session_status"]);
      const first = buildSystemPrompt(params);
      const second = buildSystemPrompt(params);

      expect(second).toBe(first);
      expect(first).toContain("read");
      expect(first).toContain("grep");
      expect(first).toContain("Thursday, 2026-07-02 (UTC)");
      expect(first).not.toContain("12:34:56");
    });
  });

  test("second-level clock changes do not invalidate the prompt prefix", () => {
    const params = baseParams(["read", "grep", "session_status"]);
    const first = withFrozenClock(new Date("2026-07-02T12:00:01.000Z"), () =>
      buildSystemPrompt(params)
    );
    const second = withFrozenClock(new Date("2026-07-02T23:59:59.000Z"), () =>
      buildSystemPrompt(params)
    );

    expect(second).toBe(first);
  });

  test("toolset changes intentionally alter the cached prompt prefix", () => {
    withFrozenClock(FROZEN_NOW, () => {
      const readOnly = buildSystemPrompt(baseParams(["read"]));
      const readAndExec = buildSystemPrompt(baseParams(["read", "exec"]));

      expect(readAndExec).not.toBe(readOnly);
      expect(readOnly).toContain("Available tools: read");
      expect(readAndExec).toContain("Available tools: read, exec");
    });
  });
});
