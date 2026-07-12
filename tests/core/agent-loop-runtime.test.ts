import { describe, expect, test } from "bun:test";
import {
  applyAgenticLoopLimitMessage,
  evaluateNoProgressLoop,
  resolveAgenticLoopLimit,
  updateNoProgressLoopState,
} from "../../src/core/agent-loop-runtime";
import type { AgenticLoopPolicy, AgenticLoopState } from "../../src/core/agent-internals";

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
    expect(resolveAgenticLoopLimit(policy, 5, 1_000, 2_000)).toBe("maxIterations");
    expect(resolveAgenticLoopLimit(policy, 1, 1_000, 11_000)).toBe("runtime");
    expect(resolveAgenticLoopLimit(policy, 1, 1_000, 2_000)).toBeUndefined();
  });

  test("keeps partial responses and supplies resumable empty-limit messages", () => {
    expect(applyAgenticLoopLimitMessage("test", "maxIterations", policy, "partial")).toBe(
      "partial"
    );
    expect(applyAgenticLoopLimitMessage("test", "runtime", policy, "")).toContain(
      "Ask me to continue"
    );
  });
});
