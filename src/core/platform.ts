/**
 * Cross-Platform Utilities
 * Centralized helpers for platform detection and cross-platform operations
 */

import { platform as osPlatform, arch as osArch } from "os";

// Platform targets matching Bun's cross-compilation targets
export type PlatformTarget =
  | "darwin_arm64"
  | "darwin_x64"
  | "linux_x64"
  | "linux_arm64"
  | "win32_x64"
  | "win32_arm64";

/**
 * Get the current platform target
 */
export function getPlatformTarget(): PlatformTarget | "unsupported" {
  const platform = osPlatform();
  const arch = osArch();

  if (platform === "darwin" && arch === "arm64") return "darwin_arm64";
  if (platform === "darwin" && arch === "x64") return "darwin_x64";
  if (platform === "linux" && arch === "x64") return "linux_x64";
  if (platform === "linux" && arch === "arm64") return "linux_arm64";
  if (platform === "win32" && arch === "x64") return "win32_x64";
  if (platform === "win32" && arch === "arm64") return "win32_arm64";

  return "unsupported";
}

/**
 * Check if current platform is Windows
 */
export function isWindows(): boolean {
  return osPlatform() === "win32";
}

/**
 * Check if current platform is macOS
 */
export function isMacOS(): boolean {
  return osPlatform() === "darwin";
}

/**
 * Check if current platform is Linux
 */
export function isLinux(): boolean {
  return osPlatform() === "linux";
}

/**
 * Check if a command/binary exists on the system PATH
 * Uses 'where' on Windows, 'which' on Unix-like systems
 */
export function commandExists(cmd: string): boolean {
  try {
    const checkCmd = isWindows() ? "where" : "which";
    const result = Bun.spawnSync([checkCmd, cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get the appropriate shell for running commands
 * Returns [shell, flag] tuple for use with spawn
 */
export function getShell(): [string, string] {
  return isWindows() ? ["cmd", "/c"] : ["sh", "-c"];
}

/**
 * Get the path separator for the current platform
 */
export function getPathSeparator(): string {
  return isWindows() ? ";" : ":";
}

/**
 * Get the executable extension for the current platform
 */
export function getExecutableExtension(): string {
  return isWindows() ? ".exe" : "";
}

/**
 * Convert a Unix-style path to the platform-appropriate format
 */
export function normalizePath(path: string): string {
  if (isWindows()) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

/**
 * Get HOME directory cross-platform
 */
export function getHomeDir(): string {
  if (isWindows()) {
    return process.env.USERPROFILE || process.env.HOME || "C:\\Users\\Default";
  }
  return process.env.HOME || "/tmp";
}

/**
 * Get the temp directory cross-platform
 */
export function getTempDir(): string {
  if (isWindows()) {
    return process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp";
  }
  return process.env.TMPDIR || "/tmp";
}
