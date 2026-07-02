#!/usr/bin/env bun

import { readFileSync } from "fs";

import {
  TAURI_WINDOWS_X64_RELEASE_PLATFORMS,
  validateTauriUpdaterManifest,
  type TauriUpdaterManifest,
} from "../src/core/versioning";

async function readManifest(source: string): Promise<TauriUpdaterManifest> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Could not fetch updater manifest from ${source}: HTTP ${response.status}`);
    }
    return (await response.json()) as TauriUpdaterManifest;
  }

  return JSON.parse(readFileSync(source, "utf-8")) as TauriUpdaterManifest;
}

function parseRequiredPlatforms(): readonly string[] {
  const raw = process.env.CYBARA_TAURI_REQUIRED_UPDATER_PLATFORMS?.trim();
  if (!raw) {
    return TAURI_WINDOWS_X64_RELEASE_PLATFORMS;
  }

  return raw
    .split(",")
    .map((platform) => platform.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const source =
    process.argv[2] ||
    "https://github.com/metaspartan/cybara/releases/latest/download/latest.json";
  const manifest = await readManifest(source);
  const requiredPlatforms = parseRequiredPlatforms();
  const validation = validateTauriUpdaterManifest(manifest, requiredPlatforms);

  if (!validation.ok) {
    const invalidEntryLabel =
      validation.invalidPlatforms.length === 1 ? "entry" : "entries";
    const details = [
      validation.missingPlatforms.length > 0
        ? `missing platform(s): ${validation.missingPlatforms.join(", ")}`
        : "",
      validation.invalidPlatforms.length > 0
        ? `invalid platform ${invalidEntryLabel}: ${validation.invalidPlatforms.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`Tauri updater manifest is not ready: ${details}`);
  }

  console.log(
    `Tauri updater manifest ${String(manifest.version || "unknown")} is ready for ${requiredPlatforms.join(", ")}`
  );
}

await main();
