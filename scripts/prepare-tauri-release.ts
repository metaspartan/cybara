#!/usr/bin/env bun

import { writeFileSync } from "fs";
import { join } from "path";

import { getReleaseRepository } from "../src/core/build-info";
import { buildTauriReleaseConfigPatch } from "../src/core/versioning";

const ROOT = join(import.meta.dirname, "..");
const OUTPUT_PATH = join(ROOT, "src-tauri", "tauri.release.conf.json");

function resolveUpdaterPublicKey(): string {
  const publicKey =
    process.env.CYBARA_TAURI_UPDATER_PUBKEY?.trim() || process.env.TAURI_SIGNING_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error(
      "Missing Tauri updater public key. Without TAURI_SIGNING_PUBLIC_KEY the " +
        "release build cannot sign updater artifacts, so tauri-action will skip " +
        "latest.json and the desktop in-app updater will break for all users. " +
        "Generate a signing keypair (`bunx @tauri-apps/cli signer generate`), " +
        "then set the repo secrets TAURI_SIGNING_PUBLIC_KEY, " +
        "TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD " +
        "(see docs/desktop.md). Aborting release prep."
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
