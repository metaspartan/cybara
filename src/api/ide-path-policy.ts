import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { checkWritePath } from "../core/tools/path-policy";

export const IDE_HOME_DIR = homedir();

export function resolveCanonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function canonicalizeForCheck(inputPath: string): string {
  const resolved = resolve(inputPath);
  if (existsSync(resolved)) return resolveCanonicalPath(resolved);

  const trailing: string[] = [];
  let cursor = resolved;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    trailing.unshift(basename(cursor));
    cursor = parent;
  }
  const realBase = resolveCanonicalPath(cursor);
  return trailing.length ? join(realBase, ...trailing) : realBase;
}

const homeRoots = Array.from(new Set([resolve(IDE_HOME_DIR), resolveCanonicalPath(IDE_HOME_DIR)]));

function isWithinRoot(rootPath: string, resolvedPath: string): boolean {
  const rel = relative(rootPath, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isSensitivePath(resolvedPath: string): boolean {
  const decision = checkWritePath(resolvedPath);
  return !decision.allowed && decision.reason === "sensitive-path";
}

export function isWithinIdeHome(resolvedPath: string): boolean {
  if (isSensitivePath(resolvedPath)) return false;
  return homeRoots.some((rootPath) => isWithinRoot(rootPath, resolvedPath));
}

export function isIdePathAllowed(targetPath: string): boolean {
  return isWithinIdeHome(canonicalizeForCheck(targetPath));
}

export function normalizeIdeInputPath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return join(IDE_HOME_DIR, inputPath.slice(1));
  }
  return inputPath;
}
