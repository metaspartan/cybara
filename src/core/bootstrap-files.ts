import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

export const CONTEXT_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md"];

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
  options: { maxChars?: number } = {}
): Array<{ name: string; path: string; content: string }> {
  const maxChars = options.maxChars || 50000; // Default 50k chars per file
  const bootstrapFiles = readBootstrapFiles(workspaceDir);

  return bootstrapFiles
    .filter((file) => !file.missing && file.content.trim().length > 0)
    .map((file) => {
      let content = file.content;

      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + "\n\n[... truncated ...]";
        console.log(
          `[Bootstrap] Truncated ${file.name} (${file.content.length} chars > ${maxChars})`
        );
      }

      return {
        name: file.name,
        path: file.path,
        content,
      };
    });
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
