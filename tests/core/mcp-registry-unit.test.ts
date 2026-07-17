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
  url?: string;
  envVars?: string[];
  envDefaults?: Record<string, string>;
  categories?: string[];
  homepage?: string;
  installType: string;
}

interface WorkerReport {
  popularDefault: ServerShape[];
  popularLimited: ServerShape[];
  popularAllCount: number;
  categories: string[];
  byCategorySearch: string[];
  byCategoryUpper: string[];
  byCategoryMissing: string[];
  detailsGithub: ServerShape | null;
  detailsBlender: ServerShape | null;
  detailsMissing: boolean;
  registries: Array<{ id: string; name: string; enabled: boolean }>;
  searchGitOfficial: string[];
  searchEmptySmithery: string[];
  searchCaseInsensitive: string[];
  searchDescriptionMatch: string[];
  searchNoMatch: string[];
  searchEmptyNoRegistry: number;
  searchNpmFetchDown: string[];
  searchBlender: string[];
  fetchCalls: number;
  installKnown: { success: boolean; hasId: boolean; error?: string };
  installBlender: {
    success: boolean;
    hasId: boolean;
    command?: string;
    args?: string;
    env?: string;
    error?: string;
  };
  installCustom: { success: boolean; hasId: boolean; error?: string };
  installMalicious: { success: boolean; hasId: boolean; error?: string };
  installValidCustoms: Array<{ name: string; success: boolean; hasId: boolean; error?: string }>;
  installInvalidCustoms: Array<{ name: string; success: boolean; hasId: boolean; error?: string }>;
}

// mcp-registry imports mcpManager, which opens the SQLite database under
// CYBARA_HOME at import time, so the whole exercise runs in a child process
// with CYBARA_HOME pointed at a throwaway directory. fetch is replaced with a
// thrower so the npm search path can never touch the network.
const WORKER_SOURCE = `
import { mcpRegistry } from "${join(ROOT_DIR, "src", "core", "mcp-registry.ts").replace(/\\/g, "/")}";
import { mcpManager } from "${join(ROOT_DIR, "src", "core", "mcp.ts").replace(/\\/g, "/")}";

let fetchCalls = 0;
globalThis.fetch = ((..._args: unknown[]) => {
  fetchCalls += 1;
  throw new Error("network disabled in test");
}) as unknown as typeof fetch;

const ids = (servers: Array<{ id: string }>) => servers.map((s) => s.id).sort();

const popularDefault = mcpRegistry.getPopular();
const popularLimited = mcpRegistry.getPopular(3);
const popularAllCount = mcpRegistry.getPopular(100).length;
const categories = mcpRegistry.getCategories();
const byCategorySearch = ids(mcpRegistry.getByCategory("search"));
const byCategoryUpper = ids(mcpRegistry.getByCategory("SEARCH"));
const byCategoryMissing = ids(mcpRegistry.getByCategory("no-such-category"));
const detailsGithub = mcpRegistry.getDetails("mcp-github") ?? null;
const detailsBlender = mcpRegistry.getDetails("mcp-blender") ?? null;
const detailsMissing = mcpRegistry.getDetails("does-not-exist") === undefined;
const registries = mcpRegistry.getRegistries();

const searchGitOfficial = ids(await mcpRegistry.search("git", "official"));
const searchEmptySmithery = ids(await mcpRegistry.search("", "smithery"));
const searchCaseInsensitive = ids(await mcpRegistry.search("  EXA  ", "smithery"));
const searchDescriptionMatch = ids(await mcpRegistry.search("knowledge graph", "official"));
const searchNoMatch = ids(await mcpRegistry.search("zzz-no-such-server", "official"));
const searchEmptyNoRegistry = (await mcpRegistry.search("")).length;
const searchNpmFetchDown = ids(await mcpRegistry.search("filesystem"));
const searchBlender = ids(await mcpRegistry.search("blender", "mcp.so"));

const installKnown = await mcpRegistry.installByPackage("io.github/github-mcp-server");
const installBlenderResult = await mcpRegistry.installByPackage("blender-mcp");
const installedBlender = installBlenderResult.id
  ? mcpManager.get(installBlenderResult.id)
  : undefined;
const installCustom = await mcpRegistry.installByPackage("some-custom-mcp-pkg");
const installMalicious = await mcpRegistry.installByPackage("safe-name;touch /tmp/cyb-pwned");
const validCustomNames = ["@scope/pkg.name", "pkg_name", "pkg.name-1"];
const invalidCustomNames = [
  "safe && whoami",
  "@scope/pkg;rm",
  "$(touch pwned)",
  "../pkg",
  "pkg name",
  "https://evil.example/pkg",
  "@/missing",
  "@scope/",
  "scope/pkg",
];
const installValidCustoms = [];
for (const name of validCustomNames) {
  const result = await mcpRegistry.installByPackage(name);
  installValidCustoms.push({
    name,
    success: result.success,
    hasId: typeof result.id === "string" && result.id.length > 0,
    error: result.error,
  });
}
const installInvalidCustoms = [];
for (const name of invalidCustomNames) {
  const result = await mcpRegistry.installByPackage(name);
  installInvalidCustoms.push({
    name,
    success: result.success,
    hasId: typeof result.id === "string" && result.id.length > 0,
    error: result.error,
  });
}

console.log(
  "@@REPORT@@" +
    JSON.stringify({
      popularDefault,
      popularLimited,
      popularAllCount,
      categories,
      byCategorySearch,
      byCategoryUpper,
      byCategoryMissing,
      detailsGithub,
      detailsBlender,
      detailsMissing,
      registries,
      searchGitOfficial,
      searchEmptySmithery,
      searchCaseInsensitive,
      searchDescriptionMatch,
      searchNoMatch,
      searchEmptyNoRegistry,
      searchNpmFetchDown,
      searchBlender,
      fetchCalls,
      installKnown: {
        success: installKnown.success,
        hasId: typeof installKnown.id === "string" && installKnown.id.length > 0,
        error: installKnown.error,
      },
      installBlender: {
        success: installBlenderResult.success,
        hasId: typeof installBlenderResult.id === "string" && installBlenderResult.id.length > 0,
        command: installedBlender?.command,
        args: installedBlender?.args,
        env: installedBlender?.env,
        error: installBlenderResult.error,
      },
      installCustom: {
        success: installCustom.success,
        hasId: typeof installCustom.id === "string" && installCustom.id.length > 0,
        error: installCustom.error,
      },
      installMalicious: {
        success: installMalicious.success,
        hasId: typeof installMalicious.id === "string" && installMalicious.id.length > 0,
        error: installMalicious.error,
      },
      installValidCustoms,
      installInvalidCustoms,
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
      expect(["bunx", "bun", "smithery", "remote", "uvx"]).toContain(server.installType);
      if (server.installType === "remote") {
        expect(server.command).toBe("");
        expect(server.url).toStartWith("https://");
      } else if (server.installType === "uvx") {
        expect(server.command).toBe("uvx");
        expect(server.args).toContain(server.package);
      } else {
        expect(server.command).toBe("bunx");
        expect(server.args).toContain(
          server.installType === "smithery" ? "@smithery/cli" : server.package
        );
      }
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
    expect(report.detailsGithub?.package).toBe("io.github/github-mcp-server");
    expect(report.detailsGithub?.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(report.detailsGithub?.installType).toBe("remote");
    expect(report.detailsMissing).toBe(true);
  });

  test("includes community Blender MCP setup metadata", () => {
    expect(report.popularDefault.map((server) => server.id)).toContain("mcp-blender");
    expect(report.detailsBlender).toMatchObject({
      name: "Blender",
      registry: "mcp.so",
      package: "blender-mcp",
      command: "uvx",
      args: "--python 3.11 blender-mcp",
      installType: "uvx",
      homepage: "https://github.com/ahujasid/blender-mcp",
      envDefaults: {
        DISABLE_TELEMETRY: "true",
        UV_PYTHON_PREFERENCE: "only-managed",
      },
    });
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
    expect(report.searchEmptyNoRegistry).toBe(report.popularAllCount);
  });

  test("npm search failure degrades to local matches only", () => {
    expect(report.fetchCalls).toBeGreaterThan(0);
    expect(report.searchNpmFetchDown).toContain("mcp-filesystem");
  });

  test("finds Blender from the curated community catalog without network access", () => {
    expect(report.searchBlender).toEqual(["mcp-blender"]);
  });
});

describe("mcpRegistry install", () => {
  test("installByPackage registers a curated server", () => {
    expect(report.installKnown.success).toBe(true);
    expect(report.installKnown.hasId).toBe(true);
  });

  test("installs Blender with uvx and privacy defaults", () => {
    expect(report.installBlender).toMatchObject({
      success: true,
      hasId: true,
      command: "uvx",
      args: "--python 3.11 blender-mcp",
    });
    expect(report.installBlender.env).toContain("DISABLE_TELEMETRY=true");
    expect(report.installBlender.env).toContain("UV_PYTHON_PREFERENCE=only-managed");
  });

  test("installByPackage synthesizes an entry for unknown packages", () => {
    expect(report.installCustom.success).toBe(true);
    expect(report.installCustom.hasId).toBe(true);
  });

  test("installByPackage rejects custom package names with shell metacharacters", () => {
    expect(report.installMalicious.success).toBe(false);
    expect(report.installMalicious.hasId).toBe(false);
    expect(report.installMalicious.error).toContain("Invalid MCP package name");
  });

  test("installByPackage accepts npm-shaped custom names and rejects command-shaped names", () => {
    expect(report.installValidCustoms).toHaveLength(3);
    for (const result of report.installValidCustoms) {
      expect(result.success).toBe(true);
      expect(result.hasId).toBe(true);
      expect(result.error).toBeUndefined();
    }

    expect(report.installInvalidCustoms).toHaveLength(9);
    for (const result of report.installInvalidCustoms) {
      expect(result.success).toBe(false);
      expect(result.hasId).toBe(false);
      expect(result.error).toContain("Invalid MCP package name");
    }
  });
});
