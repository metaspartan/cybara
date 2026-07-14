import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  installPluginFromPayload,
  installLocalPluginFromPath,
  getBuiltinPluginCatalog,
  listInstalledPlugins,
  MAX_PLUGIN_EXPANDED_BYTES,
  parsePluginInstallPayload,
  setPluginEnabled,
  uninstallLocalPlugin,
  validatePluginArchiveEntries,
  validatePluginAtPath,
  validatePluginInstallPayload,
} from "../../src/core/plugins";
import { clearSkillsCache, loadAllSkills } from "../../src/core/skills";
import { getBuiltinSkillPacks } from "../../src/core/skills/builtin-packs";

function writePlugin(rootDir: string, manifest: Record<string, unknown>, skillName: string): void {
  mkdirSync(join(rootDir, "skills", "example-skill"), { recursive: true });
  writeFileSync(join(rootDir, "cybara-plugin.json"), JSON.stringify(manifest, null, 2));
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

function zipCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries: Array<{ path: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const content = Buffer.from(entry.content);
    const crc = zipCrc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("plugin runtime", () => {
  test("built-in catalog covers every embedded skill exactly once", () => {
    const catalogNames = getBuiltinPluginCatalog()
      .flatMap((plugin) => plugin.skillNames)
      .sort();
    const embeddedNames = getBuiltinSkillPacks()
      .map((entry) => entry.skill.name)
      .sort();
    expect(catalogNames).toEqual(embeddedNames);
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
  });

  test("built-in plugins persist enablement and control embedded skill loading", async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalCybaraHome = process.env.CYBARA_HOME;
    const tempRoot = mkdtempSync(join(tmpdir(), "cybara-builtin-plugin-test-"));
    tempRoots.push(tempRoot);
    const fakeHome = join(tempRoot, "home");
    const fakeCybaraHome = join(fakeHome, ".cybara");
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.CYBARA_HOME = fakeCybaraHome;

    try {
      const installed = listInstalledPlugins();
      expect(installed.filter((plugin) => plugin.builtIn)).toHaveLength(5);
      expect(installed.every((plugin) => plugin.enabled)).toBe(true);

      setPluginEnabled("developer-essentials", false);
      clearSkillsCache();
      expect(
        listInstalledPlugins().find((plugin) => plugin.manifest.id === "developer-essentials")
          ?.enabled
      ).toBe(false);
      const disabledSkills = await loadAllSkills({});
      expect(disabledSkills.some((entry) => entry.skill.name === "code-review")).toBe(false);
      expect(disabledSkills.some((entry) => entry.skill.name === "web-research")).toBe(true);

      setPluginEnabled("developer-essentials", true);
      clearSkillsCache();
      const restoredSkills = await loadAllSkills({});
      expect(restoredSkills.some((entry) => entry.skill.name === "code-review")).toBe(true);
    } finally {
      clearSkillsCache();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalCybaraHome === undefined) delete process.env.CYBARA_HOME;
      else process.env.CYBARA_HOME = originalCybaraHome;
    }
  });

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
      expect(unsafe.warnings.join(" ")).toContain(
        "symlinked contribution path outside plugin root"
      );
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

  test("installs ZIP and browser folder bundles after validating the manifest", async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalCybaraHome = process.env.CYBARA_HOME;
    const tempRoot = mkdtempSync(join(tmpdir(), "cybara-plugin-bundle-test-"));
    tempRoots.push(tempRoot);
    const fakeHome = join(tempRoot, "home");
    const fakeCybaraHome = join(fakeHome, ".cybara");
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.CYBARA_HOME = fakeCybaraHome;

    const manifest = JSON.stringify({
      id: "portable-plugin",
      name: "Portable Plugin",
      version: "1.2.3",
      description: "Portable plugin bundle",
      contributions: { skills: { dirs: ["skills"] } },
    });
    const skill =
      "---\nname: Portable Skill\ndescription: Portable skill\n---\n\n# Portable Skill\n";
    const zipPath = join(tempRoot, "portable-plugin.zip");
    writeFileSync(
      zipPath,
      createStoredZip([
        { path: "portable-plugin/cybara-plugin.json", content: manifest },
        { path: "portable-plugin/skills/portable/SKILL.md", content: skill },
      ])
    );

    try {
      const validation = await validatePluginInstallPayload({ path: zipPath });
      expect(validation.valid).toBe(true);
      expect(validation.manifest?.name).toBe("Portable Plugin");
      const installed = await installPluginFromPayload({ path: zipPath });
      expect(installed.manifest.id).toBe("portable-plugin");
      expect(installed.skillDirs).toHaveLength(1);

      const browserValidation = await validatePluginInstallPayload({
        files: [
          {
            path: "browser-plugin/cybara-plugin.json",
            dataBase64: Buffer.from(
              JSON.stringify({
                id: "browser-plugin",
                name: "Browser Plugin",
                version: "1.0.0",
                description: "Browser folder upload",
                contributions: { skills: { dirs: ["skills"] } },
              })
            ).toString("base64"),
          },
          {
            path: "browser-plugin/skills/browser/SKILL.md",
            dataBase64: Buffer.from(skill).toString("base64"),
          },
        ],
      });
      expect(browserValidation.valid).toBe(true);
      expect(browserValidation.manifest?.id).toBe("browser-plugin");
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalCybaraHome === undefined) delete process.env.CYBARA_HOME;
      else process.env.CYBARA_HOME = originalCybaraHome;
    }
  });

  test("rejects traversal, ambiguous manifests, malformed uploads, and multiple sources", async () => {
    expect(() => validatePluginArchiveEntries(["../escape.txt"])).toThrow("Unsafe");
    expect(() => validatePluginArchiveEntries(["C:\\escape.txt"])).toThrow("Unsafe");
    expect(() => parsePluginInstallPayload({ path: "/tmp/plugin", files: [] })).toThrow(
      "exactly one"
    );
    expect(() =>
      parsePluginInstallPayload({ archive: { name: "plugin.zip", dataBase64: "not base64" } })
    ).not.toThrow();

    const ambiguous = await validatePluginInstallPayload({
      files: [
        {
          path: "one/cybara-plugin.json",
          dataBase64: Buffer.from("{}").toString("base64"),
        },
        {
          path: "two/cybara-plugin.json",
          dataBase64: Buffer.from("{}").toString("base64"),
        },
      ],
    });
    expect(ambiguous.valid).toBe(false);
    expect(ambiguous.errors.join(" ")).toContain("multiple plugin manifests");

    const malformed = await validatePluginInstallPayload({
      archive: { name: "plugin.zip", dataBase64: "not base64" },
    });
    expect(malformed.valid).toBe(false);
    expect(malformed.errors.join(" ")).toContain("invalid base64");

    const traversalZip = createStoredZip([{ path: "../escape.txt", content: "blocked" }]);
    const traversal = await validatePluginInstallPayload({
      archive: { name: "traversal.zip", dataBase64: traversalZip.toString("base64") },
    });
    expect(traversal.valid).toBe(false);
    expect(traversal.errors.join(" ")).toContain("Unsafe plugin bundle path");

    const bombZip = createStoredZip([{ path: "plugin/file.txt", content: "small" }]);
    const bombCentralOffset = bombZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(bombCentralOffset).toBeGreaterThan(0);
    bombZip.writeUInt32LE(MAX_PLUGIN_EXPANDED_BYTES + 1, bombCentralOffset + 24);
    const bomb = await validatePluginInstallPayload({
      archive: { name: "bomb.zip", dataBase64: bombZip.toString("base64") },
    });
    expect(bomb.valid).toBe(false);
    expect(bomb.errors.join(" ")).toContain("expands beyond the allowed size");

    const mismatchedZip = createStoredZip([{ path: "plugin/file.txt", content: "data" }]);
    mismatchedZip[30] = "x".charCodeAt(0);
    const mismatched = await validatePluginInstallPayload({
      archive: { name: "mismatch.zip", dataBase64: mismatchedZip.toString("base64") },
    });
    expect(mismatched.valid).toBe(false);
    expect(mismatched.errors.join(" ")).toContain("local path does not match");
  });
});
