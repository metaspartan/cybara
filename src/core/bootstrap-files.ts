import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

export interface BootstrapFile {
  name: string;
  path: string;
  content: string;
  missing: boolean;
}

export const BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
];

export const CONTEXT_FILES = [
  "SOUL.md",
  "AGENTS.md",
  "CLAUDE.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
];

const PRIMARY_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

export const FOREIGN_RULE_FILES = [
  "GEMINI.md",
  ".github/copilot-instructions.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
];

const FOREIGN_RULE_DIRECTORIES = [
  { dir: ".cursor/rules", extensions: [".mdc", ".md"] },
  { dir: ".clinerules", extensions: [".md"] },
  { dir: ".windsurf/rules", extensions: [".md"] },
];

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function alwaysAppliedRuleBody(content: string): string | null {
  const frontmatter = FRONTMATTER_PATTERN.exec(content);
  if (!frontmatter) return content;
  const alwaysApply = /^alwaysApply:\s*true\s*$/m.test(frontmatter[1]);
  const conditional = /^(?:globs|description|trigger):\s*\S/m.test(frontmatter[1]);
  if (!alwaysApply && conditional) return null;
  return content.slice(frontmatter[0].length);
}

export function readForeignRuleFiles(workspaceDir: string): BootstrapFile[] {
  const files: BootstrapFile[] = [];
  for (const name of FOREIGN_RULE_FILES) {
    const path = join(workspaceDir, name);
    if (!isRegularFile(path)) continue;
    files.push({ name, path, content: readFileSync(path, "utf-8"), missing: false });
  }
  for (const { dir, extensions } of FOREIGN_RULE_DIRECTORIES) {
    const root = join(workspaceDir, dir);
    let entries: string[];
    try {
      entries = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!extensions.some((extension) => entry.endsWith(extension))) continue;
      const path = join(root, entry);
      if (!isRegularFile(path)) continue;
      const body = alwaysAppliedRuleBody(readFileSync(path, "utf-8"));
      if (body === null) continue;
      files.push({ name: `${dir}/${entry}`, path, content: body, missing: false });
    }
  }
  return files;
}

function hasPrimaryInstructions(files: readonly BootstrapFile[]): boolean {
  return files.some(
    (file) =>
      PRIMARY_INSTRUCTION_FILES.includes(file.name) &&
      !file.missing &&
      file.content.trim().length > 0
  );
}

export const DEFAULT_CONTEXT_FILE_MAX_CHARS = 20_000;
export const DEFAULT_CONTEXT_TOTAL_MAX_CHARS = 60_000;

function getTemplatesDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".cybara", "templates");
}

function readTemplate(name: string): string | null {
  const templatesDir = getTemplatesDir();
  const templatePath = join(templatesDir, name);

  if (existsSync(templatePath)) {
    return readFileSync(templatePath, "utf-8");
  }

  const projectTemplates = join(__dirname, "..", "..", "templates", name);
  if (existsSync(projectTemplates)) {
    return readFileSync(projectTemplates, "utf-8");
  }

  return null;
}

export function createBootstrapFiles(
  workspaceDir: string,
  options: { skipExisting?: boolean; files?: string[] } = {}
): string[] {
  const filesToCreate = options.files || BOOTSTRAP_FILENAMES;
  const created: string[] = [];

  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }

  for (const filename of filesToCreate) {
    const filePath = join(workspaceDir, filename);

    if (options.skipExisting && existsSync(filePath)) {
      continue;
    }

    const template = readTemplate(filename);
    if (template) {
      writeFileSync(filePath, template, "utf-8");
      created.push(filename);
      console.log(`[Bootstrap] Created ${filename}`);
    }
  }

  const memoryDir = join(workspaceDir, "memory");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log("[Bootstrap] Created memory/ directory");
  }

  return created;
}

export function readBootstrapFiles(workspaceDir: string): BootstrapFile[] {
  const files: BootstrapFile[] = [];

  for (const filename of CONTEXT_FILES) {
    const filePath = join(workspaceDir, filename);
    const exists = existsSync(filePath);

    files.push({
      name: filename,
      path: filePath,
      content: exists ? readFileSync(filePath, "utf-8") : "",
      missing: !exists,
    });
  }

  return files;
}

export function getBootstrapContextFiles(
  workspaceDir: string,
  options: { maxChars?: number; maxTotalChars?: number } = {}
): Array<{ name: string; path: string; content: string }> {
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? DEFAULT_CONTEXT_FILE_MAX_CHARS));
  const maxTotalChars = Math.max(
    1,
    Math.floor(options.maxTotalChars ?? DEFAULT_CONTEXT_TOTAL_MAX_CHARS)
  );
  const ownFiles = readBootstrapFiles(workspaceDir);
  const bootstrapFiles = hasPrimaryInstructions(ownFiles)
    ? ownFiles
    : [...ownFiles, ...readForeignRuleFiles(workspaceDir)];
  const contextFiles: Array<{ name: string; path: string; content: string }> = [];
  const marker = "\n\n[... truncated ...]";
  let remainingChars = maxTotalChars;

  for (const file of bootstrapFiles) {
    if (file.missing || file.content.trim().length === 0 || remainingChars <= 0) continue;
    const contentLimit = Math.min(maxChars, remainingChars);
    let content = file.content;
    if (content.length > contentLimit) {
      const prefixLength = Math.max(0, contentLimit - marker.length);
      content = `${content.slice(0, prefixLength)}${marker.slice(0, contentLimit - prefixLength)}`;
      console.log(
        `[Bootstrap] Truncated ${file.name} (${file.content.length} chars > ${contentLimit})`
      );
    }
    contextFiles.push({ name: file.name, path: file.path, content });
    remainingChars -= content.length;
  }

  return contextFiles;
}

export function isFirstRun(workspaceDir: string): boolean {
  return existsSync(join(workspaceDir, "BOOTSTRAP.md"));
}

export function completeBootstrap(workspaceDir: string): void {
  const bootstrapPath = join(workspaceDir, "BOOTSTRAP.md");
  if (existsSync(bootstrapPath)) {
    unlinkSync(bootstrapPath);
    console.log("[Bootstrap] Removed BOOTSTRAP.md - setup complete");
  }
}
