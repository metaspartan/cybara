import { describe, expect, test } from "bun:test";
import {
  createIntelligenceBenchmarkRun,
  gradeIntelligenceBenchmarkTask,
  explainIntelligenceBenchmarkGrade,
  findRunningIntelligenceBenchmark,
  listIntelligenceBenchmarkRuns,
  normalizeBenchmarkAnswer,
  quickIntelligenceTasks,
  updateIntelligenceBenchmarkRun,
} from "../../src/core/agent-eval/benchmark";

describe("quick intelligence benchmark", () => {
  test("uses a small objective suite across distinct capability categories", () => {
    expect(quickIntelligenceTasks).toHaveLength(10);
    expect(new Set(quickIntelligenceTasks.map((task) => task.category)).size).toBeGreaterThan(3);
    expect(quickIntelligenceTasks.filter((task) => task.requiredTool)).toHaveLength(1);
    expect(quickIntelligenceTasks.filter((task) => task.difficulty === "advanced")).toHaveLength(3);
  });

  test("normalizes harmless wrappers while preserving strict answer grading", () => {
    expect(normalizeBenchmarkAnswer(" `CYBARA` \n")).toBe("CYBARA");
    expect(normalizeBenchmarkAnswer("\\frac{2}{5}")).toBe("2/5");
    expect(normalizeBenchmarkAnswer("\\boxed{150}")).toBe("150");
    const task = quickIntelligenceTasks.find((item) => item.id === "instruction-exact");
    if (!task) throw new Error("Instruction benchmark task is missing");
    expect(gradeIntelligenceBenchmarkTask(task, "CYBARA", [])).toBe(true);
    expect(gradeIntelligenceBenchmarkTask(task, "The answer is CYBARA", [])).toBe(false);
  });

  test("requires both the grounded answer and observed tool use", () => {
    const task = quickIntelligenceTasks.find((item) => item.id === "grounded-read");
    if (!task) throw new Error("Grounded benchmark task is missing");
    expect(gradeIntelligenceBenchmarkTask(task, "ORCHID-742", [])).toBe(false);
    expect(gradeIntelligenceBenchmarkTask(task, "ORCHID-742", ["read"])).toBe(true);
    expect(gradeIntelligenceBenchmarkTask(task, "wrong", ["read_file"])).toBe(false);
    expect(explainIntelligenceBenchmarkGrade(task, "ORCHID-742", [])).toContain(
      "required read tool was not observed"
    );
  });

  test("persists partial progress and completion for navigation-safe runs", () => {
    const run = createIntelligenceBenchmarkRun({
      agentId: "benchmark-agent",
      provider: "test-provider",
      model: "test-model",
    });
    expect(run.status).toBe("running");
    expect(run.currentTask).toBe(0);
    expect(findRunningIntelligenceBenchmark()?.id).toBe(run.id);

    const result = {
      taskId: "instruction-exact",
      label: "Exact instruction",
      category: "instruction" as const,
      passed: true,
      score: 100,
      response: "CYBARA",
      expected: "CYBARA",
      difficulty: "basic" as const,
      weight: 1,
      gradingReason: "The normalized answer matched the objective expected value.",
      durationMs: 12,
      toolCalls: [],
      error: null,
    };
    const partial = updateIntelligenceBenchmarkRun(run.id, [result], false);
    expect(partial.status).toBe("running");
    expect(partial.currentTask).toBe(1);

    const completed = updateIntelligenceBenchmarkRun(run.id, [result], true);
    expect(completed.status).toBe("completed");
    expect(completed.score).toBe(100);
    expect(completed.completedAt).not.toBeNull();
    expect(listIntelligenceBenchmarkRuns().some((item) => item.id === run.id)).toBe(true);
  });
});
