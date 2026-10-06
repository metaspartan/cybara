import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgenticLoopLimitState,
  describeAgenticLoopLimit,
  recordAgenticLoopLimit,
} from "../../src/core/agent-loop-limit-state";
import { applyAgenticLoopLimitMessage } from "../../src/core/agent-loop-runtime";
import { resolveAgenticLoopPolicyFromConfig } from "../../src/core/agent-loop-policy";
import { resolveAgenticLoopLimit } from "../../src/core/agent-loop-runtime";
import {
  markRunCompleted,
  registerSubagentRun,
  resetSubagentRegistryForTests,
  getRun,
} from "../../src/core/subagent-registry";
import {
  DEFAULT_AGENTIC_MAX_ITERATIONS,
  MAX_AGENTIC_CONFIGURED_ITERATIONS,
} from "../../src/core/agent-internals";
import { toolSchemas } from "../../src/core/tools/registry";

const root = join(import.meta.dir, "..", "..");
const readSource = (relative: string): string => readFileSync(join(root, relative), "utf8");

describe("subagent tool budget", () => {
  test("a run that hits the loop boundary is recorded as truncated, not plain success", () => {
    resetSubagentRegistryForTests();
    const run = registerSubagentRun({
      runId: "budget-run",
      childSessionKey: "agent:a:subagent:b",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "read every file",
      cleanup: "keep",
    });
    markRunCompleted(run.runId, "partial answer", { limitReason: "maxIterations" });
    const stored = getRun(run.runId);
    expect(stored?.outcome?.status).toBe("ok");
    expect(stored?.outcome?.limitReason).toBe("maxIterations");

    const clean = registerSubagentRun({
      runId: "budget-run-clean",
      childSessionKey: "agent:a:subagent:c",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "read every file",
      cleanup: "keep",
    });
    markRunCompleted(clean.runId, "all done");
    expect(getRun(clean.runId)?.outcome?.limitReason).toBeUndefined();
    resetSubagentRegistryForTests();
  });

  test("applyAgenticLoopLimitMessage records the reason on the per-run state", () => {
    const state = createAgenticLoopLimitState();
    const policy = resolveAgenticLoopPolicyFromConfig({
      agentConfig: {},
      modelParams: {},
      limitState: state,
    });
    applyAgenticLoopLimitMessage("openai", "maxIterations", policy, "done-ish");
    expect(state.limitReason).toBe("maxIterations");
    expect(describeAgenticLoopLimit(state, policy.maxIterations)).toBe(
      "tool-iteration boundary (300)"
    );
  });

  test("an untruncated run leaves the state untouched", () => {
    const state = createAgenticLoopLimitState();
    const policy = resolveAgenticLoopPolicyFromConfig({
      agentConfig: {},
      modelParams: {},
      limitState: state,
    });
    expect(
      resolveAgenticLoopLimit(policy, 3, {
        activeToolCount: 0,
        budgetWarningLevel: 0,
        checkpointWarned: false,
        pausedMs: 0,
        startedAt: Date.now(),
      })
    ).toBeUndefined();
    expect(state.limitReason).toBeUndefined();
    expect(describeAgenticLoopLimit(state, policy.maxIterations)).toBeUndefined();
  });

  test("the first recorded reason wins", () => {
    const state = createAgenticLoopLimitState();
    recordAgenticLoopLimit(state, "maxIterations");
    recordAgenticLoopLimit(state, "runtime");
    expect(state.limitReason).toBe("maxIterations");
  });

  test("delegation guidance no longer imposes a fixed small child budget", () => {
    const mentions = readSource("src/core/chat/capability-mentions.ts");
    const bots = readSource("src/api/bot-routes.ts");
    expect(mentions).not.toContain("maxToolIterations 12");
    expect(bots).not.toContain("maxToolIterations 12");
    expect(mentions).toContain("omitting it gives the child the standard budget");
    expect(bots).toContain("omitting it gives the child the standard budget");
  });

  test("sessions_wait reports a budget-truncated child as partial", () => {
    const channel = readSource("src/core/tools/handlers/channel.ts");
    expect(channel).toContain('run.outcome.limitReason ? "partial" : "completed"');
    expect(channel).toContain("limitReason: run.outcome.limitReason");
  });

  test("an explicit child budget is not clamped below the platform ceiling", () => {
    const channel = readSource("src/core/tools/handlers/channel.ts");
    expect(channel).toContain("MAX_AGENTIC_CONFIGURED_ITERATIONS");
    expect(channel).not.toContain("Math.min(requestedMaxToolIterations, 100)");
  });

  test("the advertised maxToolIterations range matches the real clamp", () => {
    const schema = toolSchemas.sessions_spawn.input_schema.properties.maxToolIterations as {
      description?: string;
    };
    const advertised = /\((\d+)-(\d+)\)/.exec(schema.description ?? "");
    expect(advertised).not.toBeNull();
    expect(Number(advertised?.[2])).toBe(MAX_AGENTIC_CONFIGURED_ITERATIONS);
    expect(Number(advertised?.[1])).toBe(1);
  });

  test("omitting maxToolIterations yields the standard budget, never an unlimited one", () => {
    const policy = resolveAgenticLoopPolicyFromConfig({
      agentConfig: {},
      env: {},
      modelParams: {},
    });
    expect(policy.maxIterations).toBe(DEFAULT_AGENTIC_MAX_ITERATIONS);
    expect(typeof policy.maxIterations).toBe("number");
    expect(policy.maxIterations).toBeLessThan(MAX_AGENTIC_CONFIGURED_ITERATIONS);
  });
});
