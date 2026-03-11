#!/usr/bin/env bun

import { writeFileSync } from "fs";
import { join } from "path";

import { getReleaseRepository } from "../src/core/build-info";
import { buildTauriReleaseConfigPatch } from "../src/core/versioning";

const ROOT = join(import.meta.dirname, "..");
const OUTPUT_PATH = join(ROOT, "src-tauri", "tauri.release.conf.json");

function resolveUpdaterPublicKey(): string {
  const publicKey =
    process.env.CYBARA_TAURI_UPDATER_PUBKEY?.trim() ||
    process.env.TAURI_SIGNING_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error(
      "Missing updater public key. Set CYBARA_TAURI_UPDATER_PUBKEY or TAURI_SIGNING_PUBLIC_KEY."
    );
  }
  return publicKey;
}

function main(): void {
  const repository = getReleaseRepository();
  const endpointOverride = process.env.CYBARA_TAURI_UPDATER_ENDPOINT?.trim() || null;
  const config = buildTauriReleaseConfigPatch(
    repository,
    resolveUpdaterPublicKey(),
    endpointOverride
  );

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
