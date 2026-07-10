import { existsSync } from "node:fs";
import { commandExists, isWindows } from "./platform";

function powershellQuote(value: string): string {
  return "'" + value.split("'").join("''") + "'";
}

export function zipExtractionCommands(
  zipPath: string,
  destDir: string,
  platform: NodeJS.Platform = process.platform,
  hasCommand: (command: string) => boolean = commandExists
): string[][] {
  const commands: string[][] = [];
  if (platform === "win32") {
    commands.push(["tar", "-xf", zipPath, "-C", destDir]);
    commands.push([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${powershellQuote(zipPath)} -DestinationPath ${powershellQuote(destDir)} -Force`,
    ]);
    return commands;
  }
  if (hasCommand("unzip")) {
    commands.push(["unzip", "-o", zipPath, "-d", destDir]);
  }
  if (platform === "darwin" || hasCommand("bsdtar")) {
    commands.push([platform === "darwin" ? "tar" : "bsdtar", "-xf", zipPath, "-C", destDir]);
  }
  if (commands.length === 0) {
    commands.push(["unzip", "-o", zipPath, "-d", destDir]);
  }
  return commands;
}

export function extractZipArchive(zipPath: string, destDir: string): void {
  if (!existsSync(zipPath)) {
    throw new Error(`Archive not found: ${zipPath}`);
  }
  const failures: string[] = [];
  for (const command of zipExtractionCommands(zipPath, destDir)) {
    try {
      const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
      if (result.exitCode === 0) return;
      failures.push(`${command[0]}: exit ${result.exitCode} ${result.stderr.toString().trim()}`);
    } catch (error) {
      failures.push(`${command[0]}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Failed to extract ${zipPath} (${failures.join(" | ")})`);
}
