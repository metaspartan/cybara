import { platform as osPlatform, arch as osArch } from "os";

export type PlatformTarget =
  | "darwin_arm64"
  | "darwin_x64"
  | "linux_x64"
  | "linux_arm64"
  | "win32_x64"
  | "win32_arm64";

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

export function isWindows(): boolean {
  return osPlatform() === "win32";
}

export function isMacOS(): boolean {
  return osPlatform() === "darwin";
}

export function isLinux(): boolean {
  return osPlatform() === "linux";
}

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

export function getWindowsShellCommand(
  command: string,
  commandAvailable: (cmd: string) => boolean = commandExists
): string[] {
  if (commandAvailable("pwsh")) {
    return [
      "pwsh",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ];
  }
  if (commandAvailable("powershell")) {
    return [
      "powershell",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ];
  }
  return ["cmd.exe", "/d", "/s", "/c", command];
}

export function getHostShellCommand(command: string): string[] {
  return isWindows() ? getWindowsShellCommand(command) : ["sh", "-c", command];
}

export function getShell(): [string, string] {
  return isWindows() ? ["cmd", "/c"] : ["sh", "-c"];
}

export function getPathSeparator(): string {
  return isWindows() ? ";" : ":";
}

export function getExecutableExtension(): string {
  return isWindows() ? ".exe" : "";
}

export function normalizePath(path: string): string {
  if (isWindows()) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

export function getHomeDir(): string {
  if (isWindows()) {
    return process.env.USERPROFILE || process.env.HOME || "C:\\Users\\Default";
  }
  return process.env.HOME || "/tmp";
}

export function getTempDir(): string {
  if (isWindows()) {
    return process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp";
  }
  return process.env.TMPDIR || "/tmp";
}
