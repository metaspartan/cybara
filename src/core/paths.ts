// Centralized path constants for the Cybara Agent Platform
// This eliminates repeated __dirname patterns across the codebase
// In compiled binaries, __dirname resolves to /$bunfs/ which is read-only,
// so all writable paths must use ~/.cybara/

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";

// User home directory
export const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();

// Cybara data directory (writable in both dev and compiled binary)
export const cybaraDir = join(homeDir, ".cybara");

// Writable directories - all under ~/.cybara for compiled binary compatibility
export const dataDir = join(cybaraDir, "data");
export const memoryDir = join(cybaraDir, "memory");
export const logsDir = join(cybaraDir, "logs");
export const configDir = process.env.CONFIG_DIR || cybaraDir;

// Get the directory of this file (may be virtual /$bunfs/ in compiled binary)
const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root - only use for read-only resources like bundled skills/templates
// In compiled binaries, this will be /$bunfs/root/
export const projectRoot = join(__dirname, "..", "..");

// Read-only directories from project (bundled assets)
export const srcDir = join(projectRoot, "src");
export const bundledSkillsDir = join(projectRoot, "skills");
export const templatesDir = join(projectRoot, "templates");
export const uiDistDir = join(projectRoot, "ui", "dist");

// User-installed skills (writable)
export const userSkillsDir = join(cybaraDir, "skills");

// Ensure writable directories exist
export function ensureCybaraDirs() {
    const dirs = [cybaraDir, dataDir, memoryDir, logsDir, userSkillsDir];
    for (const dir of dirs) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }
}

// Initialize directories on module load
ensureCybaraDirs();
