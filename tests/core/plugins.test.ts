import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  installLocalPluginFromPath,
  listInstalledPlugins,
  uninstallLocalPlugin,
  validatePluginAtPath,
} from "../../src/core/plugins";
import { loadAllSkills } from "../../src/core/skills";

function writePlugin(rootDir: string, manifest: Record<string, unknown>, skillName: string): void {
  mkdirSync(join(rootDir, "skills", "example-skill"), { recursive: true });
  writeFileSync(
    join(rootDir, "cybara-plugin.json"),
    JSON.stringify(manifest, null, 2)
  );
  writeFileSync(
    join(rootDir, "skills", "example-skill", "SKILL.md"),
    `---
name: ${skillName}
description: ${skillName} description
---

# ${skillName}

Use this plugin skill.
`
  );
}

const tempRoots: string[] = [];

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("plugin runtime", () => {
  test("validates, installs, prefers workspace overrides, and exposes plugin skills", async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalCybaraHome = process.env.CYBARA_HOME;
    const tempRoot = mkdtempSync(join(tmpdir(), "cybara-plugin-test-"));
    tempRoots.push(tempRoot);

    const fakeHome = join(tempRoot, "home");
    const fakeCybaraHome = join(fakeHome, ".cybara");
    const workspaceDir = join(tempRoot, "workspace");
    const sourcePluginDir = join(tempRoot, "source-plugin");
    const workspacePluginDir = join(workspaceDir, "plugins", "acme-plugin");
    mkdirSync(fakeHome, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });

    writePlugin(
      sourcePluginDir,
      {
        id: "acme-plugin",
        name: "Acme Plugin",
        version: "1.0.0",
        description: "Example local plugin",
        contributions: {
          skills: {
            dirs: ["skills"],
          },
        },
      },
      "Local Plugin Skill"
    );

    writePlugin(
      workspacePluginDir,
      {
        id: "acme-plugin",
        name: "Acme Plugin Workspace",
        version: "2.0.0",
        description: "Workspace override plugin",
        contributions: {
          skills: {
            dirs: ["skills"],
          },
        },
      },
      "Workspace Plugin Skill"
    );

    const brokenPluginDir = join(tempRoot, "broken-plugin");
    mkdirSync(brokenPluginDir, { recursive: true });
    writeFileSync(
      join(brokenPluginDir, "cybara-plugin.json"),
      JSON.stringify({ id: "", name: "", version: "abc" }, null, 2)
    );

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.CYBARA_HOME = fakeCybaraHome;

    try {
      const valid = validatePluginAtPath(sourcePluginDir);
      expect(valid.valid).toBe(true);
      expect(valid.manifest?.id).toBe("acme-plugin");
      expect(valid.manifest?.contributions?.skills?.dirs).toEqual(["skills"]);

      const invalid = validatePluginAtPath(brokenPluginDir);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.join(" ")).toContain("valid id");
      expect(invalid.errors.join(" ")).toContain("name");
      expect(invalid.errors.join(" ")).toContain("semver-like version");

      const escapedSkillDir = join(tempRoot, "escaped-skill-dir");
      mkdirSync(join(escapedSkillDir, "stealth-skill"), { recursive: true });
      writeFileSync(
        join(escapedSkillDir, "stealth-skill", "SKILL.md"),
        "# Escaped Skill\n\nThis should not load.\n"
      );
      const unsafePluginDir = join(tempRoot, "unsafe-plugin");
      mkdirSync(unsafePluginDir, { recursive: true });
      writeFileSync(
        join(unsafePluginDir, "cybara-plugin.json"),
        JSON.stringify(
          {
            id: "unsafe-plugin",
            name: "Unsafe Plugin",
            version: "1.0.0",
            description: "Plugin with escaped skill path",
            contributions: {
              skills: {
                dirs: ["skills-link"],
              },
            },
          },
          null,
          2
        )
      );
      symlinkSync(escapedSkillDir, join(unsafePluginDir, "skills-link"));

      const unsafe = validatePluginAtPath(unsafePluginDir);
      expect(unsafe.valid).toBe(true);
      expect(unsafe.warnings.join(" ")).toContain("symlinked contribution path outside plugin root");
      expect(unsafe.manifest?.contributions?.skills?.dirs).toEqual([]);

      const installed = installLocalPluginFromPath(sourcePluginDir);
      expect(installed.source).toBe("local");
      expect(installed.manifest.version).toBe("1.0.0");

      const plugins = listInstalledPlugins({ workspaceDir });
      const acme = plugins.find((plugin) => plugin.manifest.id === "acme-plugin");
      expect(acme).toBeDefined();
      expect(acme?.source).toBe("workspace");
      expect(acme?.manifest.version).toBe("2.0.0");

      const skills = await loadAllSkills({ workspaceDir });
      const workspaceSkill = skills.find((entry) => entry.skill.name === "Workspace Plugin Skill");
      expect(workspaceSkill).toBeDefined();
      expect(workspaceSkill?.source).toBe("plugin");
      expect(workspaceSkill?.plugin).toEqual({
        id: "acme-plugin",
        name: "Acme Plugin Workspace",
        version: "2.0.0",
        source: "workspace",
      });

      expect(uninstallLocalPlugin("acme-plugin")).toBe(true);
      expect(uninstallLocalPlugin("acme-plugin")).toBe(false);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalCybaraHome === undefined) delete process.env.CYBARA_HOME;
      else process.env.CYBARA_HOME = originalCybaraHome;
    }
  });
});
