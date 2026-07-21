import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { config } from "./config";
import { tables, type Provider } from "./database";
import { cybaraDir, userSkillsDir } from "./paths";
import { providerManager, providers, type ProviderType } from "./providers";
import { clearSkillsCache } from "./skills/index";

export type MigrationSourceKind = "openclaw" | "hermes" | "codex" | "claude-code";
export type MigrationPreset = "user-data" | "full";
export type MigrationSkillConflictMode = "skip" | "overwrite" | "rename";
export type MigrationItemStatus =
  | "planned"
  | "migrated"
  | "archived"
  | "skipped"
  | "conflict"
  | "error";

export interface MigrationSourceCandidate {
  kind: MigrationSourceKind;
  path: string;
  exists: boolean;
  label: string;
  confidence: "high" | "medium" | "manual";
  detected: {
    persona: boolean;
    memoryFiles: number;
    skillCount: number;
    configFiles: number;
    envFiles: number;
  };
}

export interface SourceMigrationRequest {
  sourceKind?: MigrationSourceKind;
  sourcePath?: string;
  preset?: MigrationPreset;
  dryRun?: boolean;
  overwrite?: boolean;
  migrateSecrets?: boolean;
  skillConflict?: MigrationSkillConflictMode;
  workspaceTarget?: string;
}

export interface SourceMigrationRuntime {
  targetRoot?: string;
  now?: Date;
}

export interface MigrationItem {
  id: string;
  category:
    | "source"
    | "persona"
    | "memory"
    | "skill"
    | "provider"
    | "speech"
    | "workspace"
    | "settings"
    | "archive";
  name: string;
  source?: string;
  target?: string;
  status: MigrationItemStatus;
  detail?: string;
}

export interface SourceMigrationReport {
  success: boolean;
  dryRun: boolean;
  sourceKind: MigrationSourceKind;
  sourceRoot: string;
  targetRoot: string;
  preset: MigrationPreset;
  migrateSecrets: boolean;
  overwrite: boolean;
  skillConflict: MigrationSkillConflictMode;
  reportPath?: string;
  createdAt: string;
  summary: Record<MigrationItemStatus | "total", number>;
  warnings: string[];
  items: MigrationItem[];
  nextSteps: string[];
}

type ConfigRecord = Record<string, unknown>;

interface SecretMatch {
  key: string;
  provider: ProviderType;
  field: "api_key" | "access_token" | "refresh_token";
  label: string;
  value: string;
}

const SECRET_TARGETS: Array<{
  keys: string[];
  provider: ProviderType;
  field: SecretMatch["field"];
  label: string;
}> = [
  { keys: ["OPENAI_API_KEY"], provider: "openai", field: "api_key", label: "OpenAI" },
  {
    keys: ["OPENAI_CODEX_ACCESS_TOKEN", "CODEX_ACCESS_TOKEN"],
    provider: "openai-codex",
    field: "access_token",
    label: "OpenAI Codex",
  },
  {
    keys: ["OPENAI_CODEX_REFRESH_TOKEN", "CODEX_REFRESH_TOKEN"],
    provider: "openai-codex",
    field: "refresh_token",
    label: "OpenAI Codex",
  },
  { keys: ["ANTHROPIC_API_KEY"], provider: "anthropic", field: "api_key", label: "Anthropic" },
  { keys: ["OPENROUTER_API_KEY"], provider: "openrouter", field: "api_key", label: "OpenRouter" },
  { keys: ["ELEVENLABS_API_KEY"], provider: "elevenlabs", field: "api_key", label: "ElevenLabs" },
  { keys: ["MINIMAX_API_KEY"], provider: "minimax", field: "api_key", label: "MiniMax" },
  {
    keys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    provider: "google",
    field: "api_key",
    label: "Google",
  },
  { keys: ["GROQ_API_KEY"], provider: "groq", field: "api_key", label: "Groq" },
  { keys: ["XAI_API_KEY"], provider: "xai", field: "api_key", label: "xAI" },
  { keys: ["DEEPSEEK_API_KEY"], provider: "deepseek", field: "api_key", label: "DeepSeek" },
  { keys: ["MISTRAL_API_KEY"], provider: "mistral", field: "api_key", label: "Mistral" },
];

function expandUserPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function normalizedPath(path: string): string {
  return resolve(expandUserPath(path));
}

function asRecord(value: unknown): ConfigRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ConfigRecord) : {};
}

function sourceLabel(kind: MigrationSourceKind): string {
  const labels: Record<MigrationSourceKind, string> = {
    openclaw: "OpenClaw",
    hermes: "Hermes",
    codex: "Codex",
    "claude-code": "Claude Code",
  };
  return labels[kind];
}

export function normalizeMigrationSourceKind(value: unknown): MigrationSourceKind | undefined {
  if (value === "openclaw" || value === "hermes" || value === "codex") return value;
  if (value === "claude" || value === "claude-code") return "claude-code";
  return undefined;
}

function sourceDefaultPaths(): Record<MigrationSourceKind, string[]> {
  const codexHome = process.env.CODEX_HOME?.trim();
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return {
    openclaw: ["~/.openclaw", "~/.clawdbot", "~/.moltbot"],
    hermes: ["~/.hermes"],
    codex: [...(codexHome ? [codexHome] : []), "~/.codex"],
    "claude-code": [...(claudeConfigDir ? [claudeConfigDir] : []), "~/.claude"],
  };
}

function sourceDefaults(): Array<{ kind: MigrationSourceKind; path: string }> {
  const seen = new Set<string>();
  return Object.entries(sourceDefaultPaths()).flatMap(([kind, paths]) =>
    paths.flatMap((path) => {
      const key = `${kind}:${normalizedPath(path)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ kind: kind as MigrationSourceKind, path }];
    })
  );
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path) && lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function dirExists(path: string): boolean {
  try {
    return existsSync(path) && lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReadFile(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function listExistingFiles(paths: string[]): string[] {
  return paths.map(normalizedPath).filter(fileExists);
}

function listMarkdownFiles(dir: string): string[] {
  const root = normalizedPath(dir);
  if (!dirExists(root)) return [];
  return readdirSync(root)
    .map((entry) => join(root, entry))
    .filter((path) => {
      try {
        const stat = lstatSync(path);
        return stat.isFile() && !stat.isSymbolicLink() && path.toLowerCase().endsWith(".md");
      } catch {
        return false;
      }
    });
}

function listProjectMemoryFiles(root: string): string[] {
  const projectsRoot = normalizedPath(join(root, "projects"));
  if (!dirExists(projectsRoot)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(projectsRoot).slice(0, 1000)) {
    files.push(...listMarkdownFiles(join(projectsRoot, entry, "memory")));
  }
  return files;
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => String(parseScalar(entry)));
  }
  return trimmed;
}

function parseSimpleYaml(raw: string): ConfigRecord {
  const root: ConfigRecord = {};
  const stack: Array<{ indent: number; value: ConfigRecord }> = [{ indent: -1, value: root }];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^(\s*)([^:#][^:]*):(?:\s*(.*))?$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2].trim();
    const rawValue = match[3] ?? "";
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].value;
    if (!rawValue.trim()) {
      const child: ConfigRecord = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }
  return root;
}

function parseConfigContent(raw: string, path: string): ConfigRecord {
  if (path.toLowerCase().endsWith(".toml")) {
    try {
      return asRecord(Bun.TOML.parse(raw));
    } catch {
      return {};
    }
  }
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return parseSimpleYaml(raw);
  }
}

function parseEnv(raw: string): ConfigRecord {
  const out: ConfigRecord = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function configFilesFor(kind: MigrationSourceKind, root: string): string[] {
  const common = [join(root, "config.json"), join(root, ".env")];
  if (kind === "openclaw") {
    return [
      join(root, "openclaw.json"),
      join(root, "clawdbot.json"),
      join(root, "moltbot.json"),
      ...common,
    ];
  }
  if (kind === "hermes") {
    return [
      join(root, "config.yaml"),
      join(root, "config.yml"),
      join(root, "hermes.toml"),
      ...common,
    ];
  }
  if (kind === "codex") {
    return [join(root, "config.toml"), join(root, "auth.json"), ...common];
  }
  const rootState = basename(root) === ".claude" ? join(dirname(root), ".claude.json") : "";
  return [
    join(root, "settings.json"),
    join(root, "settings.local.json"),
    ...common,
    rootState,
  ].filter(Boolean);
}

function parseSourceConfig(
  kind: MigrationSourceKind,
  root: string
): {
  records: ConfigRecord[];
  configFiles: string[];
  envFiles: string[];
} {
  const configFiles = listExistingFiles(configFilesFor(kind, root));
  const records: ConfigRecord[] = [];
  const envFiles: string[] = [];
  for (const path of configFiles) {
    const raw = safeReadFile(path);
    if (!raw) continue;
    if (basename(path) === ".env") {
      envFiles.push(path);
      records.push(parseEnv(raw));
    } else {
      records.push(parseConfigContent(raw, path));
    }
  }
  return { records, configFiles, envFiles };
}

function collectStringValues(record: unknown, key: string, values: string[] = []): string[] {
  if (!record || typeof record !== "object") return values;
  if (Array.isArray(record)) {
    for (const entry of record) collectStringValues(entry, key, values);
    return values;
  }
  for (const [entryKey, value] of Object.entries(record as ConfigRecord)) {
    if (entryKey.toUpperCase() === key.toUpperCase() && typeof value === "string" && value.trim()) {
      values.push(value.trim());
    }
    collectStringValues(value, key, values);
  }
  return values;
}

function collectSecrets(records: ConfigRecord[], kind: MigrationSourceKind): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const seen = new Set<string>();
  const append = (match: SecretMatch): void => {
    const dedupeKey = `${match.provider}:${match.field}:${createHash("sha256").update(match.value).digest("hex")}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    matches.push(match);
  };
  for (const target of SECRET_TARGETS) {
    for (const key of target.keys) {
      for (const record of records) {
        for (const value of collectStringValues(record, key)) {
          append({
            key,
            provider: target.provider,
            field: target.field,
            label: target.label,
            value,
          });
        }
      }
    }
  }
  if (kind === "codex") {
    for (const record of records) {
      const tokens = asRecord(record.tokens);
      for (const [key, field] of [
        ["access_token", "access_token"],
        ["refresh_token", "refresh_token"],
      ] as const) {
        const value = tokens[key];
        if (typeof value !== "string" || !value.trim()) continue;
        append({
          key,
          provider: "openai-codex",
          field,
          label: "OpenAI Codex",
          value: value.trim(),
        });
      }
    }
  }
  return matches;
}

function inferSourceKind(root: string, requested?: MigrationSourceKind): MigrationSourceKind {
  if (requested) return requested;
  if (
    basename(root) === ".codex" ||
    fileExists(join(root, "config.toml")) ||
    fileExists(join(root, "auth.json"))
  )
    return "codex";
  if (
    basename(root) === ".claude" ||
    fileExists(join(root, "settings.json")) ||
    fileExists(join(root, "CLAUDE.md"))
  )
    return "claude-code";
  if (fileExists(join(root, "config.yaml")) || fileExists(join(root, "config.yml")))
    return "hermes";
  if (fileExists(join(root, "hermes.toml"))) return "hermes";
  return "openclaw";
}

function personaFilesFor(kind: MigrationSourceKind, root: string): string[] {
  const candidates: Record<MigrationSourceKind, string[]> = {
    openclaw: [join(root, "SOUL.md"), join(root, "workspace", "SOUL.md")],
    hermes: [join(root, "SOUL.md"), join(root, "persona.md")],
    codex: [join(root, "AGENTS.md")],
    "claude-code": [join(root, "CLAUDE.md")],
  };
  return listExistingFiles(candidates[kind]);
}

function memoryFilesFor(kind: MigrationSourceKind, root: string): string[] {
  const candidates: Record<MigrationSourceKind, string[]> = {
    openclaw: [
      join(root, "MEMORY.md"),
      join(root, "USER.md"),
      join(root, "workspace", "MEMORY.md"),
      join(root, "workspace", "USER.md"),
      ...listMarkdownFiles(join(root, "memory")),
      ...listMarkdownFiles(join(root, "workspace", "memory")),
    ],
    hermes: [
      join(root, "MEMORY.md"),
      join(root, "USER.md"),
      join(root, "memories", "MEMORY.md"),
      join(root, "memories", "USER.md"),
      join(root, "memory", "MEMORY.md"),
      join(root, "memory", "USER.md"),
      ...listMarkdownFiles(join(root, "memories")),
      ...listMarkdownFiles(join(root, "memory")),
    ],
    codex: [
      join(root, "memories", "MEMORY.md"),
      join(root, "memories", "memory_summary.md"),
      join(root, "memories", "raw_memories.md"),
      ...listMarkdownFiles(join(root, "memories")),
    ],
    "claude-code": [
      join(root, "memory", "MEMORY.md"),
      ...listMarkdownFiles(join(root, "memory")),
      ...listProjectMemoryFiles(root),
    ],
  };
  return [...new Set(listExistingFiles(candidates[kind]))];
}

function skillSourcesFor(kind: MigrationSourceKind, root: string): string[] {
  const roots = [
    join(root, "skills"),
    join(root, "workspace", "skills"),
    join(root, ".agents", "skills"),
  ];
  if (kind === "hermes") roots.push(join(root, "optional-skills"));
  if (kind === "codex" && basename(root) === ".codex") {
    roots.push(join(dirname(root), ".agents", "skills"));
  }
  if (kind === "claude-code") roots.push(join(root, "commands"));
  const skills: string[] = [];
  for (const skillsRoot of roots.map(normalizedPath)) {
    if (!dirExists(skillsRoot)) continue;
    for (const entry of readdirSync(skillsRoot)) {
      const path = join(skillsRoot, entry);
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory() && fileExists(join(path, "SKILL.md"))) {
          skills.push(path);
        } else if (stat.isFile() && entry.toLowerCase().endsWith(".md")) {
          skills.push(path);
        }
      } catch {
        continue;
      }
    }
  }
  return [...new Set(skills)];
}

function workspaceInstructionFilesFor(kind: MigrationSourceKind, root: string): string[] {
  if (kind === "claude-code") return listExistingFiles([join(root, "CLAUDE.md")]);
  return listExistingFiles([join(root, "AGENTS.md"), join(root, "workspace", "AGENTS.md")]);
}

function summarizeCandidate(kind: MigrationSourceKind, path: string): MigrationSourceCandidate {
  const root = normalizedPath(path);
  const exists = dirExists(root);
  const parsed = exists
    ? parseSourceConfig(kind, root)
    : { records: [], configFiles: [], envFiles: [] };
  return {
    kind,
    path: root,
    exists,
    label: `${sourceLabel(kind)} (${root})`,
    confidence: exists ? "high" : "manual",
    detected: {
      persona: exists && personaFilesFor(kind, root).length > 0,
      memoryFiles: exists ? memoryFilesFor(kind, root).length : 0,
      skillCount: exists ? skillSourcesFor(kind, root).length : 0,
      configFiles: parsed.configFiles.length,
      envFiles: parsed.envFiles.length,
    },
  };
}

export function detectMigrationSources(): MigrationSourceCandidate[] {
  return sourceDefaults().map((candidate) => summarizeCandidate(candidate.kind, candidate.path));
}

function makeSummary(items: MigrationItem[]): SourceMigrationReport["summary"] {
  const summary = {
    total: items.length,
    planned: 0,
    migrated: 0,
    archived: 0,
    skipped: 0,
    conflict: 0,
    error: 0,
  };
  for (const item of items) {
    summary[item.status] += 1;
  }
  return summary;
}

function item(
  category: MigrationItem["category"],
  name: string,
  status: MigrationItemStatus,
  detail?: string,
  source?: string,
  target?: string
): MigrationItem {
  return {
    id: createHash("sha256")
      .update([category, name, source || "", target || ""].join("\0"))
      .digest("hex")
      .slice(0, 16),
    category,
    name,
    status,
    detail,
    source,
    target,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function readSkillName(path: string): string {
  const skillPath = dirExists(path) ? join(path, "SKILL.md") : path;
  const content = safeReadFile(skillPath) || "";
  const frontmatterName = content.match(/^---[\s\S]*?\nname:\s*["']?([^"'\n]+)["']?/m)?.[1];
  if (frontmatterName?.trim()) return frontmatterName.trim();
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  if (heading?.trim()) return heading.trim();
  return basename(path, ".md");
}

function uniqueSkillTarget(
  root: string,
  preferredSlug: string,
  mode: MigrationSkillConflictMode
): {
  path: string;
  slug: string;
  conflicted: boolean;
} {
  const base = slugify(preferredSlug) || "imported-skill";
  let slug = base;
  let target = join(root, slug);
  if (!existsSync(target) || mode !== "rename") {
    return { path: target, slug, conflicted: existsSync(target) };
  }
  for (let index = 2; index < 1000; index += 1) {
    slug = `${base}-${index}`;
    target = join(root, slug);
    if (!existsSync(target)) return { path: target, slug, conflicted: false };
  }
  return { path: target, slug, conflicted: true };
}

function copyDirectorySafe(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(target, entry);
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if ([".git", "node_modules", "target", "dist", "build"].includes(entry)) continue;
      copyDirectorySafe(from, to);
    } else if (stat.isFile() && stat.size <= 10 * 1024 * 1024) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function normalizeContentForDedupe(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

function writeMemoryImport(
  files: string[],
  targetRoot: string,
  kind: MigrationSourceKind,
  dryRun: boolean
): MigrationItem[] {
  const items: MigrationItem[] = [];
  const targetDir = join(targetRoot, "memory");
  const targetFile = join(targetDir, "MEMORY.md");
  const existing = safeReadFile(targetFile) || "";
  const existingNormalized = normalizeContentForDedupe(existing);
  const sections: string[] = [];
  for (const source of files) {
    const content = safeReadFile(source);
    if (!content?.trim()) {
      items.push(
        item(
          "memory",
          basename(source),
          "skipped",
          "Source file is empty or unreadable",
          source,
          targetFile
        )
      );
      continue;
    }
    if (existingNormalized.includes(normalizeContentForDedupe(content).slice(0, 200))) {
      items.push(
        item(
          "memory",
          basename(source),
          dryRun ? "planned" : "skipped",
          "Already present in Cybara memory",
          source,
          targetFile
        )
      );
      continue;
    }
    sections.push(
      [
        "",
        `## Imported from ${sourceLabel(kind)}: ${relative(normalizedPath(dirname(source)), source) || basename(source)}`,
        "",
        content.trim(),
        "",
      ].join("\n")
    );
    items.push(
      item(
        "memory",
        basename(source),
        dryRun ? "planned" : "migrated",
        "Append to durable memory",
        source,
        targetFile
      )
    );
  }
  if (!dryRun && sections.length > 0) {
    mkdirSync(targetDir, { recursive: true });
    const prefix = existing.trim() ? `${existing.trimEnd()}\n` : "# Cybara Memory\n";
    writeFileSync(targetFile, `${prefix}${sections.join("\n")}`, "utf-8");
  }
  return items;
}

function importPersona(
  files: string[],
  kind: MigrationSourceKind,
  dryRun: boolean,
  overwrite: boolean
): MigrationItem[] {
  const items: MigrationItem[] = [];
  for (const source of files) {
    const content = safeReadFile(source);
    if (!content?.trim()) {
      items.push(
        item("persona", basename(source), "skipped", "Persona file is empty or unreadable", source)
      );
      continue;
    }
    const current = asRecord(config.get("systemPrompt"));
    const currentPrompt =
      typeof current.customPrompt === "string" ? current.customPrompt.trim() : "";
    if (currentPrompt && !overwrite) {
      items.push(
        item(
          "persona",
          basename(source),
          dryRun ? "planned" : "conflict",
          "Cybara already has a custom system prompt; rerun with overwrite to replace it",
          source
        )
      );
      continue;
    }
    if (!dryRun) {
      config.set("systemPrompt", {
        ...current,
        customPrompt: content.trim(),
      });
    }
    items.push(
      item(
        "persona",
        basename(source),
        dryRun ? "planned" : "migrated",
        `Import ${sourceLabel(kind)} persona as the custom system prompt`,
        source
      )
    );
    break;
  }
  return items;
}

function importSkills(
  sources: string[],
  targetRoot: string,
  kind: MigrationSourceKind,
  dryRun: boolean,
  conflictMode: MigrationSkillConflictMode
): MigrationItem[] {
  const items: MigrationItem[] = [];
  const skillsRoot = targetRoot === cybaraDir ? userSkillsDir : join(targetRoot, "skills");
  for (const source of sources) {
    const name = readSkillName(source);
    const targetInfo = uniqueSkillTarget(skillsRoot, `${kind}-${name}`, conflictMode);
    if (targetInfo.conflicted && conflictMode === "skip") {
      items.push(
        item(
          "skill",
          name,
          dryRun ? "planned" : "conflict",
          "Skill folder already exists",
          source,
          targetInfo.path
        )
      );
      continue;
    }
    try {
      if (!dryRun) {
        if (targetInfo.conflicted && conflictMode === "overwrite") {
          rmSync(targetInfo.path, { recursive: true, force: true });
        }
        if (dirExists(source)) {
          copyDirectorySafe(source, targetInfo.path);
        } else {
          mkdirSync(targetInfo.path, { recursive: true });
          copyFileSync(source, join(targetInfo.path, "SKILL.md"));
        }
        clearSkillsCache();
      }
      items.push(
        item(
          "skill",
          name,
          dryRun ? "planned" : "migrated",
          `Install as ${targetInfo.slug}`,
          source,
          targetInfo.path
        )
      );
    } catch (error) {
      items.push(
        item(
          "skill",
          name,
          "error",
          error instanceof Error ? error.message : String(error),
          source,
          targetInfo.path
        )
      );
    }
  }
  return items;
}

function providerPayloadFromSecrets(
  secrets: SecretMatch[]
): Map<ProviderType, Partial<Provider> & { name: string }> {
  const grouped = new Map<ProviderType, Partial<Provider> & { name: string }>();
  for (const secret of secrets) {
    const current = grouped.get(secret.provider) || {
      provider: secret.provider,
      name: `Imported ${secret.label}`,
      is_default: false,
    };
    current[secret.field] = secret.value;
    grouped.set(secret.provider, current);
  }
  return grouped;
}

function importProviders(
  secrets: SecretMatch[],
  kind: MigrationSourceKind,
  dryRun: boolean,
  migrateSecrets: boolean,
  overwrite: boolean
): MigrationItem[] {
  if (secrets.length === 0) return [];
  const items: MigrationItem[] = [];
  const grouped = providerPayloadFromSecrets(secrets);
  const existing = tables.providers.all() as Provider[];
  for (const [providerType, payload] of grouped.entries()) {
    const providerInfo = providers[providerType];
    const label = providerInfo?.name || payload.name;
    const name = `Imported ${sourceLabel(kind)} ${label}`;
    const existingNamed = existing.find((provider) => provider.name === name);
    const existingCredentialed = existing.find(
      (provider) =>
        provider.provider === providerType &&
        Boolean(provider.api_key || provider.access_token || provider.refresh_token)
    );
    if (!migrateSecrets) {
      items.push(
        item(
          "provider",
          label,
          "skipped",
          "Secret import is off; rerun with migrate secrets enabled"
        )
      );
      continue;
    }
    if (existingCredentialed && !existingNamed && !overwrite) {
      items.push(
        item(
          "provider",
          label,
          dryRun ? "planned" : "conflict",
          "A credentialed provider of this type already exists; rerun with overwrite to replace it"
        )
      );
      continue;
    }
    if (!dryRun) {
      if (existingNamed || existingCredentialed) {
        providerManager.update((existingNamed || existingCredentialed)!.id, {
          ...(payload as Provider),
          name: (existingNamed || existingCredentialed)!.name || name,
        });
      } else {
        providerManager.create({
          provider: providerType,
          name,
          api_key: payload.api_key,
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
          is_default: false,
        });
      }
    }
    items.push(
      item(
        "provider",
        label,
        dryRun ? "planned" : "migrated",
        "Import credential into a Cybara provider account"
      )
    );
  }
  return items;
}

function importSpeechSettings(
  secrets: SecretMatch[],
  dryRun: boolean,
  migrateSecrets: boolean,
  overwrite: boolean
): MigrationItem[] {
  const hasElevenLabs = secrets.some((secret) => secret.provider === "elevenlabs");
  if (!hasElevenLabs) return [];
  if (!migrateSecrets) {
    return [
      item(
        "speech",
        "ElevenLabs TTS",
        "skipped",
        "Speech provider detected, but secret import is off"
      ),
    ];
  }
  const current = asRecord(config.get("speech"));
  const tts = asRecord(current.tts);
  if (tts.provider && tts.provider !== "auto" && !overwrite) {
    return [
      item(
        "speech",
        "ElevenLabs TTS",
        dryRun ? "planned" : "conflict",
        "Cybara already has a TTS provider configured"
      ),
    ];
  }
  if (!dryRun) {
    config.set("speech", {
      ...current,
      tts: {
        ...tts,
        provider: "elevenlabs",
      },
    });
  }
  return [
    item(
      "speech",
      "ElevenLabs TTS",
      dryRun ? "planned" : "migrated",
      "Set TTS provider preference to ElevenLabs"
    ),
  ];
}

function importWorkspaceInstructions(
  files: string[],
  workspaceTarget: string | undefined,
  dryRun: boolean,
  overwrite: boolean
): MigrationItem[] {
  if (files.length === 0) return [];
  if (!workspaceTarget?.trim()) {
    return files.map((source) =>
      item(
        "workspace",
        basename(source),
        "skipped",
        "Set workspace target to import workspace instructions",
        source
      )
    );
  }
  const targetDir = normalizedPath(workspaceTarget);
  const target = join(targetDir, "AGENTS.md");
  const source = files[0];
  if (existsSync(target) && !overwrite) {
    return [
      item(
        "workspace",
        "AGENTS.md",
        dryRun ? "planned" : "conflict",
        "Target workspace already has AGENTS.md",
        source,
        target
      ),
    ];
  }
  if (!dryRun) {
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, target);
  }
  return [
    item(
      "workspace",
      "AGENTS.md",
      dryRun ? "planned" : "migrated",
      "Copy workspace instructions",
      source,
      target
    ),
  ];
}

function archivedSettings(
  records: ConfigRecord[],
  kind: MigrationSourceKind,
  dryRun: boolean
): MigrationItem[] {
  const items: MigrationItem[] = [];
  const keys = new Set<string>();
  for (const record of records) {
    for (const key of [
      "mcp",
      "messaging",
      "channels",
      "approval",
      "approvals",
      "allowlist",
      "tools",
      "tts_assets",
      "mcp_servers",
      "mcpServers",
      "permissions",
      "hooks",
      "sandbox_mode",
      "approval_policy",
      "enabledPlugins",
      "plugins",
    ]) {
      if (collectStringValues(record, key).length > 0 || key in record) keys.add(key);
    }
  }
  for (const key of keys) {
    items.push(
      item(
        "archive",
        key,
        dryRun ? "planned" : "archived",
        `${sourceLabel(kind)} ${key} settings need review before enabling in Cybara`
      )
    );
  }
  return items;
}

function resolveSourcePath(kind: MigrationSourceKind, sourcePath?: string): string {
  if (sourcePath?.trim()) return normalizedPath(sourcePath);
  const defaults = sourceDefaultPaths()[kind];
  const candidate = defaults.map(normalizedPath).find(dirExists);
  return candidate || normalizedPath(defaults[0]);
}

function reportNextSteps(report: Omit<SourceMigrationReport, "nextSteps">): string[] {
  const steps: string[] = [];
  if (report.dryRun) steps.push("Run migration from this preview after reviewing conflicts.");
  if (!report.migrateSecrets)
    steps.push(
      "Enable secret import only if you trust the source directory and want API keys imported."
    );
  if (report.summary.conflict > 0)
    steps.push("Resolve conflicts or rerun with overwrite/rename options.");
  if (report.items.some((entry) => entry.category === "archive")) {
    steps.push(
      "Review archived settings manually before enabling MCP, messaging, or approval-policy equivalents."
    );
  }
  if (!steps.length)
    steps.push("Open Providers, Memory, Skills, and Settings to confirm imported state.");
  return steps;
}

function writeReport(report: SourceMigrationReport): string {
  const dir = join(
    report.targetRoot,
    "migrations",
    `${report.sourceKind}-${report.createdAt.replace(/[:.]/g, "-")}`
  );
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "migration-report.json");
  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}

export async function runSourceMigration(
  request: SourceMigrationRequest = {},
  runtime: SourceMigrationRuntime = {}
): Promise<SourceMigrationReport> {
  const requestedKind = request.sourceKind;
  const sourceRoot = request.sourcePath?.trim()
    ? normalizedPath(request.sourcePath)
    : resolveSourcePath(requestedKind || "openclaw");
  const sourceKind = inferSourceKind(sourceRoot, requestedKind);
  const preset: MigrationPreset = request.preset === "full" ? "full" : "user-data";
  const dryRun = request.dryRun !== false;
  const targetRoot = normalizedPath(runtime.targetRoot || cybaraDir);
  const overwrite = request.overwrite === true;
  const migrateSecrets = request.migrateSecrets === true;
  const skillConflict: MigrationSkillConflictMode =
    request.skillConflict || (overwrite ? "overwrite" : "skip");
  const createdAt = (runtime.now || new Date()).toISOString();
  const items: MigrationItem[] = [];
  const warnings: string[] = [];

  if (!dirExists(sourceRoot)) {
    items.push(
      item(
        "source",
        sourceLabel(sourceKind),
        "error",
        "Source directory does not exist",
        sourceRoot
      )
    );
  } else {
    items.push(
      item(
        "source",
        sourceLabel(sourceKind),
        dryRun ? "planned" : "migrated",
        "Source directory detected",
        sourceRoot
      )
    );
    const parsed = parseSourceConfig(sourceKind, sourceRoot);
    const personaFiles = personaFilesFor(sourceKind, sourceRoot);
    const memoryFiles = memoryFilesFor(sourceKind, sourceRoot);
    const skills = skillSourcesFor(sourceKind, sourceRoot);
    const workspaceInstructions = workspaceInstructionFilesFor(sourceKind, sourceRoot);
    const secrets = collectSecrets(parsed.records, sourceKind);

    items.push(...importPersona(personaFiles, sourceKind, dryRun, overwrite));
    items.push(...writeMemoryImport(memoryFiles, targetRoot, sourceKind, dryRun));
    items.push(...importSkills(skills, targetRoot, sourceKind, dryRun, skillConflict));
    items.push(
      ...importWorkspaceInstructions(
        workspaceInstructions,
        request.workspaceTarget,
        dryRun,
        overwrite
      )
    );
    if (preset === "full") {
      items.push(...importProviders(secrets, sourceKind, dryRun, migrateSecrets, overwrite));
      items.push(...importSpeechSettings(secrets, dryRun, migrateSecrets, overwrite));
      items.push(...archivedSettings(parsed.records, sourceKind, dryRun));
    } else if (secrets.length > 0) {
      items.push(
        item(
          "provider",
          "API keys",
          "skipped",
          "Preset user-data skips secrets; use full preset and migrate secrets to import them"
        )
      );
    }
    if (parsed.configFiles.length === 0)
      warnings.push(`No ${sourceLabel(sourceKind)} config files were found.`);
  }

  const partialReport = {
    success: !items.some((entry) => entry.status === "error"),
    dryRun,
    sourceKind,
    sourceRoot,
    targetRoot,
    preset,
    migrateSecrets,
    overwrite,
    skillConflict,
    createdAt,
    summary: makeSummary(items),
    warnings,
    items,
  };
  const report: SourceMigrationReport = {
    ...partialReport,
    nextSteps: reportNextSteps(partialReport),
  };
  if (!dryRun) {
    report.reportPath = writeReport(report);
  }
  return report;
}
