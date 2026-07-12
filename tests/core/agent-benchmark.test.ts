import { describe, expect, test } from "bun:test";
import {
  computeIntelligenceRating,
  createIntelligenceBenchmarkRun,
  expectedPassProbability,
  explainIntelligenceBenchmarkGrade,
  findRunningIntelligenceBenchmark,
  gradeIntelligenceBenchmarkTask,
  intelligenceRatingManifest,
  intelligenceRatingTasks,
  intelligenceRatingTier,
  INTELLIGENCE_RATING_SUITE_ID,
  listIntelligenceBenchmarkRuns,
  normalizeBenchmarkAnswer,
  updateIntelligenceBenchmarkRun,
} from "../../src/core/agent-eval/benchmark";

describe("cybara intelligence rating suite", () => {
  test("covers a wide calibrated difficulty range across distinct categories", () => {
    expect(intelligenceRatingTasks).toHaveLength(32);
    expect(new Set(intelligenceRatingTasks.map((task) => task.id)).size).toBe(32);
    expect(new Set(intelligenceRatingTasks.map((task) => task.category)).size).toBe(5);
    expect(intelligenceRatingTasks.filter((task) => task.requiredTool)).toHaveLength(2);
    const ratings = intelligenceRatingTasks.map((task) => task.rating);
    expect(Math.min(...ratings)).toBeLessThan(1000);
    expect(Math.max(...ratings)).toBeGreaterThanOrEqual(3000);
    expect(intelligenceRatingTasks.filter((task) => task.rating >= 2800).length).toBeGreaterThan(2);
  });

  test("normalizes harmless wrappers while preserving strict answer grading", () => {
    expect(normalizeBenchmarkAnswer(" `CYBARA` \n")).toBe("CYBARA");
    expect(normalizeBenchmarkAnswer("\\frac{2}{5}")).toBe("2/5");
    expect(normalizeBenchmarkAnswer("\\boxed{150}")).toBe("150");
    const task = intelligenceRatingTasks.find((item) => item.id === "instruction-exact");
    if (!task) throw new Error("Instruction benchmark task is missing");
    expect(gradeIntelligenceBenchmarkTask(task, "CYBARA", [])).toBe(true);
    expect(gradeIntelligenceBenchmarkTask(task, "The answer is CYBARA", [])).toBe(false);
  });

  test("requires both the grounded answer and observed tool use", () => {
    const task = intelligenceRatingTasks.find((item) => item.id === "grounded-read");
    if (!task) throw new Error("Grounded benchmark task is missing");
    expect(gradeIntelligenceBenchmarkTask(task, "ORCHID-742", [])).toBe(false);
    expect(gradeIntelligenceBenchmarkTask(task, "ORCHID-742", ["read"])).toBe(true);
    expect(gradeIntelligenceBenchmarkTask(task, "wrong", ["read_file"])).toBe(false);
    expect(explainIntelligenceBenchmarkGrade(task, "ORCHID-742", [])).toContain(
      "required read tool was not observed"
    );
  });

  test("rating follows the logistic model and is deterministic", () => {
    expect(expectedPassProbability(1500, 1500)).toBeCloseTo(0.5, 10);
    expect(expectedPassProbability(1500, 1900)).toBeCloseTo(1 / (1 + 10 ** -1), 10);
    const results = intelligenceRatingTasks.map((task) => ({
      rating: task.rating,
      passed: task.rating <= 1500,
    }));
    const first = computeIntelligenceRating(results);
    const second = computeIntelligenceRating(results);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(1300);
    expect(first).toBeLessThan(1800);
  });

  test("a mid model rates near 1500 and a frontier model near 3000+", () => {
    const mid = computeIntelligenceRating(
      intelligenceRatingTasks.map((task) => ({ rating: task.rating, passed: task.rating <= 1600 }))
    );
    expect(mid).toBeGreaterThanOrEqual(1400);
    expect(mid).toBeLessThanOrEqual(1900);
    const frontier = computeIntelligenceRating(
      intelligenceRatingTasks.map((task) => ({ rating: task.rating, passed: true }))
    );
    expect(frontier).toBe(3500);
    const floor = computeIntelligenceRating(
      intelligenceRatingTasks.map((task) => ({ rating: task.rating, passed: false }))
    );
    expect(floor).toBe(450);
    expect(computeIntelligenceRating([])).toBe(0);
  });

  test("rating increases monotonically with more passes", () => {
    const sorted = [...intelligenceRatingTasks].sort((left, right) => left.rating - right.rating);
    let previous = 0;
    for (let passCount = 1; passCount <= sorted.length; passCount += 1) {
      const rating = computeIntelligenceRating(
        sorted.map((task, index) => ({ rating: task.rating, passed: index < passCount }))
      );
      expect(rating).toBeGreaterThan(previous);
      previous = rating;
    }
  });

  test("maps ratings to stable tier labels", () => {
    expect(intelligenceRatingTier(900)).toBe("Emerging");
    expect(intelligenceRatingTier(1500)).toBe("Capable");
    expect(intelligenceRatingTier(2000)).toBe("Advanced");
    expect(intelligenceRatingTier(2400)).toBe("Expert");
    expect(intelligenceRatingTier(2900)).toBe("Frontier");
    expect(intelligenceRatingTier(3200)).toBe("Superhuman");
  });

  test("publishes a reproducibility manifest with task checksums", () => {
    const manifest = intelligenceRatingManifest() as {
      suiteId: string;
      taskCount: number;
      scoring: { method: string };
      tasks: Array<{ id: string; expected: string; sha256: string }>;
    };
    expect(manifest.suiteId).toBe(INTELLIGENCE_RATING_SUITE_ID);
    expect(manifest.taskCount).toBe(32);
    expect(manifest.scoring.method).toBe("rasch-elo-mle");
    expect(manifest.tasks).toHaveLength(32);
    for (const task of manifest.tasks) {
      expect(task.expected.length).toBeGreaterThan(0);
      expect(task.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("persists rating-scored progress for navigation-safe runs", () => {
    const run = createIntelligenceBenchmarkRun({
      agentId: "benchmark-agent",
      provider: "test-provider",
      model: "test-model",
    });
    expect(run.status).toBe("running");
    expect(run.suiteId).toBe(INTELLIGENCE_RATING_SUITE_ID);
    expect(findRunningIntelligenceBenchmark()?.id).toBe(run.id);

    const passResult = {
      taskId: "instruction-exact",
      label: "Exact instruction",
      category: "instruction" as const,
      passed: true,
      score: 100,
      rating: 850,
      response: "CYBARA",
      expected: "CYBARA",
      difficulty: "basic" as const,
      weight: 1,
      gradingReason: "The normalized answer matched the objective expected value.",
      durationMs: 12,
      toolCalls: [],
      error: null,
    };
    const failResult = {
      ...passResult,
      taskId: "constrained-digits",
      label: "Constraint satisfaction",
      category: "reasoning" as const,
      passed: false,
      score: 0,
      rating: 3100,
      response: "0",
      expected: "864",
      difficulty: "frontier" as const,
      weight: 5,
    };
    const partial = updateIntelligenceBenchmarkRun(run.id, [passResult], false);
    expect(partial.status).toBe("running");
    expect(partial.currentTask).toBe(1);

    const completed = updateIntelligenceBenchmarkRun(run.id, [passResult, failResult], true);
    expect(completed.status).toBe("completed");
    expect(completed.score).toBeGreaterThan(850);
    expect(completed.score).toBeLessThan(3100);
    expect(completed.completedAt).not.toBeNull();
    expect(listIntelligenceBenchmarkRuns().some((item) => item.id === run.id)).toBe(true);
  });
});
