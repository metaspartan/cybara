import { describe, expect, test } from "bun:test";
import type { AgenticLoopPolicy, AgenticLoopState } from "../../src/core/agent-internals";
import { resolveAgenticLoopPolicyFromConfig } from "../../src/core/agent-loop-policy";
import {
  agenticLoopActiveRuntimeMs,
  agenticLoopClosingPrompt,
  applyAgenticLoopLimitMessage,
  consumeAgenticLoopBudgetWarning,
  createAgenticLoopRuntimeTracker,
  evaluateNoProgressLoop,
  pauseAgenticLoopRuntime,
  requestedDeliverableMaterializationPrompt,
  resolveInspectionToolRoundTokenLimit,
  resolveRequestedDeliverableFinalContent,
  resolveRequestedDeliverableToolChoice,
  resolveAgenticLoopLimit,
  resumeAgenticLoopRuntime,
  toolsAfterMaterializationCheckpoint,
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

  test("honors per-execution camel-case iteration overrides", () => {
    const resolved = resolveAgenticLoopPolicyFromConfig({
      agentConfig: {},
      env: {},
      modelParams: { maxToolIterations: 12 },
    });

    expect(resolved.maxIterations).toBe(12);
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
    expect(consumeAgenticLoopBudgetWarning(policy, 3, tracker, 2_000)).toContain(
      "create a valid version now"
    );
    expect(consumeAgenticLoopBudgetWarning(policy, 4, tracker, 2_000)).toContain(
      "Start consolidating"
    );
    expect(consumeAgenticLoopBudgetWarning(policy, 4, tracker, 2_000)).toBeUndefined();
    expect(consumeAgenticLoopBudgetWarning(policy, 5, tracker, 2_000)).toContain(
      "complete user-facing response"
    );
    expect(consumeAgenticLoopBudgetWarning(policy, 5, tracker, 2_000)).toBeUndefined();
  });

  test("checkpoints long inspection loops before the configured budget is nearly spent", () => {
    const tracker = createAgenticLoopRuntimeTracker(1_000);
    expect(consumeAgenticLoopBudgetWarning(policy, 3, tracker, 2_000)).toContain(
      "create a valid version now"
    );
    expect(consumeAgenticLoopBudgetWarning(policy, 5, tracker, 2_000)).toContain(
      "complete user-facing response"
    );
  });

  test("requires materialization after four inspection iterations and restores all tools after it", () => {
    const tools = [{ name: "read" }, { name: "grep" }, { name: "write" }, { name: "edit" }];
    expect(toolsAfterMaterializationCheckpoint(tools, 0, false)).toEqual(tools);
    expect(toolsAfterMaterializationCheckpoint(tools, 1, false)).toEqual([
      { name: "write" },
      { name: "edit" },
    ]);
    expect(toolsAfterMaterializationCheckpoint(tools, 3, false, true)).toEqual([
      { name: "read" },
      { name: "grep" },
    ]);
    expect(toolsAfterMaterializationCheckpoint(tools, 4, false, true)).toEqual([
      { name: "write" },
      { name: "edit" },
    ]);
    expect(toolsAfterMaterializationCheckpoint(tools, 5, true, true)).toEqual(tools);
    expect(toolsAfterMaterializationCheckpoint(tools, 8, false)).toEqual([
      { name: "write" },
      { name: "edit" },
    ]);
    expect(toolsAfterMaterializationCheckpoint(tools, 8, true)).toEqual([]);
    expect(requestedDeliverableMaterializationPrompt(["output/report.md"])).toContain("exact path");
    expect(requestedDeliverableMaterializationPrompt(["output/report.md"])).toContain(
      "output/report.md"
    );
    expect(requestedDeliverableMaterializationPrompt(["report.md"], true)).toContain(
      "do not claim inspection or read access was unavailable"
    );
  });

  test("finishes a successful requested file without another provider round trip", () => {
    expect(resolveRequestedDeliverableFinalContent("", ["output/report.md"], true)).toBe(
      "Completed and saved the requested deliverable: output/report.md."
    );
    expect(resolveRequestedDeliverableFinalContent("Finished.", ["output/report.md"], true)).toBe(
      "Finished."
    );
    expect(resolveRequestedDeliverableFinalContent("", ["output/report.md"], false)).toBe("");
  });

  test("requires a mutation tool for ordinary deliverables while preserving evidence inspection", () => {
    const mutationTools = [{ name: "write" }, { name: "edit" }];
    expect(resolveRequestedDeliverableToolChoice(mutationTools, true, false)).toBe("required");
    expect(resolveRequestedDeliverableToolChoice(mutationTools, true, true)).toBe("auto");
    expect(resolveRequestedDeliverableToolChoice(mutationTools, false, false)).toBe("auto");
    expect(resolveRequestedDeliverableToolChoice([{ name: "read" }], true, false)).toBe("auto");
  });

  test("bounds inspection output without reducing artifact-generation capacity", () => {
    expect(resolveInspectionToolRoundTokenLimit(16_384, true)).toBe(2048);
    expect(resolveInspectionToolRoundTokenLimit(1024, true)).toBe(1024);
    expect(resolveInspectionToolRoundTokenLimit(16_384, false)).toBe(16_384);
  });

  test("builds a tool-disabled closing instruction for either safety boundary", () => {
    expect(agenticLoopClosingPrompt("maxIterations", policy)).toContain("5 tool iterations");
    expect(agenticLoopClosingPrompt("runtime", policy)).toContain("10s of active agent runtime");
    expect(agenticLoopClosingPrompt("runtime", policy)).toContain("Do not call more tools");
  });
});
