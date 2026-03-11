#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  computeReleaseVersion,
  replaceCargoTomlVersion,
  replaceJsonVersion,
} from "../src/core/versioning";

const ROOT = join(import.meta.dirname, "..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const UI_PACKAGE_JSON_PATH = join(ROOT, "ui", "package.json");
const CARGO_TOML_PATH = join(ROOT, "src-tauri", "Cargo.toml");
const TAURI_CONFIG_PATH = join(ROOT, "src-tauri", "tauri.conf.json");

function readText(path: string): string {
  return readFileSync(path, "utf-8");
}

function writeIfChanged(path: string, next: string): boolean {
  const previous = readText(path);
  if (previous === next) {
    return false;
  }
  writeFileSync(path, next, "utf-8");
  return true;
}

function readCommitCount(): number {
  const result = Bun.spawnSync(["git", "rev-list", "--count", "HEAD"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || "git rev-list failed";
    throw new Error(message);
  }
  const parsed = Number(result.stdout.toString().trim());
  if (!Number.isFinite(parsed)) {
    throw new Error("Could not parse git commit count");
  }
  return parsed;
}

function readCommitOffset(): number {
  const raw = process.env.CYBARA_RELEASE_COMMIT_OFFSET?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid CYBARA_RELEASE_COMMIT_OFFSET: ${raw}`);
  }
  return Math.trunc(parsed);
}

function resolveVersion(): string {
  const explicitVersion = process.env.CYBARA_RELEASE_VERSION?.trim();
  if (explicitVersion) {
    return explicitVersion;
  }
  const packageJson = JSON.parse(readText(PACKAGE_JSON_PATH)) as { version?: string };
  return computeReleaseVersion(
    packageJson.version || "1.0.0",
    readCommitCount() + readCommitOffset()
  );
}

function syncVersion(version: string): string[] {
  const changed: string[] = [];
  if (writeIfChanged(PACKAGE_JSON_PATH, replaceJsonVersion(readText(PACKAGE_JSON_PATH), version))) {
    changed.push("package.json");
  }
  if (
    writeIfChanged(UI_PACKAGE_JSON_PATH, replaceJsonVersion(readText(UI_PACKAGE_JSON_PATH), version))
  ) {
    changed.push("ui/package.json");
  }
  if (
    writeIfChanged(CARGO_TOML_PATH, replaceCargoTomlVersion(readText(CARGO_TOML_PATH), version))
  ) {
    changed.push("src-tauri/Cargo.toml");
  }
  if (
    writeIfChanged(TAURI_CONFIG_PATH, replaceJsonVersion(readText(TAURI_CONFIG_PATH), version))
  ) {
    changed.push("src-tauri/tauri.conf.json");
  }
  return changed;
}

function main(): void {
  const command = process.argv[2] || "print";
  const version = resolveVersion();

  if (command === "print") {
    console.log(version);
    return;
  }

  if (command === "sync") {
    const changed = syncVersion(version);
    console.log(version);
    if (changed.length > 0) {
      console.error(`Synced version in: ${changed.join(", ")}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main();
