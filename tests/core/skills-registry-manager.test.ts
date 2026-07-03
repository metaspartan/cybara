import { describe, expect, test } from "bun:test";
import {
  SkillRegistryManager,
  type RegistrySkill,
  type RegistryListResult,
  type SkillRegistry,
  type RegistryBrowseOptions,
  type RegistrySearchOptions,
  type SkillDownload,
  type RegistrySkillDetails,
} from "../../src/core/skills/registry";

type FakeRegistrySpec = {
  name: string;
  searchResults?: RegistrySkill[];
  listHandler?: (options?: RegistryBrowseOptions) => RegistrySkill[] | RegistryListResult;
  moderation?: { isSuspicious?: boolean; isMalwareBlocked?: boolean };
};

function makeFakeRegistry(spec: FakeRegistrySpec): SkillRegistry {
  return {
    name: spec.name,
    baseUrl: "https://example.invalid",
    async search(_query: string, _options?: RegistrySearchOptions): Promise<RegistrySkill[]> {
      return spec.searchResults ?? [];
    },
    async get(slug: string): Promise<RegistrySkillDetails | null> {
      return {
        slug,
        name: slug,
        description: "fake skill",
        version: "1.0.0",
        moderation: spec.moderation
          ? {
              isSuspicious: spec.moderation.isSuspicious === true,
              isMalwareBlocked: spec.moderation.isMalwareBlocked === true,
            }
          : null,
      };
    },
    async download(slug: string): Promise<SkillDownload> {
      return {
        slug,
        version: "1.0.0",
        files: [{ path: "SKILL.md", content: `# ${slug}\n\nfake` }],
      };
    },
    async list(options?: RegistryBrowseOptions): Promise<RegistrySkill[] | RegistryListResult> {
      return spec.listHandler ? spec.listHandler(options) : [];
    },
  };
}

function createIsolatedManager(
  defaultRegistry: string,
  registries: SkillRegistry[]
): SkillRegistryManager {
  const manager = new SkillRegistryManager(defaultRegistry);
  (manager as unknown as { registries: Map<string, SkillRegistry> }).registries = new Map();
  for (const registry of registries) {
    manager.register(registry);
  }
  return manager;
}

describe("SkillRegistryManager aggregation", () => {
  test("searchAll dedupes by slug using default-registry priority", async () => {
    const alpha = makeFakeRegistry({
      name: "alpha",
      searchResults: [
        { slug: "shared", name: "Alpha Shared", description: "alpha version" },
        { slug: "alpha-only", name: "Alpha Only", description: "alpha only" },
      ],
    });
    const beta = makeFakeRegistry({
      name: "beta",
      searchResults: [
        { slug: "shared", name: "Beta Shared", description: "beta version" },
        { slug: "beta-only", name: "Beta Only", description: "beta only" },
      ],
    });

    const manager = createIsolatedManager("alpha", [alpha, beta]);
    const results = await manager.searchAll("shared");

    expect(results.map((item) => item.slug)).toEqual(["shared", "alpha-only", "beta-only"]);
    expect(results.find((item) => item.slug === "shared")?.name).toBe("Alpha Shared");
    expect(results.find((item) => item.slug === "shared")?.registry).toBe("alpha");
  });

  test("searchAll can return duplicates when dedupe is disabled", async () => {
    const alpha = makeFakeRegistry({
      name: "alpha",
      searchResults: [{ slug: "shared", name: "Alpha Shared", description: "alpha version" }],
    });
    const beta = makeFakeRegistry({
      name: "beta",
      searchResults: [{ slug: "shared", name: "Beta Shared", description: "beta version" }],
    });

    const manager = createIsolatedManager("alpha", [alpha, beta]);
    const results = await manager.searchAll("shared", { dedupe: false });

    expect(results).toHaveLength(2);
    expect(results[0]?.registry).toBe("alpha");
    expect(results[1]?.registry).toBe("beta");
    expect(results[0]?.name).toBe("Alpha Shared");
    expect(results[1]?.name).toBe("Beta Shared");
  });

  test("browseAll pages through updated sort and forwards list options", async () => {
    const seenOptions: RegistryBrowseOptions[] = [];

    const clawhub = makeFakeRegistry({
      name: "clawhub",
      listHandler: (options) => {
        seenOptions.push(options ?? {});

        if (!options?.cursor) {
          return {
            items: [{ slug: "p1", name: "Page 1", description: "first page" }],
            nextCursor: "cursor-2",
          };
        }

        if (options.cursor === "cursor-2") {
          return {
            items: [{ slug: "p2", name: "Page 2", description: "second page" }],
            nextCursor: null,
          };
        }

        return { items: [], nextCursor: null };
      },
    });

    const manager = createIsolatedManager("clawhub", [clawhub]);
    const results = await manager.browseAll({
      sort: "updated",
      limit: 50,
      maxPages: 3,
    });

    expect(results.map((item) => item.slug)).toEqual(["p1", "p2"]);
    expect(seenOptions).toEqual([
      { limit: 50, sort: "updated", cursor: undefined },
      { limit: 50, sort: "updated", cursor: "cursor-2" },
    ]);
  });

  test("install blocks skills flagged as malware", async () => {
    const clawhub = makeFakeRegistry({
      name: "clawhub",
      moderation: { isMalwareBlocked: true },
    });
    const manager = createIsolatedManager("clawhub", [clawhub]);

    const result = await manager.install("dangerous-skill", {
      registry: "clawhub",
      targetDir: "/tmp/cybara-skill-test-malware",
    });

    expect(result.success).toBe(false);
    expect(result.blockedReason).toBe("malware");
    expect(result.error).toContain("VirusTotal");
  });

  test("install requires explicit override for suspicious skills", async () => {
    const clawhub = makeFakeRegistry({
      name: "clawhub",
      moderation: { isSuspicious: true },
    });
    const manager = createIsolatedManager("clawhub", [clawhub]);

    const blocked = await manager.install("suspicious-skill", {
      registry: "clawhub",
      targetDir: "/tmp/cybara-skill-test-suspicious",
      allowSuspicious: false,
    });

    expect(blocked.success).toBe(false);
    expect(blocked.blockedReason).toBe("suspicious");
    expect(blocked.requiresConfirmation).toBe(true);

    const allowed = await manager.install("suspicious-skill", {
      registry: "clawhub",
      targetDir: "/tmp/cybara-skill-test-suspicious-allowed",
      allowSuspicious: true,
    });

    expect(allowed.success).toBe(true);
    expect(typeof allowed.path).toBe("string");
  });
});
