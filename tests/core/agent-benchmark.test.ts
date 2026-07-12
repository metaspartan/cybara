import { describe, expect, test } from "bun:test";
import {
  cancelIntelligenceBenchmarkRun,
  computeIntelligenceRating,
  createIntelligenceBenchmarkRun,
  deleteIntelligenceBenchmarkRun,
  expectedPassProbability,
  explainIntelligenceBenchmarkGrade,
  findRunningIntelligenceBenchmark,
  gradeIntelligenceBenchmarkTask,
  intelligenceRatingManifest,
  intelligenceRatingTasks,
  intelligenceRatingTier,
  INTELLIGENCE_RATING_EDGE_MARGIN,
  INTELLIGENCE_RATING_SUITE_ID,
  isIntelligenceBenchmarkCancelRequested,
  listIntelligenceBenchmarkRuns,
  normalizeBenchmarkAnswer,
  requestIntelligenceBenchmarkCancel,
  updateIntelligenceBenchmarkRun,
} from "../../src/core/agent-eval/benchmark";

function expectedAnswer(taskId: string): string {
  const task = intelligenceRatingTasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task ${taskId} is missing`);
  return task.expected;
}

function josephus(n: number, k: number): number {
  let survivor = 0;
  for (let i = 2; i <= n; i += 1) survivor = (survivor + k) % i;
  return survivor + 1;
}

function lisLength(values: number[]): number {
  const tails: number[] = [];
  for (const value of values) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
  }
  return tails.length;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...(Array(b.length).fill(0) as number[]),
  ]);
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function powMod(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function derangements(n: number): bigint {
  let a = 1n;
  let b = 0n;
  if (n === 0) return 1n;
  if (n === 1) return 0n;
  for (let i = 2; i <= n; i += 1) {
    const next = BigInt(i - 1) * (a + b);
    a = b;
    b = next;
  }
  return b;
}

function partitions(n: number): number {
  const p = Array(n + 1).fill(0) as number[];
  p[0] = 1;
  for (let i = 1; i <= n; i += 1) {
    for (let j = i; j <= n; j += 1) p[j] += p[j - i];
  }
  return p[n];
}

function factorial(n: number): bigint {
  let f = 1n;
  for (let i = 2n; i <= BigInt(n); i += 1n) f *= i;
  return f;
}

function trailingZeros(n: number): number {
  let count = 0;
  for (let p = 5; p <= n; p *= 5) count += Math.floor(n / p);
  return count;
}

describe("cybara intelligence rating suite", () => {
  test("covers a wide calibrated difficulty range across distinct categories", () => {
    expect(intelligenceRatingTasks.length).toBeGreaterThanOrEqual(32);
    expect(new Set(intelligenceRatingTasks.map((task) => task.id)).size).toBe(
      intelligenceRatingTasks.length
    );
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
    expect(frontier).toBe(
      Math.max(...intelligenceRatingTasks.map((task) => task.rating)) +
        INTELLIGENCE_RATING_EDGE_MARGIN
    );
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

  test("frontier task answers match independent recomputation", () => {
    expect(expectedAnswer("josephus-survivor")).toBe(String(josephus(41, 3)));
    expect(expectedAnswer("lis-length")).toBe(
      String(lisLength([8, 3, 11, 6, 14, 2, 17, 9, 20, 5, 23, 12, 26, 1, 29]))
    );
    expect(expectedAnswer("edit-distance")).toBe(String(levenshtein("intention", "execution")));
    expect(expectedAnswer("matrix-determinant")).toBe(
      String(2 * (1 * 3 - 5 * 2) - 3 * (4 * 3 - 5 * 6) + 1 * (4 * 2 - 1 * 6))
    );
    expect(expectedAnswer("modpow-large")).toBe(powMod(2n, 100n, 1001n).toString());
    expect(expectedAnswer("digit-count-power")).toBe(String((2n ** 333n).toString().length));
    expect(expectedAnswer("derangements")).toBe(derangements(7).toString());
    expect(expectedAnswer("partitions-20")).toBe(String(partitions(20)));
    expect(expectedAnswer("factorial-digit-sum")).toBe(
      String(
        factorial(100)
          .toString()
          .split("")
          .reduce((total, digit) => total + Number(digit), 0)
      )
    );
    const target = Number(expectedAnswer("factorial-zeros-inverse"));
    expect(trailingZeros(target)).toBeGreaterThanOrEqual(100);
    expect(trailingZeros(target - 1)).toBeLessThan(100);
    expect(expectedAnswer("domino-tiling")).toBe("89");
    expect(expectedAnswer("catalan-number")).toBe("16796");
  });

  test("frontier models are separated instead of all capping at the ceiling", () => {
    const passesUpTo = (ceiling: number) =>
      computeIntelligenceRating(
        intelligenceRatingTasks.map((task) => ({
          rating: task.rating,
          passed: task.rating <= ceiling,
        }))
      );
    const strongFrontier = passesUpTo(3400);
    const midFrontier = passesUpTo(3100);
    const weakFrontier = passesUpTo(2800);
    expect(strongFrontier).toBeGreaterThan(midFrontier);
    expect(midFrontier).toBeGreaterThan(weakFrontier);
    expect(weakFrontier).toBeGreaterThan(2500);
    const maxRating = Math.max(...intelligenceRatingTasks.map((task) => task.rating));
    expect(maxRating).toBeGreaterThanOrEqual(3650);
    expect(strongFrontier).toBeLessThan(maxRating + INTELLIGENCE_RATING_EDGE_MARGIN);
  });

  test("cancel requests stop a run with partial results and allow deletion", () => {
    const run = createIntelligenceBenchmarkRun({ agentId: "cancel-agent" });
    expect(requestIntelligenceBenchmarkCancel(run.id)?.id).toBe(run.id);
    expect(isIntelligenceBenchmarkCancelRequested(run.id)).toBe(true);
    expect(requestIntelligenceBenchmarkCancel("missing-run")).toBeNull();

    expect(deleteIntelligenceBenchmarkRun(run.id)).toBe(false);

    const cancelled = cancelIntelligenceBenchmarkRun(run.id, [
      {
        taskId: "instruction-exact",
        label: "Exact instruction",
        category: "instruction",
        passed: true,
        score: 100,
        rating: 850,
        response: "CYBARA",
        expected: "CYBARA",
        difficulty: "basic",
        weight: 1,
        gradingReason: "The normalized answer matched the objective expected value.",
        durationMs: 10,
        toolCalls: [],
        error: null,
      },
    ]);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.results).toHaveLength(1);
    expect(isIntelligenceBenchmarkCancelRequested(run.id)).toBe(false);

    expect(deleteIntelligenceBenchmarkRun(run.id)).toBe(true);
    expect(listIntelligenceBenchmarkRuns().some((item) => item.id === run.id)).toBe(false);
    expect(deleteIntelligenceBenchmarkRun(run.id)).toBe(false);
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
    expect(manifest.taskCount).toBe(intelligenceRatingTasks.length);
    expect(manifest.scoring.method).toBe("rasch-elo-mle");
    expect(manifest.tasks).toHaveLength(intelligenceRatingTasks.length);
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
