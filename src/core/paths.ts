// Centralized path constants for the Cybara Agent Platform
// This eliminates repeated __dirname patterns across the codebase

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

// Get the directory of this file
const __dirname = dirname(fileURLToPath(import.meta.url));

// Project root (src/core -> src -> project root)
export const projectRoot = join(__dirname, "..", "..");

// Common directories
export const srcDir = join(projectRoot, "src");
export const dataDir = join(projectRoot, "data");
export const memoryDir = join(projectRoot, "memory");
export const skillsDir = join(projectRoot, "skills");
export const uiDistDir = join(projectRoot, "ui", "dist");

// User home directory
export const homeDir = process.env.HOME || homedir();

// Config directory (for browser profiles, etc)
export const configDir = process.env.CONFIG_DIR || join(homeDir, ".cybara");
