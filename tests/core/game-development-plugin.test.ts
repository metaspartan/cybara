import { describe, expect, test } from "bun:test";
import { join } from "path";

import { listInstalledPlugins, validatePluginAtPath } from "../../src/core/plugins";
import { clearSkillsCache, loadAllSkills } from "../../src/core/skills";

const pluginRoot = join(process.cwd(), "plugins", "game-development");
const expectedSkills = [
  "bevy",
  "game-asset-pipeline",
  "game-development",
  "game-networking",
  "game-playtesting",
  "game-ui",
  "godot",
  "sprite-pipeline",
  "unity",
  "unreal-engine",
  "web-game-development",
];

describe("bundled game development plugin", () => {
  test("ships a valid enabled plugin with the complete engine workflow set", () => {
    const validation = validatePluginAtPath(pluginRoot);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toEqual([]);

    const plugin = listInstalledPlugins().find((entry) => entry.manifest.id === "game-development");
    expect(plugin).toBeDefined();
    expect(plugin?.source).toBe("bundled");
    expect(plugin?.enabled).toBe(true);
    expect(plugin?.skillNames).toEqual(expectedSkills);
  });

  test("loads every game skill through plugin metadata with substantive instructions", async () => {
    clearSkillsCache();
    const loaded = await loadAllSkills({});
    const gameSkills = loaded.filter((entry) => entry.plugin?.id === "game-development");

    expect(gameSkills.map((entry) => entry.skill.name).sort()).toEqual(expectedSkills);
    for (const entry of gameSkills) {
      expect(entry.skill.description.length).toBeGreaterThan(80);
      const instructions = entry.skill.instructions;
      expect(instructions.length).toBeGreaterThan(900);
      expect(instructions).toContain("Verification");
    }
  });

  test("keeps JavaScript engine instructions on the Bun toolchain", async () => {
    const webSkill = await Bun.file(
      join(pluginRoot, "skills", "web-game-development", "SKILL.md")
    ).text();
    expect(webSkill).toContain("Use Bun for dependency and script commands");
    expect(webSkill).not.toMatch(/\b(?:npm|npx|pnpm|yarn)\b/);
  });
});
