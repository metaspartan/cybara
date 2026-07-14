import { describe, expect, test } from "bun:test";
import type { AgenticLoopPolicy, AgenticLoopState } from "../../src/core/agent-internals";
import {
  agenticLoopActiveRuntimeMs,
  agenticLoopClosingPrompt,
  applyAgenticLoopLimitMessage,
  consumeAgenticLoopBudgetWarning,
  createAgenticLoopRuntimeTracker,
  evaluateNoProgressLoop,
  pauseAgenticLoopRuntime,
  resolveAgenticLoopLimit,
  resumeAgenticLoopRuntime,
  updateNoProgressLoopState,
} from "../../src/core/agent-loop-runtime";

const policy: AgenticLoopPolicy = {
  maxIterations: 5,
  maxRuntimeMs: 10_000,
  loopDetectionEnabled: true,
  warningThreshold: 2,
  criticalThreshold: 3,
  globalCircuitBreakerThreshold: 4,
};

function state(): AgenticLoopState {
  return { noProgressStreak: 0, warningBucket: -1 };
}

describe("agent loop runtime", () => {
  test("tracks repeated tool calls and resets after an empty iteration", () => {
    const loopState = state();
    const calls = [{ name: "read", args: { path: "a" }, result: "ok" }];
    expect(updateNoProgressLoopState(loopState, calls)).toBe(1);
    expect(updateNoProgressLoopState(loopState, calls)).toBe(2);
    expect(updateNoProgressLoopState(loopState, [])).toBe(0);
    expect(loopState.previousFingerprint).toBeUndefined();
  });

  test("stops at critical and global no-progress thresholds", () => {
    expect(evaluateNoProgressLoop("test", 3, state(), policy)).toMatchObject({ stop: true });
    expect(evaluateNoProgressLoop("test", 4, state(), policy).message).toContain(
      "global loop circuit breaker"
    );
  });

  test("resolves iteration and runtime limits deterministically", () => {
    expect(resolveAgenticLoopLimit(policy, 5, createAgenticLoopRuntimeTracker(1_000), 2_000)).toBe(
      "maxIterations"
    );
    expect(resolveAgenticLoopLimit(policy, 1, createAgenticLoopRuntimeTracker(1_000), 11_000)).toBe(
      "runtime"
    );
    expect(
      resolveAgenticLoopLimit(policy, 1, createAgenticLoopRuntimeTracker(1_000), 2_000)
    ).toBeUndefined();
  });

  test("does not charge long-running tools against active agent runtime", () => {
    const tracker = createAgenticLoopRuntimeTracker(1_000);
    pauseAgenticLoopRuntime(tracker, 2_000);
    resumeAgenticLoopRuntime(tracker, 32 * 60_000);

    expect(agenticLoopActiveRuntimeMs(tracker, 32 * 60_000 + 8_999)).toBe(9_999);
    expect(resolveAgenticLoopLimit(policy, 1, tracker, 32 * 60_000 + 8_999)).toBeUndefined();
    expect(resolveAgenticLoopLimit(policy, 1, tracker, 32 * 60_000 + 9_000)).toBe("runtime");
  });

  test("counts parallel tool execution as one paused interval", () => {
    const tracker = createAgenticLoopRuntimeTracker(1_000);
    pauseAgenticLoopRuntime(tracker, 2_000);
    pauseAgenticLoopRuntime(tracker, 3_000);
    resumeAgenticLoopRuntime(tracker, 12_000);
    resumeAgenticLoopRuntime(tracker, 22_000);

    expect(agenticLoopActiveRuntimeMs(tracker, 23_000)).toBe(2_000);
  });

  test("keeps partial responses and supplies safe empty-limit messages", () => {
    expect(applyAgenticLoopLimitMessage("test", "maxIterations", policy, "partial")).toBe(
      "partial"
    );
    expect(applyAgenticLoopLimitMessage("test", "runtime", policy, "")).toContain(
      "active agent runtime safety boundary"
    );
  });

  test("warns once at each budget pressure level", () => {
    const tracker = createAgenticLoopRuntimeTracker(1_000);
    expect(consumeAgenticLoopBudgetWarning(policy, 3, tracker, 2_000)).toBeUndefined();
    expect(consumeAgenticLoopBudgetWarning(policy, 4, tracker, 2_000)).toContain(
      "Start consolidating"
    );
    expect(consumeAgenticLoopBudgetWarning(policy, 4, tracker, 2_000)).toBeUndefined();
    expect(consumeAgenticLoopBudgetWarning(policy, 5, tracker, 2_000)).toContain(
      "complete user-facing response"
    );
    expect(consumeAgenticLoopBudgetWarning(policy, 5, tracker, 2_000)).toBeUndefined();
  });

  test("builds a tool-disabled closing instruction for either safety boundary", () => {
    expect(agenticLoopClosingPrompt("maxIterations", policy)).toContain("5 tool iterations");
    expect(agenticLoopClosingPrompt("runtime", policy)).toContain("10s of active agent runtime");
    expect(agenticLoopClosingPrompt("runtime", policy)).toContain("Do not call more tools");
  });
});
