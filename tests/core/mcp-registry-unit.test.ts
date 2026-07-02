import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface ServerShape {
  id: string;
  name: string;
  description: string;
  registry: string;
  package: string;
  command: string;
  args?: string;
  envVars?: string[];
  categories?: string[];
  installType: string;
}

interface WorkerReport {
  popularDefault: ServerShape[];
  popularLimited: ServerShape[];
  categories: string[];
  byCategorySearch: string[];
  byCategoryUpper: string[];
  byCategoryMissing: string[];
  detailsGithub: ServerShape | null;
  detailsMissing: boolean;
  registries: Array<{ id: string; name: string; enabled: boolean }>;
  searchGitOfficial: string[];
  searchEmptySmithery: string[];
  searchCaseInsensitive: string[];
  searchDescriptionMatch: string[];
  searchNoMatch: string[];
  searchEmptyNoRegistry: number;
  searchNpmFetchDown: string[];
  fetchCalls: number;
  installKnown: { success: boolean; hasId: boolean; error?: string };
  installCustom: { success: boolean; hasId: boolean; error?: string };
}

// mcp-registry imports mcpManager, which opens the SQLite database under
// CYBARA_HOME at import time, so the whole exercise runs in a child process
// with CYBARA_HOME pointed at a throwaway directory. fetch is replaced with a
// thrower so the npm search path can never touch the network.
const WORKER_SOURCE = `
import { mcpRegistry } from "${join(ROOT_DIR, "src", "core", "mcp-registry.ts").replace(/\\/g, "/")}";

let fetchCalls = 0;
globalThis.fetch = ((..._args: unknown[]) => {
  fetchCalls += 1;
  throw new Error("network disabled in test");
}) as unknown as typeof fetch;

const ids = (servers: Array<{ id: string }>) => servers.map((s) => s.id).sort();

const popularDefault = mcpRegistry.getPopular();
const popularLimited = mcpRegistry.getPopular(3);
const categories = mcpRegistry.getCategories();
const byCategorySearch = ids(mcpRegistry.getByCategory("search"));
const byCategoryUpper = ids(mcpRegistry.getByCategory("SEARCH"));
const byCategoryMissing = ids(mcpRegistry.getByCategory("no-such-category"));
const detailsGithub = mcpRegistry.getDetails("mcp-github") ?? null;
const detailsMissing = mcpRegistry.getDetails("does-not-exist") === undefined;
const registries = mcpRegistry.getRegistries();

const searchGitOfficial = ids(await mcpRegistry.search("git", "official"));
const searchEmptySmithery = ids(await mcpRegistry.search("", "smithery"));
const searchCaseInsensitive = ids(await mcpRegistry.search("  EXA  ", "smithery"));
const searchDescriptionMatch = ids(await mcpRegistry.search("knowledge graph", "official"));
const searchNoMatch = ids(await mcpRegistry.search("zzz-no-such-server", "official"));
const searchEmptyNoRegistry = (await mcpRegistry.search("")).length;
const searchNpmFetchDown = ids(await mcpRegistry.search("filesystem"));

const installKnown = await mcpRegistry.installByPackage("@modelcontextprotocol/server-github");
const installCustom = await mcpRegistry.installByPackage("some-custom-mcp-pkg");

console.log(
  "@@REPORT@@" +
    JSON.stringify({
      popularDefault,
      popularLimited,
      categories,
      byCategorySearch,
      byCategoryUpper,
      byCategoryMissing,
      detailsGithub,
      detailsMissing,
      registries,
      searchGitOfficial,
      searchEmptySmithery,
      searchCaseInsensitive,
      searchDescriptionMatch,
      searchNoMatch,
      searchEmptyNoRegistry,
      searchNpmFetchDown,
      fetchCalls,
      installKnown: {
        success: installKnown.success,
        hasId: typeof installKnown.id === "string" && installKnown.id.length > 0,
        error: installKnown.error,
      },
      installCustom: {
        success: installCustom.success,
        hasId: typeof installCustom.id === "string" && installCustom.id.length > 0,
        error: installCustom.error,
      },
    })
);
`;

let tempHome = "";
let report: WorkerReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-mcpreg-"));
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
      LOG_LEVEL: "error",
    },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`mcp-registry worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((l) => l.startsWith("@@REPORT@@"));
  if (!line) throw new Error(`no report in worker output:\n${stdout}\n${result.stderr.toString()}`);
  report = JSON.parse(line.slice("@@REPORT@@".length)) as WorkerReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("mcpRegistry catalog surface", () => {
  test("getPopular returns the curated list and respects the limit", () => {
    expect(report.popularDefault.length).toBeGreaterThan(10);
    expect(report.popularDefault.length).toBeLessThanOrEqual(20);
    expect(report.popularLimited.length).toBe(3);
    expect(report.popularLimited.map((s) => s.id)).toEqual(
      report.popularDefault.slice(0, 3).map((s) => s.id)
    );
  });

  test("every curated entry is well formed", () => {
    for (const server of report.popularDefault) {
      expect(server.id.length).toBeGreaterThan(0);
      expect(server.name.length).toBeGreaterThan(0);
      expect(server.description.length).toBeGreaterThan(0);
      expect(["smithery", "mcp.so", "npm", "official"]).toContain(server.registry);
      expect(server.command).toBe("bunx");
      expect(["bunx", "bun", "smithery"]).toContain(server.installType);
      expect(server.args).toContain(server.installType === "smithery" ? "@smithery/cli" : server.package);
    }
    const uniqueIds = new Set(report.popularDefault.map((s) => s.id));
    expect(uniqueIds.size).toBe(report.popularDefault.length);
  });

  test("getCategories is sorted and deduplicated", () => {
    expect(report.categories).toEqual([...report.categories].sort());
    expect(new Set(report.categories).size).toBe(report.categories.length);
    expect(report.categories).toContain("search");
    expect(report.categories).toContain("database");
  });

  test("getByCategory matches case-insensitively", () => {
    expect(report.byCategorySearch).toEqual(["mcp-brave-search", "smithery-exa"]);
    expect(report.byCategoryUpper).toEqual(report.byCategorySearch);
    expect(report.byCategoryMissing).toEqual([]);
  });

  test("getDetails returns full metadata or undefined", () => {
    expect(report.detailsGithub?.name).toBe("GitHub");
    expect(report.detailsGithub?.package).toBe("@modelcontextprotocol/server-github");
    expect(report.detailsGithub?.envVars).toEqual(["GITHUB_TOKEN"]);
    expect(report.detailsMissing).toBe(true);
  });

  test("getRegistries lists the four known registries as enabled", () => {
    expect(report.registries.map((r) => r.id).sort()).toEqual([
      "mcp.so",
      "npm",
      "official",
      "smithery",
    ]);
    expect(report.registries.every((r) => r.enabled)).toBe(true);
  });
});

describe("mcpRegistry search", () => {
  test("filters by registry and matches name, package, and categories", () => {
    expect(report.searchGitOfficial).toEqual(["mcp-github", "mcp-gitlab"]);
    expect(report.searchEmptySmithery).toEqual([
      "smithery-browserbase",
      "smithery-exa",
      "smithery-firecrawl",
      "smithery-linear",
      "smithery-notion",
    ]);
  });

  test("query matching is case-insensitive and trimmed", () => {
    expect(report.searchCaseInsensitive).toEqual(["smithery-exa"]);
  });

  test("matches against descriptions too", () => {
    expect(report.searchDescriptionMatch).toEqual(["mcp-memory"]);
  });

  test("unknown query returns empty results", () => {
    expect(report.searchNoMatch).toEqual([]);
  });

  test("empty query without registry returns curated list without npm fetch", () => {
    expect(report.searchEmptyNoRegistry).toBe(report.popularDefault.length);
  });

  test("npm search failure degrades to local matches only", () => {
    expect(report.fetchCalls).toBeGreaterThan(0);
    expect(report.searchNpmFetchDown).toContain("mcp-filesystem");
  });
});

describe("mcpRegistry install", () => {
  test("installByPackage registers a curated server", () => {
    expect(report.installKnown.success).toBe(true);
    expect(report.installKnown.hasId).toBe(true);
  });

  test("installByPackage synthesizes an entry for unknown packages", () => {
    expect(report.installCustom.success).toBe(true);
    expect(report.installCustom.hasId).toBe(true);
  });
});
