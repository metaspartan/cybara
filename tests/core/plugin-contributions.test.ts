import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadPluginFromRoot, validatePluginAtPath } from "../../src/core/plugins";
import {
  activatePluginRuntime,
  deactivatePluginRuntime,
  listPluginChannelContributions,
  listPluginCommands,
  listPluginProviderContributions,
} from "../../src/core/plugins/runtime";
import { executeTool, hasTool } from "../../src/core/tools/handlers";

const roots: string[] = [];
const pluginIds: string[] = [];

afterEach(() => {
  for (const pluginId of pluginIds.splice(0)) deactivatePluginRuntime(pluginId);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createPlugin(): { root: string; pluginId: string } {
  const pluginId = `contributions-${crypto.randomUUID()}`;
  const root = join(tmpdir(), pluginId);
  roots.push(root);
  pluginIds.push(pluginId);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "tool.ts"),
    "const input = await Bun.stdin.json(); console.log(JSON.stringify({ echoed: input.args.value }));"
  );
  writeFileSync(
    join(root, "tools.json"),
    JSON.stringify({
      name: "echo",
      description: "Echo a test value",
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      command: ["bun", "tool.ts"],
    })
  );
  writeFileSync(
    join(root, "commands.json"),
    JSON.stringify({ id: "plugin-check", description: "Check a plugin", prompt: "Check it" })
  );
  writeFileSync(
    join(root, "providers.json"),
    JSON.stringify({
      id: "local-models",
      name: "Local Models",
      baseUrl: "http://127.0.0.1:9900/v1",
      api: "openai-compatible",
      authType: "none",
      models: ["test-model"],
    })
  );
  writeFileSync(
    join(root, "channels.json"),
    JSON.stringify({
      id: "notifications",
      name: "Notifications",
      transport: "webhook",
      description: "Test notifications",
    })
  );
  writeFileSync(
    join(root, "cybara-plugin.json"),
    JSON.stringify({
      id: pluginId,
      name: "Contribution Test",
      version: "1.0.0",
      description: "Exercises plugin contributions",
      contributions: {
        skills: { dirs: [] },
        tools: { files: ["tools.json"] },
        commands: { files: ["commands.json"] },
        providers: { files: ["providers.json"] },
        channels: { files: ["channels.json"] },
      },
    })
  );
  return { root, pluginId };
}

describe("plugin contributions", () => {
  test("validates and activates tools, commands, providers, and channels", async () => {
    const { root, pluginId } = createPlugin();
    const validation = validatePluginAtPath(root);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.contributions?.tools?.files).toEqual(["tools.json"]);

    const plugin = loadPluginFromRoot(root, "local");
    expect(plugin).not.toBeNull();
    if (!plugin) throw new Error("Plugin failed to load");
    activatePluginRuntime({ ...plugin, enabled: true });

    const toolName = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_")}_echo`;
    expect(hasTool(toolName)).toBe(true);
    expect(
      await executeTool(
        toolName,
        { value: "working" },
        { agentId: "test", allowDangerousTools: true }
      )
    ).toEqual({
      echoed: "working",
    });
    expect(listPluginCommands().some((entry) => entry.id === "plugin-check")).toBe(true);
    expect(listPluginProviderContributions().some((entry) => entry.id === "local-models")).toBe(
      true
    );
    expect(listPluginChannelContributions().some((entry) => entry.id === "notifications")).toBe(
      true
    );

    deactivatePluginRuntime(pluginId);
    expect(hasTool(toolName)).toBe(false);
  });

  test("rejects escaped and non-JSON contribution files", () => {
    const { root } = createPlugin();
    writeFileSync(
      join(root, "cybara-plugin.json"),
      JSON.stringify({
        id: "unsafe-contributions",
        name: "Unsafe",
        version: "1.0.0",
        description: "Unsafe paths",
        contributions: { tools: { files: ["../outside.json", "tool.ts"] } },
      })
    );
    const validation = validatePluginAtPath(root);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.contributions?.tools?.files).toEqual([]);
    expect(validation.warnings.join(" ")).toContain("outside plugin root");
    expect(validation.warnings.join(" ")).toContain("must be JSON");
  });
});
