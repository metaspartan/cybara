import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  listInstalledPlugins,
  loadPluginFromRoot,
  validatePluginAtPath,
} from "../../src/core/plugins";
import { clearSkillsCache } from "../../src/core/skills";
import { loadAllSkills } from "../../src/core/skills/loader";
import { handleSkillLoad } from "../../src/core/tools/handlers/skill";

const root = join(process.cwd(), "plugins", "huggingface-workflows");
const expectedSkills = [
  "hf-cli",
  "huggingface-community-evals",
  "huggingface-datasets",
  "huggingface-gradio",
  "huggingface-jobs",
  "huggingface-llm-trainer",
  "huggingface-paper-publisher",
  "huggingface-papers",
  "huggingface-trackio",
  "huggingface-vision-trainer",
  "transformers-js",
];
const temporaryHomes: string[] = [];

afterAll(() => {
  clearSkillsCache();
  for (const home of temporaryHomes) rmSync(home, { recursive: true, force: true });
});

async function withIsolatedPluginState<T>(operation: () => Promise<T>): Promise<T> {
  const previousCybaraHome = process.env.CYBARA_HOME;
  const cybaraHome = mkdtempSync(join(tmpdir(), "cybara-huggingface-plugin-"));
  temporaryHomes.push(cybaraHome);
  process.env.CYBARA_HOME = cybaraHome;
  clearSkillsCache();
  try {
    return await operation();
  } finally {
    clearSkillsCache();
    if (previousCybaraHome === undefined) delete process.env.CYBARA_HOME;
    else process.env.CYBARA_HOME = previousCybaraHome;
  }
}

describe("Hugging Face workflows plugin", () => {
  test("ships a valid bundled plugin with the complete skill set", () => {
    const validation = validatePluginAtPath(root);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const plugin = loadPluginFromRoot(root, "bundled");
    expect(plugin).not.toBeNull();
    expect(plugin?.manifest.id).toBe("huggingface-workflows");
    expect(plugin?.skillNames).toEqual(expectedSkills);
  });

  test("uses Cybara-safe commands and substantive instructions", () => {
    for (const skillName of expectedSkills) {
      const content = readFileSync(join(root, "skills", skillName, "SKILL.md"), "utf8");
      expect(content.length).toBeGreaterThan(600);
      expect(content).not.toMatch(/\b(?:npm|npx|pnpm|yarn)\b/);
    }

    const jobs = readFileSync(join(root, "skills", "huggingface-jobs", "SKILL.md"), "utf8");
    const trainer = readFileSync(
      join(root, "skills", "huggingface-llm-trainer", "SKILL.md"),
      "utf8"
    );
    const datasets = readFileSync(join(root, "skills", "huggingface-datasets", "SKILL.md"), "utf8");
    const transformers = readFileSync(join(root, "skills", "transformers-js", "SKILL.md"), "utf8");

    expect(jobs).toContain("obtain confirmation before starting paid compute");
    expect(trainer).toContain("Before launching paid compute");
    expect(readFileSync(join(root, "skills", "hf-cli", "SKILL.md"), "utf8")).toContain(
      "Do not use the deprecated `huggingface-cli` command"
    );
    expect(datasets).toContain("https://datasets-server.huggingface.co");
    expect(datasets).toContain("Cybara's `http` tool");
    expect(transformers).toContain("bun add @huggingface/transformers");
  });

  test("discovers and loads plugin skills for agents", async () => {
    await withIsolatedPluginState(async () => {
      const installed = listInstalledPlugins().find(
        (plugin) => plugin.manifest.id === "huggingface-workflows"
      );
      expect(installed?.source).toBe("bundled");
      expect(installed?.enabled).toBe(true);
      expect(installed?.skillNames).toEqual(expectedSkills);

      const loaded = await loadAllSkills({ workspaceDir: process.cwd() });
      const pluginSkills = loaded
        .filter((entry) => entry.plugin?.id === "huggingface-workflows")
        .map((entry) => entry.skill.name)
        .sort();
      expect(pluginSkills).toEqual(expectedSkills);

      const result = (await handleSkillLoad(
        { name: "huggingface-datasets" },
        { agentId: "huggingface-test", workspaceDir: process.cwd() }
      )) as Record<string, unknown>;
      expect(result.name).toBe("huggingface-datasets");
      expect(result.source).toBe("plugin");
      expect(result.instructions).toContain("Dataset Viewer API");
    });
  });
});
