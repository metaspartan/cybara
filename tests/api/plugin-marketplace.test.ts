import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  marketplacePluginId,
  parsePluginMarketplace,
  prepareMarketplacePluginRoot,
  type MarketplacePluginEntry,
} from "../../src/api/plugin-marketplace";
import { installLocalPluginFromPath, listInstalledPlugins } from "../../src/core/plugins";

const originalCybaraHome = process.env.CYBARA_HOME;
const tempRoots: string[] = [];

afterEach(() => {
  if (originalCybaraHome === undefined) delete process.env.CYBARA_HOME;
  else process.env.CYBARA_HOME = originalCybaraHome;
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cybara-plugin-marketplace-"));
  tempRoots.push(root);
  return root;
}

describe("plugin marketplace", () => {
  test("parses plugin bundles and rejects malformed or unsupported sources", () => {
    const parsed = parsePluginMarketplace({
      plugins: [
        {
          name: "workflow-kit",
          displayName: "Workflow Kit",
          description: "A complete plugin bundle.",
          author: { name: "Example" },
          category: "development",
          source: "./plugins/workflow-kit",
          commands: ["./commands"],
          mcpServers: { example: { command: "example" } },
        },
        { name: "missing-source", description: "Invalid" },
        {
          name: "unsupported-source",
          description: "Invalid",
          source: { source: "npm", package: "example" },
        },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      name: "workflow-kit",
      displayName: "Workflow Kit",
      category: "development",
      source: "./plugins/workflow-kit",
      commands: ["./commands"],
    });
  });

  test("normalizes marketplace plugin identifiers without path escapes", () => {
    for (const name of ["../../outside", " Plugin Name ", "vendor\\plugin", "%2e%2e/plugin"]) {
      const id = marketplacePluginId(name);
      expect(id).toMatch(/^marketplace-official-community-[a-z0-9._-]+$/);
      expect(id).not.toContain("/");
      expect(id).not.toContain("\\");
    }
    expect(() => marketplacePluginId("///")).toThrow();
  });

  test("installs an actual plugin bundle while adapting command prompts for the runtime", () => {
    const root = makeTempRoot();
    process.env.CYBARA_HOME = join(root, ".cybara");
    const sourceRoot = join(root, "source");
    const stagingRoot = join(root, "staging");
    mkdirSync(join(sourceRoot, ".claude-plugin"), { recursive: true });
    mkdirSync(join(sourceRoot, "skills", "review"), { recursive: true });
    mkdirSync(join(sourceRoot, "commands"), { recursive: true });
    mkdirSync(join(sourceRoot, "hooks"), { recursive: true });
    writeFileSync(
      join(sourceRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "workflow-kit", version: "2.1.0" })
    );
    writeFileSync(
      join(sourceRoot, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review code.\n---\n\nReview carefully.\n"
    );
    writeFileSync(join(sourceRoot, "commands", "ship.md"), "Prepare and ship the release.\n");
    writeFileSync(join(sourceRoot, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
    writeFileSync(
      join(sourceRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { example: { command: "example" } } })
    );
    const entry: MarketplacePluginEntry = {
      name: "workflow-kit",
      displayName: "Workflow Kit",
      description: "A complete plugin bundle.",
      version: "2.1.0",
      author: { name: "Example" },
      source: "./plugins/workflow-kit",
    };

    const id = prepareMarketplacePluginRoot(sourceRoot, stagingRoot, entry);
    expect(id).toBe("marketplace-official-community-workflow-kit");
    expect(existsSync(join(stagingRoot, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(stagingRoot, "hooks", "hooks.json"))).toBe(true);
    expect(existsSync(join(stagingRoot, ".mcp.json"))).toBe(true);
    expect(readFileSync(join(stagingRoot, "skills", "ship", "SKILL.md"), "utf8")).toContain(
      "Prepare and ship the release."
    );

    const installed = installLocalPluginFromPath(stagingRoot);
    expect(installed.manifest.id).toBe(id);
    expect(installed.skillNames).toEqual(["review", "ship"]);
    expect(listInstalledPlugins().some((plugin) => plugin.manifest.id === id)).toBe(true);
  });
});
