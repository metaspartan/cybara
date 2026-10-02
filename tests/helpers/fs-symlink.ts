import { symlinkSync } from "fs";

const WINDOWS = process.platform === "win32";

export function linkFile(target: string, linkPath: string): void {
  if (WINDOWS) {
    symlinkSync(target, linkPath, "file");
    return;
  }
  symlinkSync(target, linkPath);
}

export function linkDirectory(target: string, linkPath: string): void {
  if (WINDOWS) {
    symlinkSync(target, linkPath, "junction");
    return;
  }
  symlinkSync(target, linkPath, "dir");
}
