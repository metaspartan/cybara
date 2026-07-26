import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";

type LoopPolicy = {
  maxIterations?: number;
  maxRuntimeMs?: number;
};

function resolvePolicy(): LoopPolicy {
  const mgr = agentManager as unknown as {
    resolveAgenticLoopPolicy: (ctx?: unknown) => LoopPolicy;
  };
  return mgr.resolveAgenticLoopPolicy(undefined);
}

describe("agentic loop default cap", () => {
  test("applies a finite iteration + runtime cap when nothing is configured", () => {
    const policy = resolvePolicy();
    expect(typeof policy.maxIterations).toBe("number");
    expect(Number.isFinite(policy.maxIterations)).toBe(true);
    expect(policy.maxIterations!).toBeGreaterThan(0);

    expect(typeof policy.maxRuntimeMs).toBe("number");
    expect(Number.isFinite(policy.maxRuntimeMs)).toBe(true);
    expect(policy.maxRuntimeMs!).toBeGreaterThan(0);
  });

  test("the default cap is generous but bounded (won't cut short normal turns, blocks runaway)", () => {
    const policy = resolvePolicy();
    expect(policy.maxIterations!).toBeGreaterThanOrEqual(100);
    expect(policy.maxIterations!).toBeLessThanOrEqual(10000);
    expect(policy.maxRuntimeMs!).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
    expect(policy.maxRuntimeMs!).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});
