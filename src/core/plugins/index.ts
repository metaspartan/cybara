import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

import type {
  CybaraPluginManifest,
  CybaraPluginSource,
  InstalledCybaraPlugin,
  PluginValidationResult,
} from "./types";
import { resolveCybaraHome } from "../cybara-home";
import { getBuiltinPluginCatalog } from "./catalog";
import { isPluginEnabled, persistPluginEnabled } from "./state";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CYBARA_PLUGIN_MANIFEST = "cybara-plugin.json";

function getUserHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function getCybaraHomeDir(): string {
  return resolveCybaraHome().dir;
}

function normalizePluginId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getBundledPluginsRoot(): string {
  const isCompiledBinary = !process.execPath.endsWith("bun") && !process.execPath.includes("/bun");
  if (isCompiledBinary) {
    const execDir = dirname(process.execPath);
    const repoPlugins = resolve(execDir, "..", "plugins");
    const sidePlugins = join(execDir, "plugins");
    if (existsSync(repoPlugins)) return repoPlugins;
    if (existsSync(sidePlugins)) return sidePlugins;
    return join(getCybaraHomeDir(), "bundled-plugins");
  }
  return resolve(__dirname, "../../../plugins");
}

export function getLocalPluginsRoot(): string {
  return join(getCybaraHomeDir(), "plugins");
}

function getWorkspacePluginRoots(workspaceDir?: string): string[] {
  if (!workspaceDir) return [];
  return [join(workspaceDir, "plugins"), join(workspaceDir, ".cybara", "plugins")];
}

export function getPluginRoots(workspaceDir?: string): Array<{
  path: string;
  source: CybaraPluginSource;
}> {
  return [
    { path: getBundledPluginsRoot(), source: "bundled" },
    { path: getLocalPluginsRoot(), source: "local" },
    ...getWorkspacePluginRoots(workspaceDir).map((path) => ({
      path,
      source: "workspace" as const,
    })),
  ];
}

function resolvePluginRoot(inputPath: string): string {
  const resolved = inputPath.startsWith("~")
    ? join(getUserHomeDir(), inputPath.slice(1))
    : resolve(inputPath);
  if (!existsSync(resolved)) {
    throw new Error(`Plugin path not found: ${resolved}`);
  }
  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    return realpathSync(resolved);
  }
  if (basename(resolved) === CYBARA_PLUGIN_MANIFEST) {
    return realpathSync(dirname(resolved));
  }
  throw new Error(`Plugin path must be a directory or ${CYBARA_PLUGIN_MANIFEST}`);
}

function isWithinDirectory(rootDir: string, candidatePath: string): boolean {
  const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  return candidatePath === rootDir || candidatePath.startsWith(normalizedRoot);
}

function resolveContributionDirs(
  rootDir: string,
  dirs: string[] | undefined,
  warnings: string[]
): string[] {
  const requested = Array.isArray(dirs) && dirs.length > 0 ? dirs : ["skills"];
  const resolvedDirs: string[] = [];
  const lexicalRoot = resolve(rootDir);
  const canonicalRoot = realpathSync(rootDir);
  for (const dir of requested) {
    if (typeof dir !== "string" || !dir.trim()) {
      continue;
    }
    if (isAbsolute(dir)) {
      warnings.push(`Ignoring absolute contribution path: ${dir}`);
      continue;
    }
    const nextPath = resolve(rootDir, dir);
    if (!isWithinDirectory(lexicalRoot, nextPath)) {
      warnings.push(`Ignoring contribution path outside plugin root: ${dir}`);
      continue;
    }
    if (existsSync(nextPath) && statSync(nextPath).isDirectory()) {
      const canonicalNext = realpathSync(nextPath);
      if (!isWithinDirectory(canonicalRoot, canonicalNext)) {
        warnings.push(`Ignoring symlinked contribution path outside plugin root: ${dir}`);
        continue;
      }
      resolvedDirs.push(canonicalNext);
    }
  }
  return [...new Set(resolvedDirs)];
}

export function validatePluginAtPath(pluginPath: string): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let rootDir = "";

  try {
    rootDir = resolvePluginRoot(pluginPath);
  } catch (error) {
    return {
      valid: false,
      errors: [(error as Error).message],
      warnings,
    };
  }

  const manifestPath = join(rootDir, CYBARA_PLUGIN_MANIFEST);
  if (!existsSync(manifestPath)) {
    return {
      valid: false,
      errors: [`Missing ${CYBARA_PLUGIN_MANIFEST} in ${rootDir}`],
      warnings,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid JSON in ${CYBARA_PLUGIN_MANIFEST}: ${(error as Error).message}`],
      warnings,
    };
  }

  const manifest = parsed as Partial<CybaraPluginManifest>;
  const normalizedId = typeof manifest.id === "string" ? normalizePluginId(manifest.id) : "";
  if (!normalizedId) {
    errors.push("Plugin manifest requires a valid id");
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    errors.push("Plugin manifest requires a name");
  }
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(manifest.version.trim())
  ) {
    errors.push("Plugin manifest requires a semver-like version");
  }
  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    errors.push("Plugin manifest requires a description");
  }

  const skillDirs = resolveContributionDirs(
    rootDir,
    manifest.contributions?.skills?.dirs,
    warnings
  );
  if (skillDirs.length === 0) {
    warnings.push("Plugin does not expose any existing skill directories");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
    };
  }

  return {
    valid: true,
    errors,
    warnings,
    manifest: {
      schemaVersion: manifest.schemaVersion === 1 ? 1 : 1,
      id: normalizedId,
      name: manifest.name!.trim(),
      version: manifest.version!.trim(),
      description: manifest.description!.trim(),
      author: typeof manifest.author === "string" ? manifest.author.trim() || undefined : undefined,
      homepage:
        typeof manifest.homepage === "string" ? manifest.homepage.trim() || undefined : undefined,
      contributions: {
        skills: {
          dirs: skillDirs
            .map((dir) => relative(rootDir, dir))
            .filter((dir) => !!dir && dir !== "."),
        },
      },
    },
  };
}

function pluginSourcePriority(source: CybaraPluginSource): number {
  if (source === "workspace") return 3;
  if (source === "local") return 2;
  return 1;
}

function listSkillNames(skillDirs: string[]): string[] {
  const names = new Set<string>();
  for (const skillDir of skillDirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(skillDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(skillDir, entry);
      try {
        if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "SKILL.md"))) {
          names.add(entry);
        }
      } catch {
        continue;
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function loadPluginFromRoot(
  rootDir: string,
  source: CybaraPluginSource
): InstalledCybaraPlugin | null {
  const validation = validatePluginAtPath(rootDir);
  if (!validation.valid || !validation.manifest) {
    return null;
  }
  const skillDirs = resolveContributionDirs(
    rootDir,
    validation.manifest.contributions?.skills?.dirs,
    []
  );
  return {
    manifest: validation.manifest,
    rootDir,
    source,
    skillDirs,
    skillNames: listSkillNames(skillDirs),
    enabled: isPluginEnabled(validation.manifest.id),
    builtIn: false,
  };
}

export function listInstalledPlugins(options?: { workspaceDir?: string }): InstalledCybaraPlugin[] {
  const pluginsById = new Map<string, InstalledCybaraPlugin>();

  for (const entry of getBuiltinPluginCatalog().filter((plugin) => plugin.installedByDefault)) {
    pluginsById.set(entry.id, {
      manifest: {
        schemaVersion: 1,
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        author: entry.author,
      },
      rootDir: `builtin:${entry.id}`,
      source: "bundled",
      skillDirs: [],
      skillNames: [...entry.skillNames],
      enabled: isPluginEnabled(entry.id, entry.enabledByDefault),
      builtIn: true,
    });
  }

  for (const root of getPluginRoots(options?.workspaceDir)) {
    if (!existsSync(root.path)) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(root.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const pluginRoot = join(root.path, entry);
      try {
        if (!statSync(pluginRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      const plugin = loadPluginFromRoot(pluginRoot, root.source);
      if (!plugin) continue;
      const existing = pluginsById.get(plugin.manifest.id);
      if (
        !existing ||
        pluginSourcePriority(plugin.source) >= pluginSourcePriority(existing.source)
      ) {
        pluginsById.set(plugin.manifest.id, plugin);
      }
    }
  }

  return Array.from(pluginsById.values()).sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name)
  );
}

export function setPluginEnabled(pluginId: string, enabled: boolean): InstalledCybaraPlugin {
  const plugin = listInstalledPlugins().find((entry) => entry.manifest.id === pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
  persistPluginEnabled(pluginId, enabled);
  return { ...plugin, enabled };
}

export function installLocalPluginFromPath(inputPath: string): InstalledCybaraPlugin {
  const rootDir = resolvePluginRoot(inputPath);
  const validation = validatePluginAtPath(rootDir);
  if (!validation.valid || !validation.manifest) {
    throw new Error(validation.errors.join("; ") || "Invalid plugin");
  }

  const targetRoot = join(getLocalPluginsRoot(), validation.manifest.id);
  mkdirSync(getLocalPluginsRoot(), { recursive: true });
  rmSync(targetRoot, { recursive: true, force: true });
  cpSync(rootDir, targetRoot, { recursive: true });

  const installed = loadPluginFromRoot(targetRoot, "local");
  if (!installed) {
    throw new Error("Installed plugin could not be reloaded");
  }
  return installed;
}

export function uninstallLocalPlugin(pluginId: string): boolean {
  const normalizedId = normalizePluginId(pluginId);
  if (!normalizedId) {
    throw new Error("Plugin id is required");
  }
  const targetRoot = join(getLocalPluginsRoot(), normalizedId);
  if (!existsSync(targetRoot)) {
    return false;
  }
  rmSync(targetRoot, { recursive: true, force: true });
  return true;
}

export * from "./install";
export * from "./bundle";
export * from "./catalog";
