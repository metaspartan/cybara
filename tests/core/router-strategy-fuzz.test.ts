import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  getMixtureOfAgentsRoutingConfig,
  isMixtureOfAgentsRoutingActive,
  normalizeRouterStrategy,
  resetRouterForTests,
} from "../../src/core/router";

const VALID_STRATEGIES = ["weighted", "round_robin", "lowest_cost", "priority", "mixture_of_agents"];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x0dd5eed);

function randInt(max: number): number {
  return Math.floor(rand() * max);
}

const POOL = "abcXYZ_-. /\\{}$%'\"0123456789😀";

function randomString(maxLen: number): string {
  const len = randInt(maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += POOL[randInt(POOL.length)];
  return out;
}

function randomJsonValue(depth = 0): unknown {
  const pick = randInt(depth > 2 ? 5 : 7);
  switch (pick) {
    case 0: return randomString(30);
    case 1: return randInt(2_000_000) - 1_000_000;
    case 2: return rand() > 0.5;
    case 3: return null;
    case 4: return rand() * 1e15 - 5e14;
    case 5: return Array.from({ length: randInt(6) }, () => randomJsonValue(depth + 1));
    default: {
      const obj: Record<string, unknown> = {};
      const keys = ["enabled", "strategy", "routes", "moaMaxAgents", "moaAggregatorAgentId", "fallbackToAny", "globalSpendLimitDaily", randomString(8)];
      const count = randInt(keys.length);
      for (let i = 0; i < count; i++) obj[keys[randInt(keys.length)]] = randomJsonValue(depth + 1);
      return obj;
    }
  }
}

afterEach(() => {
  resetRouterForTests();
  config.set("router", null);
});

describe("normalizeRouterStrategy fuzz", () => {
  test("valid strategies pass through unchanged", () => {
    for (const strategy of VALID_STRATEGIES) {
      expect(normalizeRouterStrategy(strategy)).toBe(strategy);
    }
  });

  test("any junk input maps to one of the five valid strategies", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      "",
      "WEIGHTED",
      "weighted ",
      " priority",
      "mixture-of-agents",
      "mixture_of_agents\0",
      42,
      NaN,
      true,
      ["weighted"],
      { strategy: "priority" },
      Symbol("weighted"),
      "toString",
      "__proto__",
      "a".repeat(100_000),
    ];
    for (let i = 0; i < 500; i++) inputs.push(randomString(40));

    for (const input of inputs) {
      const strategy = normalizeRouterStrategy(input);
      expect(VALID_STRATEGIES).toContain(strategy);
      if (typeof input !== "string" || !VALID_STRATEGIES.includes(input)) {
        expect(strategy).toBe("weighted");
      }
    }
  });
});

describe("router config fuzz via config.set", () => {
  const GARBAGE_CONFIGS: unknown[] = [
    null,
    "",
    "mixture_of_agents",
    42,
    -1,
    true,
    [],
    [1, 2, 3],
    {},
    { enabled: "yes" },
    { enabled: 1, strategy: 7 },
    { enabled: true, strategy: "mixture_of_agents" },
    { enabled: true, strategy: "mixture_of_agents", moaMaxAgents: -5 },
    { enabled: true, strategy: "mixture_of_agents", moaMaxAgents: 2.9, moaAggregatorAgentId: 12 },
    { enabled: true, strategy: ["mixture_of_agents"], routes: "not-an-object" },
    { enabled: { nested: true }, strategy: null, routes: null },
    { routes: { openai: "junk", anthropic: null } },
  ];

  test("fixed garbage shapes never make the MoA accessors throw", () => {
    for (const garbage of GARBAGE_CONFIGS) {
      config.set("router", garbage);
      const active = isMixtureOfAgentsRoutingActive();
      expect(typeof active).toBe("boolean");
      const moa = getMixtureOfAgentsRoutingConfig();
      expect(typeof moa).toBe("object");
      if (moa.maxAgents !== undefined) {
        expect(typeof moa.maxAgents).toBe("number");
        expect(moa.maxAgents).toBeGreaterThan(0);
        expect(Number.isInteger(moa.maxAgents)).toBe(true);
      }
      if (moa.aggregatorAgentId !== undefined) {
        expect(typeof moa.aggregatorAgentId).toBe("string");
      }
    }
  });

  test("random garbage shapes never make the MoA accessors throw", () => {
    for (let i = 0; i < 200; i++) {
      config.set("router", randomJsonValue());
      expect(() => isMixtureOfAgentsRoutingActive()).not.toThrow();
      const moa = getMixtureOfAgentsRoutingConfig();
      if (moa.maxAgents !== undefined) {
        expect(moa.maxAgents).toBeGreaterThan(0);
      }
    }
  });

  test("MoA is active only for an enabled mixture_of_agents config", () => {
    config.set("router", { enabled: true, strategy: "mixture_of_agents", fallbackToAny: true, routes: {} });
    expect(isMixtureOfAgentsRoutingActive()).toBe(true);
    config.set("router", { enabled: "true", strategy: "mixture_of_agents", fallbackToAny: true, routes: {} });
    const active = isMixtureOfAgentsRoutingActive();
    expect(typeof active).toBe("boolean");
  });
});
