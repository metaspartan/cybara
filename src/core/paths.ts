import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { chmodSync, existsSync, mkdirSync } from "fs";
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

export function ensureCybaraDirs() {
  const dirs = [cybaraDir, dataDir, memoryDir, logsDir, secureDir, userSkillsDir];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
      chmodSync(dir, 0o700);
    } catch {}
  }
}

ensureCybaraDirs();
