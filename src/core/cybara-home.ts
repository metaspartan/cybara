import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

export type CybaraHomeSource = "env" | "override" | "default";

export const runtimeHomeDir = process.env.HOME || process.env.USERPROFILE || homedir();
export const defaultCybaraHomeDir = join(runtimeHomeDir, ".cybara");
export const cybaraHomeOverrideFile = join(runtimeHomeDir, ".cybara_home");

export interface CybaraHomeResolution {
  dir: string;
  source: CybaraHomeSource;
  forced: boolean;
  defaultDir: string;
  overrideFile: string;
}

export function normalizeCybaraHomeDir(value: unknown): string {
  if (typeof value !== "string") return defaultCybaraHomeDir;
  const trimmed = value.trim().replace(/\0/g, "");
  if (!trimmed || trimmed === "~") return defaultCybaraHomeDir;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return resolve(runtimeHomeDir, trimmed.slice(2));
  }
  return resolve(trimmed);
}

export function readCybaraHomeOverride(): string | null {
  try {
    if (!existsSync(cybaraHomeOverrideFile)) return null;
    const normalized = normalizeCybaraHomeDir(readFileSync(cybaraHomeOverrideFile, "utf8"));
    return normalized === defaultCybaraHomeDir ? null : normalized;
  } catch {
    return null;
  }
}

export function resolveCybaraHome(): CybaraHomeResolution {
  const envDir = process.env.CYBARA_HOME?.trim();
  if (envDir) {
    return {
      dir: normalizeCybaraHomeDir(envDir),
      source: "env",
      forced: true,
      defaultDir: defaultCybaraHomeDir,
      overrideFile: cybaraHomeOverrideFile,
    };
  }

  const override = readCybaraHomeOverride();
  if (override) {
    return {
      dir: override,
      source: "override",
      forced: false,
      defaultDir: defaultCybaraHomeDir,
      overrideFile: cybaraHomeOverrideFile,
    };
  }

  return {
    dir: defaultCybaraHomeDir,
    source: "default",
    forced: false,
    defaultDir: defaultCybaraHomeDir,
    overrideFile: cybaraHomeOverrideFile,
  };
}

export function setCybaraHomeOverride(value: unknown): CybaraHomeResolution {
  if (process.env.CYBARA_HOME?.trim()) {
    throw new Error(
      "CYBARA_HOME is set in the gateway environment; unset it before managing the data directory here"
    );
  }

  const normalized = normalizeCybaraHomeDir(value);
  if (normalized === defaultCybaraHomeDir) {
    clearCybaraHomeOverride();
    return resolveCybaraHome();
  }

  mkdirSync(normalized, { recursive: true, mode: 0o700 });
  writeFileSync(cybaraHomeOverrideFile, `${normalized}\n`, { mode: 0o600 });
  try {
    chmodSync(cybaraHomeOverrideFile, 0o600);
    chmodSync(normalized, 0o700);
  } catch {}
  return resolveCybaraHome();
}

export function clearCybaraHomeOverride(): void {
  try {
    if (existsSync(cybaraHomeOverrideFile)) unlinkSync(cybaraHomeOverrideFile);
  } catch {}
}
