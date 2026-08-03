import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { posix, win32 } from "path";
import { fileURLToPath } from "url";

function pathOperations(platform: NodeJS.Platform): typeof win32 {
  return platform === "win32" ? win32 : posix;
}

function absoluteEnvironmentPath(
  value: string | undefined,
  platform: NodeJS.Platform
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const paths = pathOperations(platform);
  return paths.isAbsolute(trimmed) ? paths.resolve(trimmed) : null;
}

export function resolveIdeUserHome(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  osHome: string = homedir()
): string {
  const paths = pathOperations(platform);
  if (platform === "win32") {
    const profile = absoluteEnvironmentPath(environment.USERPROFILE, platform);
    if (profile) return profile;

    const homeDrive = environment.HOMEDRIVE?.trim() ?? "";
    const homePath = environment.HOMEPATH?.trim() ?? "";
    const combinedHome = absoluteEnvironmentPath(`${homeDrive}${homePath}`, platform);
    if (combinedHome) return combinedHome;
  }
  return paths.resolve(osHome);
}

export const IDE_HOME_DIR = resolveIdeUserHome();

function decodeIdeFileUrl(inputPath: string, platform: NodeJS.Platform): string {
  if (!/^file:/i.test(inputPath)) return inputPath;
  try {
    const url = new URL(inputPath);
    if (url.protocol !== "file:") return inputPath;
    if (platform !== "win32") return fileURLToPath(url);

    const pathname = decodeURIComponent(url.pathname).replaceAll("/", "\\");
    if (url.hostname && url.hostname.toLowerCase() !== "localhost") {
      return `\\\\${url.hostname}${pathname}`;
    }
    return pathname.replace(/^\\(?=[a-z]:\\)/i, "");
  } catch {
    return inputPath;
  }
}

export function normalizeIdePathForPlatform(
  inputPath: string,
  homeDirectory: string,
  platform: NodeJS.Platform
): string {
  const paths = pathOperations(platform);
  let normalized = decodeIdeFileUrl(inputPath.trim(), platform);
  if (platform === "win32") {
    normalized = normalized
      .replace(/^\/(?=[a-z]:[\\/])/i, "")
      .replace(/^\\\\\?\\UNC\\/i, "\\\\")
      .replace(/^\\\\\?\\(?=[a-z]:\\)/i, "");
  }
  if (/^~(?=$|[\\/])/.test(normalized)) {
    normalized = paths.join(homeDirectory, normalized.slice(1));
  }
  return paths.resolve(normalized);
}

export function resolveCanonicalPath(path: string): string {
  try {
    return normalizeIdePathForPlatform(realpathSync(path), IDE_HOME_DIR, process.platform);
  } catch {
    return pathOperations(process.platform).resolve(path);
  }
}

function canonicalizeForCheck(inputPath: string): string {
  const paths = pathOperations(process.platform);
  const resolved = paths.resolve(inputPath);
  if (existsSync(resolved)) return resolveCanonicalPath(resolved);

  const trailing: string[] = [];
  let cursor = resolved;
  while (!existsSync(cursor)) {
    const parent = paths.dirname(cursor);
    if (parent === cursor) break;
    trailing.unshift(paths.basename(cursor));
    cursor = parent;
  }
  const realBase = resolveCanonicalPath(cursor);
  return trailing.length ? paths.join(realBase, ...trailing) : realBase;
}

export function isPathWithinIdeRootForPlatform(
  rootPath: string,
  resolvedPath: string,
  platform: NodeJS.Platform
): boolean {
  const paths = pathOperations(platform);
  const rel = paths.relative(paths.resolve(rootPath), paths.resolve(resolvedPath));
  return (
    rel === "" || (rel !== ".." && !rel.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rel))
  );
}

export function isIdeAccessiblePath(resolvedPath: string): boolean {
  if (!resolvedPath.trim() || resolvedPath.includes("\0")) return false;
  return pathOperations(process.platform).isAbsolute(resolvedPath);
}

export function isIdePathAllowed(targetPath: string): boolean {
  return resolveAllowedIdePath(targetPath) !== null;
}

export function normalizeIdeInputPath(inputPath: string): string {
  return normalizeIdePathForPlatform(inputPath, IDE_HOME_DIR, process.platform);
}

export function resolveAllowedIdePath(inputPath: string): string | null {
  if (!inputPath.trim() || inputPath.includes("\0")) return null;
  const resolvedPath = canonicalizeForCheck(normalizeIdeInputPath(inputPath));
  return isIdeAccessiblePath(resolvedPath) ? resolvedPath : null;
}
