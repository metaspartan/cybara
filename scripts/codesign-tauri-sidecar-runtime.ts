#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { findNestedSignables, stripAppleMetadata } from "./package-native-macos";

const ROOT = join(import.meta.dirname, "..");
const TAURI_BIN_DIR = join(ROOT, "src-tauri", "bin");

export function resolveMacOSCodesignIdentity(
  env: Record<string, string | undefined> = process.env
): string | null {
  const identity =
    env.CYBARA_MACOS_SIGN_IDENTITY?.trim() ||
    env.MACOS_SIGN_IDENTITY?.trim() ||
    env.APPLE_SIGNING_IDENTITY?.trim();
  return identity || null;
}

export async function codesignTauriSidecarRuntime(
  rootPath = TAURI_BIN_DIR,
  identity = resolveMacOSCodesignIdentity()
): Promise<number> {
  if (process.platform !== "darwin") {
    console.log("Skipping Tauri sidecar runtime signing on non-macOS host.");
    return 0;
  }
  if (!existsSync(rootPath)) {
    console.log(`Skipping Tauri sidecar runtime signing; ${rootPath} does not exist.`);
    return 0;
  }
  if (!identity) {
    console.log("Skipping Tauri sidecar runtime signing; no macOS signing identity is configured.");
    return 0;
  }

  stripAppleMetadata(rootPath);
  const signables = findNestedSignables(rootPath);
  if (signables.length === 0) {
    console.log(`No nested native Tauri sidecar runtime files found in ${rootPath}.`);
    return 0;
  }

  console.log(`Signing ${signables.length} Tauri sidecar runtime file(s).`);
  for (const signable of signables) {
    await $`codesign --force --timestamp --options runtime --sign ${identity} ${signable}`.quiet();
  }
  return signables.length;
}

if (import.meta.main) {
  codesignTauriSidecarRuntime().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
