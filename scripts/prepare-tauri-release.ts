#!/usr/bin/env bun

import { writeFileSync } from "fs";
import { join } from "path";

import { getReleaseRepository } from "../src/core/build-info";
import {
  buildTauriReleaseConfigPatch,
  validateTauriReleaseSigningConfig,
} from "../src/core/versioning";

const ROOT = join(import.meta.dirname, "..");
const OUTPUT_PATH = join(ROOT, "src-tauri", "tauri.release.conf.json");

function resolveUpdaterPublicKey(): string {
  const publicKey =
    process.env.CYBARA_TAURI_UPDATER_PUBKEY?.trim() || process.env.TAURI_SIGNING_PUBLIC_KEY?.trim();
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim() || "";
  const errors = validateTauriReleaseSigningConfig(publicKey || "", privateKey);
  if (errors.length > 0) {
    throw new Error(
      `Invalid Tauri updater signing configuration: ${errors.join("; ")}. ` +
        "Set TAURI_SIGNING_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY to the established " +
        "production keypair before preparing a release."
    );
  }
  return publicKey || "";
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
