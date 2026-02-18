import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";

export const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();

export const cybaraDir = join(homeDir, ".cybara");

export const dataDir = join(cybaraDir, "data");
export const memoryDir = join(cybaraDir, "memory");
export const logsDir = join(cybaraDir, "logs");
export const secureDir = join(cybaraDir, "secure");
export const configDir = process.env.CONFIG_DIR || cybaraDir;

const __dirname = dirname(fileURLToPath(import.meta.url));

export const projectRoot = join(__dirname, "..", "..");

export const srcDir = join(projectRoot, "src");
export const bundledSkillsDir = join(projectRoot, "skills");
export const templatesDir = join(projectRoot, "templates");
export const uiDistDir = join(projectRoot, "ui", "dist");

export const userSkillsDir = join(cybaraDir, "skills");

export function ensureCybaraDirs() {
  const dirs = [cybaraDir, dataDir, memoryDir, logsDir, secureDir, userSkillsDir];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

ensureCybaraDirs();
