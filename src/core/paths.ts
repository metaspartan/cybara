import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { chmodSync, type Dirent, existsSync, mkdirSync, readdirSync } from "fs";
import {
  cybaraHomeOverrideFile,
  resolveCybaraHome,
  runtimeHomeDir,
  type CybaraHomeSource,
} from "./cybara-home";

export const homeDir = runtimeHomeDir;
const cybaraHome = resolveCybaraHome();
export const cybaraDir = cybaraHome.dir;
export const cybaraHomeSource: CybaraHomeSource = cybaraHome.source;
export const cybaraHomeForced = cybaraHome.forced;
export const defaultCybaraDir = cybaraHome.defaultDir;
export { cybaraHomeOverrideFile };

export const dataDir = join(cybaraDir, "data");
export const memoryDir = join(cybaraDir, "memory");
export const logsDir = join(cybaraDir, "logs");
export const secureDir = join(cybaraDir, "secure");
export const configDir = process.env.CONFIG_DIR ? resolve(process.env.CONFIG_DIR) : cybaraDir;

const __dirname = dirname(fileURLToPath(import.meta.url));

export const projectRoot = join(__dirname, "..", "..");

export const srcDir = join(projectRoot, "src");
export const bundledSkillsDir = join(projectRoot, "skills");
export const templatesDir = join(projectRoot, "templates");
export const uiDistDir = join(projectRoot, "ui", "dist");

export const userSkillsDir = join(cybaraDir, "skills");

const NESTED_PRIVATE_DIRS = ["channels", "browser"] as const;

const PRIVATE_TOP_LEVEL_FILES = ["api_key", "security.json"] as const;

function restrictPathMode(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {}
}

function hardenExistingCybaraEntries(): void {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(cybaraDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const target = join(cybaraDir, entry.name);
    if (entry.isDirectory()) {
      restrictPathMode(target, 0o700);
      if (!(NESTED_PRIVATE_DIRS as readonly string[]).includes(entry.name)) continue;
      let nested: Dirent[] = [];
      try {
        nested = readdirSync(target, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of nested) {
        if (child.isDirectory() && !child.isSymbolicLink()) {
          restrictPathMode(join(target, child.name), 0o700);
        }
      }
      continue;
    }
    if (entry.isFile() && (PRIVATE_TOP_LEVEL_FILES as readonly string[]).includes(entry.name)) {
      restrictPathMode(target, 0o600);
    }
  }
}

export function ensureCybaraDirs() {
  const dirs = [cybaraDir, dataDir, memoryDir, logsDir, secureDir, userSkillsDir];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    restrictPathMode(dir, 0o700);
  }
  hardenExistingCybaraEntries();
}

ensureCybaraDirs();
