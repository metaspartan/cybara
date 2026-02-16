// Bootstrap file utilities - OpenClaw compatible workspace setup
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface BootstrapFile {
  name: string;
  path: string;
  content: string;
  missing: boolean;
}

// Default bootstrap file names (OpenClaw standard)
export const BOOTSTRAP_FILENAMES = [
  "AGENTS.md",
  "SOUL.md",
  "BOOTSTRAP.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
];

// Files to inject into system prompt context (OpenClaw standard)
export const CONTEXT_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md"];

/**
 * Get the templates directory path
 */
function getTemplatesDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".cybara", "templates");
}

/**
 * Read a template file, falling back to embedded templates
 */
function readTemplate(name: string): string | null {
  // Try local templates first
  const templatesDir = getTemplatesDir();
  const templatePath = join(templatesDir, name);

  if (existsSync(templatePath)) {
    return readFileSync(templatePath, "utf-8");
  }

  // Try project templates directory
  const projectTemplates = join(__dirname, "..", "..", "..", "templates", name);
  if (existsSync(projectTemplates)) {
    return readFileSync(projectTemplates, "utf-8");
  }

  return null;
}

/**
 * Create bootstrap files in a workspace directory if they don't exist.
 * Returns list of files created.
 */
export function createBootstrapFiles(
  workspaceDir: string,
  options: { skipExisting?: boolean; files?: string[] } = {}
): string[] {
  const filesToCreate = options.files || BOOTSTRAP_FILENAMES;
  const created: string[] = [];

  // Ensure workspace directory exists
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

  // Create memory directory if it doesn't exist
  const memoryDir = join(workspaceDir, "memory");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log("[Bootstrap] Created memory/ directory");
  }

  return created;
}

/**
 * Read bootstrap files from a workspace directory.
 * Returns array of bootstrap file objects.
 */
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

/**
 * Get bootstrap files as context files for system prompt injection.
 * Filters out missing files and optionally truncates large content.
 */
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

      // Truncate if too large
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

/**
 * Check if BOOTSTRAP.md exists (indicates first run).
 */
export function isFirstRun(workspaceDir: string): boolean {
  return existsSync(join(workspaceDir, "BOOTSTRAP.md"));
}

/**
 * Remove BOOTSTRAP.md after first-run ritual is complete.
 */
export function completeBootstrap(workspaceDir: string): void {
  const bootstrapPath = join(workspaceDir, "BOOTSTRAP.md");
  if (existsSync(bootstrapPath)) {
    unlinkSync(bootstrapPath);
    console.log("[Bootstrap] Removed BOOTSTRAP.md - setup complete");
  }
}
