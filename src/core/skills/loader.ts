import { readdir, readFile, stat, watch } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { getPluginRoots, listInstalledPlugins } from "../plugins";
import { getBuiltinSkillPacks } from "./builtin-packs";
import type {
  Skill,
  SkillEntry,
  SkillFrontmatter,
  SkillMetadata,
  SkillInvocationPolicy,
  SkillsConfig,
} from "./types";

const SKILL_FILENAME = "SKILL.md";

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    return { frontmatter: {}, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();

  const frontmatter: Record<string, unknown> = {};

  for (let i = 0; i < frontmatterLines.length; i++) {
    const line = frontmatterLines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    if (value === "|" || value === ">") {
      const multilineContent: string[] = [];
      let baseIndent = -1;

      for (let j = i + 1; j < frontmatterLines.length; j++) {
        const nextLine = frontmatterLines[j];

        const leadingSpaces = nextLine.match(/^(\s*)/)?.[1].length ?? 0;

        if (leadingSpaces === 0 && nextLine.includes(":")) {
          break;
        }

        if (baseIndent === -1 && nextLine.trim()) {
          baseIndent = leadingSpaces;
        }

        if (baseIndent !== -1) {
          multilineContent.push(nextLine.slice(baseIndent).trimEnd());
        }
        i = j; // Skip these lines in outer loop
      }

      value = multilineContent.join(" ").trim();
    } else if (typeof value === "string") {
      let strValue: string = value;

      if (
        (strValue.startsWith('"') && strValue.endsWith('"')) ||
        (strValue.startsWith("'") && strValue.endsWith("'"))
      ) {
        strValue = strValue.slice(1, -1);
      }

      if (key === "metadata" && strValue.startsWith("{")) {
        try {
          value = JSON.parse(strValue);
        } catch {
          value = strValue;
        }
      } else if (strValue === "true") {
        value = true;
      } else if (strValue === "false") {
        value = false;
      } else {
        value = strValue;
      }
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

export function parseSkillFile(
  content: string,
  filePath: string,
  source: SkillEntry["source"]
): SkillEntry | null {
  const { frontmatter, body } = parseFrontmatter(content);

  let name = frontmatter.name as string | undefined;
  let description = frontmatter.description as string | undefined;

  if (!name) {
    const headingMatch = body.match(/^#\s+(.+?)(?:\s*[-–—]\s*.+)?$/m);
    if (headingMatch) {
      name = headingMatch[1].trim();
    }
  }

  if (!description && body) {
    const paragraphs = body.split(/\n\n+/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("```") &&
        !trimmed.startsWith("|")
      ) {
        description = trimmed.slice(0, 200); // First 200 chars
        break;
      }
    }
  }

  if (!name || !description) {
    console.warn(`[Skills] Invalid SKILL.md at ${filePath}: missing name or description`);
    return null;
  }

  const rawMetadata = frontmatter.metadata as Record<string, unknown> | undefined;
  const firstMetadataValue = rawMetadata
    ? Object.values(rawMetadata).find(
        (value): value is SkillMetadata =>
          !!value && typeof value === "object" && !Array.isArray(value)
      )
    : undefined;
  const metadata: SkillMetadata | undefined =
    (rawMetadata?.cybara as SkillMetadata | undefined) ??
    (rawMetadata?.openclaw as SkillMetadata | undefined) ??
    firstMetadataValue;

  const invocation: SkillInvocationPolicy = {
    userInvocable: frontmatter["user-invocable"] !== false,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  };

  const skill: Skill = {
    name,
    description,
    location: dirname(filePath),
    instructions: body,
  };

  return {
    skill,
    frontmatter: frontmatter as SkillFrontmatter,
    metadata,
    invocation,
    filePath,
    source,
  };
}

export async function scanSkillsDirectory(
  dir: string,
  source: SkillEntry["source"],
  plugin?: SkillEntry["plugin"]
): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(dir, entry.name, SKILL_FILENAME);

      try {
        const content = await readFile(skillPath, "utf-8");
        const skillEntry = parseSkillFile(content, skillPath, source);
        if (skillEntry) {
          if (plugin) {
            skillEntry.plugin = plugin;
          }
          skills.push(skillEntry);
        }
      } catch {
        void 0;
      }
    }
  } catch {
    void 0;
  }

  return skills;
}

export function getSkillDirectories(workspaceDir?: string): {
  bundled: string;
  local: string;
  workspace: string | null;
} {
  const isCompiledBinary = !process.execPath.endsWith("bun") && !process.execPath.includes("/bun");
  let bundledPath: string;

  if (isCompiledBinary) {
    const execDir = dirname(process.execPath);
    const repoSkills = resolve(execDir, "..", "skills");
    const sideSkills = join(execDir, "skills");

    if (existsSync(repoSkills)) {
      bundledPath = repoSkills;
    } else if (existsSync(sideSkills)) {
      bundledPath = sideSkills;
    } else {
      bundledPath = join(homedir(), ".cybara", "bundled-skills");
    }
  } else {
    bundledPath = resolve(__dirname, "../../../skills");
  }

  return {
    bundled: bundledPath,
    local: join(homedir(), ".cybara", "skills"),
    workspace: workspaceDir ? join(workspaceDir, "skills") : null,
  };
}

const LOADED_SKILLS_CACHE_TTL_MS = 5_000;
let loadedSkillsCache: { key: string; skills: SkillEntry[]; expires: number } | null = null;

export function clearLoadedSkillsCache(): void {
  loadedSkillsCache = null;
}

export async function loadAllSkills(options: {
  workspaceDir?: string;
  extraDirs?: string[];
  config?: SkillsConfig;
}): Promise<SkillEntry[]> {
  const cacheKey = JSON.stringify({
    workspaceDir: options.workspaceDir ?? null,
    extraDirs: options.extraDirs ?? options.config?.load?.extraDirs ?? null,
    allowBundled: options.config?.allowBundled ?? null,
  });
  const now = Date.now();
  if (loadedSkillsCache && loadedSkillsCache.key === cacheKey && loadedSkillsCache.expires > now) {
    return loadedSkillsCache.skills;
  }

  const dirs = getSkillDirectories(options.workspaceDir);
  const skillsByName = new Map<string, SkillEntry>();
  const plugins = listInstalledPlugins({ workspaceDir: options.workspaceDir });

  // Curated built-in packs ship compiled into the binary (lowest priority, so
  // user/workspace skills of the same name override them).
  for (const pack of getBuiltinSkillPacks()) {
    const allowlist = options.config?.allowBundled;
    if (allowlist && !allowlist.includes(pack.skill.name)) continue;
    skillsByName.set(pack.skill.name, pack);
  }

  for (const dir of options.extraDirs ?? options.config?.load?.extraDirs ?? []) {
    const resolved = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
    const skills = await scanSkillsDirectory(resolved, "bundled");
    for (const skill of skills) {
      skillsByName.set(skill.skill.name, skill);
    }
  }

  const bundledSkills = await scanSkillsDirectory(dirs.bundled, "bundled");
  for (const skill of bundledSkills) {
    const allowlist = options.config?.allowBundled;
    if (allowlist && !allowlist.includes(skill.skill.name)) {
      continue;
    }
    skillsByName.set(skill.skill.name, skill);
  }

  for (const plugin of plugins.filter((entry) => entry.source === "bundled")) {
    for (const dir of plugin.skillDirs) {
      const pluginSkills = await scanSkillsDirectory(dir, "plugin", {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        source: plugin.source,
      });
      for (const skill of pluginSkills) {
        skillsByName.set(skill.skill.name, skill);
      }
    }
  }

  const localSkills = await scanSkillsDirectory(dirs.local, "local");
  for (const skill of localSkills) {
    skillsByName.set(skill.skill.name, skill);
  }

  for (const plugin of plugins.filter((entry) => entry.source === "local")) {
    for (const dir of plugin.skillDirs) {
      const pluginSkills = await scanSkillsDirectory(dir, "plugin", {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        source: plugin.source,
      });
      for (const skill of pluginSkills) {
        skillsByName.set(skill.skill.name, skill);
      }
    }
  }

  if (dirs.workspace) {
    const workspaceSkills = await scanSkillsDirectory(dirs.workspace, "workspace");
    for (const skill of workspaceSkills) {
      skillsByName.set(skill.skill.name, skill);
    }
  }

  for (const plugin of plugins.filter((entry) => entry.source === "workspace")) {
    for (const dir of plugin.skillDirs) {
      const pluginSkills = await scanSkillsDirectory(dir, "plugin", {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        source: plugin.source,
      });
      for (const skill of pluginSkills) {
        skillsByName.set(skill.skill.name, skill);
      }
    }
  }

  const skills = Array.from(skillsByName.values());
  loadedSkillsCache = { key: cacheKey, skills, expires: now + LOADED_SKILLS_CACHE_TTL_MS };
  return skills;
}

export function isSkillEnabled(skillName: string, config?: SkillsConfig): boolean {
  const entry = config?.entries?.[skillName];
  if (entry?.enabled === false) return false;
  return true;
}

export async function watchSkillDirectories(options: {
  workspaceDir?: string;
  config?: SkillsConfig;
  onReload: (skills: SkillEntry[]) => void;
}): Promise<{ close: () => void }> {
  const dirs = getSkillDirectories(options.workspaceDir);
  const plugins = listInstalledPlugins({ workspaceDir: options.workspaceDir });
  const debounceMs = options.config?.load?.watchDebounceMs ?? 250;

  const controllers: AbortController[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;

  const reload = async () => {
    clearLoadedSkillsCache();
    const skills = await loadAllSkills({
      workspaceDir: options.workspaceDir,
      config: options.config,
    });
    options.onReload(skills);
  };

  const handleChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reload, debounceMs);
  };

  const watchDir = async (dir: string) => {
    try {
      await stat(dir); // Check if exists
      const controller = new AbortController();
      controllers.push(controller);

      const watcher = watch(dir, { recursive: true, signal: controller.signal });

      (async () => {
        try {
          for await (const event of watcher) {
            if (event.filename?.endsWith(SKILL_FILENAME)) {
              handleChange();
            }
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).name !== "AbortError") {
            console.error(`[Skills] Watch error for ${dir}:`, err);
          }
        }
      })();
    } catch {
      void 0;
    }
  };

  watchDir(dirs.bundled);
  watchDir(dirs.local);
  if (dirs.workspace) watchDir(dirs.workspace);
  for (const dir of options.config?.load?.extraDirs ?? []) {
    const resolved = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
    watchDir(resolved);
  }
  for (const root of getPluginRoots(options.workspaceDir)) {
    watchDir(root.path);
  }
  for (const plugin of plugins) {
    watchDir(plugin.rootDir);
    for (const dir of plugin.skillDirs) {
      watchDir(dir);
    }
  }

  return {
    close: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const controller of controllers) {
        controller.abort();
      }
    },
  };
}

export function formatSkillsForPrompt(skills: SkillEntry[]): string {
  if (skills.length === 0) return "";

  const lines = ["<available_skills>"];

  for (const { skill } of skills) {
    const escapedName = escapeXml(skill.name);
    const escapedDesc = escapeXml(skill.description);
    const escapedLoc = escapeXml(skill.location);
    lines.push(
      `<skill name="${escapedName}" description="${escapedDesc}" location="${escapedLoc}" />`
    );
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
