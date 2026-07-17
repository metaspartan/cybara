import { afterEach, describe, expect, test } from "bun:test";
import { parseAgentConfig } from "../../src/core/agent-internals";
import { config } from "../../src/core/config";
import { tables, type Agent, type Provider } from "../../src/core/database";
import {
  createProviderAccountPool,
  deleteProviderAccountPool,
  listProviderAccountPools,
  markProviderAccountUnavailable,
  providerAccountCooldownUntil,
  providerAccountPoolCandidates,
  providerAccountRemainingPercent,
  removeProviderFromAccountPools,
  resetProviderAccountPoolsForTests,
  updateProviderAccountPool,
} from "../../src/core/provider-account-pool";

const createdAgentIds: string[] = [];

function provider(id: string, providerType: string): Provider {
  return {
    id,
    provider: providerType,
    name: id,
    is_default: false,
  };
}

afterEach(() => {
  for (const agentId of createdAgentIds.splice(0)) tables.agents.delete(agentId);
  resetProviderAccountPoolsForTests();
});

function agentForPool(poolId: string, providerId: string): Agent {
  const agent: Agent = {
    id: crypto.randomUUID(),
    name: `Agent ${poolId}`,
    provider_id: providerId,
    config: { provider_account_pool_id: poolId, retained: true },
    status: "stopped",
    memory_enabled: false,
  };
  tables.agents.create(agent);
  createdAgentIds.push(agent.id);
  return agent;
}

function storedAgentConfig(agentId: string): Record<string, unknown> {
  const stored = tables.agents.get(agentId) as Agent | undefined;
  return parseAgentConfig(stored?.config, agentId);
}

describe("provider account pools", () => {
  test("keeps accounts isolated until a named pool includes them", () => {
    const primary = provider("primary", "openai-codex");
    const backup = provider("backup", "openai-codex");

    expect(
      providerAccountPoolCandidates(undefined, primary, [primary, backup]).map((item) => item.id)
    ).toEqual(["primary"]);

    const pool = createProviderAccountPool(
      {
        name: "Codex plans",
        provider: "openai-codex",
        accounts: [
          { providerId: primary.id, priority: 20 },
          { providerId: backup.id, priority: 10 },
        ],
      },
      [primary, backup]
    );

    expect(
      providerAccountPoolCandidates(pool.id, primary, [primary, backup]).map((item) => item.id)
    ).toEqual(["backup", "primary"]);
  });

  test("supports multiple pools for one provider without crossing membership", () => {
    const first = provider("first", "openai-codex");
    const second = provider("second", "openai-codex");
    const third = provider("third", "openai-codex");
    const work = createProviderAccountPool(
      {
        name: "Work",
        provider: "openai-codex",
        accounts: [{ providerId: first.id }, { providerId: second.id }],
      },
      [first, second, third]
    );
    const personal = createProviderAccountPool(
      {
        name: "Personal",
        provider: "openai-codex",
        accounts: [{ providerId: third.id }],
      },
      [first, second, third]
    );

    expect(
      providerAccountPoolCandidates(work.id, first, [first, second, third]).map((item) => item.id)
    ).toEqual(["first", "second"]);
    expect(
      providerAccountPoolCandidates(personal.id, third, [first, second, third]).map(
        (item) => item.id
      )
    ).toEqual(["third"]);
  });

  test("rejects cross-provider and duplicate pool membership", () => {
    const codex = provider("codex", "openai-codex");
    const zai = provider("zai", "z.ai-coding");
    expect(() =>
      createProviderAccountPool(
        {
          name: "Invalid",
          provider: "openai-codex",
          accounts: [{ providerId: zai.id }],
        },
        [codex, zai]
      )
    ).toThrow("selected provider type");
    createProviderAccountPool(
      {
        name: "First",
        provider: "openai-codex",
        accounts: [{ providerId: codex.id }],
      },
      [codex, zai]
    );
    expect(() =>
      createProviderAccountPool(
        {
          name: "Second",
          provider: "openai-codex",
          accounts: [{ providerId: codex.id }],
        },
        [codex, zai]
      )
    ).toThrow("only one pool");
  });

  test("updates, disables, removes accounts, and deletes pools", () => {
    const primary = provider("primary", "z.ai-coding");
    const backup = provider("backup", "z.ai-coding");
    const pool = createProviderAccountPool(
      {
        name: "Zai plans",
        provider: "z.ai-coding",
        accounts: [{ providerId: primary.id }],
      },
      [primary, backup]
    );
    const updated = updateProviderAccountPool(
      pool.id,
      {
        name: "Zai plans",
        provider: "z.ai-coding",
        enabled: false,
        accounts: [{ providerId: primary.id }, { providerId: backup.id }],
      },
      [primary, backup]
    );
    expect(updated?.enabled).toBe(false);
    expect(
      providerAccountPoolCandidates(pool.id, primary, [primary, backup]).map((item) => item.id)
    ).toEqual([]);
    removeProviderFromAccountPools(backup.id);
    expect(listProviderAccountPools()[0]?.accounts).toEqual([{ providerId: primary.id }]);
    expect(deleteProviderAccountPool(pool.id)).toBe(true);
    expect(listProviderAccountPools()).toEqual([]);
  });

  test("detaches agents when pools are deleted or lose their last account", () => {
    const first = provider("first", "openai-codex");
    const second = provider("second", "openai-codex");
    const deletedPool = createProviderAccountPool(
      {
        name: "Deleted Pool",
        provider: "openai-codex",
        accounts: [{ providerId: first.id }],
      },
      [first, second]
    );
    const emptiedPool = createProviderAccountPool(
      {
        name: "Emptied Pool",
        provider: "openai-codex",
        accounts: [{ providerId: second.id }],
      },
      [first, second]
    );
    const deletedPoolAgent = agentForPool(deletedPool.id, first.id);
    const emptiedPoolAgent = agentForPool(emptiedPool.id, second.id);

    expect(deleteProviderAccountPool(deletedPool.id)).toBe(true);
    removeProviderFromAccountPools(second.id);

    expect(storedAgentConfig(deletedPoolAgent.id)).toEqual({ retained: true });
    expect(storedAgentConfig(emptiedPoolAgent.id)).toEqual({ retained: true });
    expect(listProviderAccountPools()).toEqual([]);
  });

  test("skips exhausted accounts until their failure cooldown expires", () => {
    const primary = provider("primary", "z.ai-coding");
    const backup = provider("backup", "z.ai-coding");
    const pool = createProviderAccountPool(
      {
        name: "Zai plans",
        provider: "z.ai-coding",
        accounts: [
          { providerId: primary.id, priority: 10 },
          { providerId: backup.id, priority: 20 },
        ],
      },
      [primary, backup]
    );
    const now = Date.now();
    markProviderAccountUnavailable(primary.id, "rate_limit", now);

    expect(providerAccountCooldownUntil(primary.id)).toBeGreaterThan(now);
    expect(
      providerAccountPoolCandidates(pool.id, primary, [primary, backup], now + 1_000).map(
        (item) => item.id
      )
    ).toEqual(["backup"]);
    expect(
      providerAccountPoolCandidates(pool.id, primary, [primary, backup], now + 3_601_000).map(
        (item) => item.id
      )
    ).toEqual(["primary", "backup"]);
  });

  test("uses tracked remaining usage when no priority override is set", () => {
    const primary = provider("primary", "openai-codex");
    const backup = provider("backup", "openai-codex");
    const pool = createProviderAccountPool(
      {
        name: "Codex plans",
        provider: "openai-codex",
        accounts: [{ providerId: primary.id }, { providerId: backup.id }],
      },
      [primary, backup]
    );

    expect(
      providerAccountPoolCandidates(
        pool.id,
        primary,
        [primary, backup],
        Date.now(),
        new Map([
          [primary.id, 15],
          [backup.id, 80],
        ])
      ).map((item) => item.id)
    ).toEqual(["backup", "primary"]);
  });

  test("migrates the former default priority to automatic usage balancing", () => {
    config.set("provider_account_pools", [
      {
        id: "legacy-pool",
        name: "Legacy plans",
        provider: "openai-codex",
        enabled: true,
        accounts: [
          { providerId: "primary", priority: 100 },
          { providerId: "backup", priority: 100 },
        ],
      },
    ]);

    expect(listProviderAccountPools()[0]?.accounts).toEqual([
      { providerId: "primary" },
      { providerId: "backup" },
    ]);
  });

  test("keeps explicit priorities ahead of automatic usage ordering", () => {
    const primary = provider("primary", "openai-codex");
    const backup = provider("backup", "openai-codex");
    const pool = createProviderAccountPool(
      {
        name: "Codex plans",
        provider: "openai-codex",
        accounts: [{ providerId: primary.id, priority: 20 }, { providerId: backup.id }],
      },
      [primary, backup]
    );

    expect(
      providerAccountPoolCandidates(
        pool.id,
        primary,
        [primary, backup],
        Date.now(),
        new Map([
          [primary.id, 5],
          [backup.id, 95],
        ])
      ).map((item) => item.id)
    ).toEqual(["primary", "backup"]);
  });

  test("uses the lowest finite plan window as remaining account capacity", () => {
    expect(
      providerAccountRemainingPercent({
        source: "oauth_api",
        fetchedAt: Date.now(),
        fiveHour: { usedPercent: 20 },
        weekly: { usedPercent: 70 },
        monthly: { usedPercent: 0, unlimited: true },
      })
    ).toBe(30);
    expect(
      providerAccountRemainingPercent({
        source: "oauth_api",
        fetchedAt: Date.now(),
        fiveHour: { usedPercent: 0, unlimited: true },
        weekly: { usedPercent: 0, unlimited: true },
      })
    ).toBe(100);
    expect(providerAccountRemainingPercent(null)).toBeUndefined();
  });
});
