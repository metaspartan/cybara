#!/usr/bin/env bun

import { join } from "path";
import {
  buildNixRelease,
  isCurrentNixRelease,
  NIX_RELEASE_TARGETS,
  type NixReleaseHashes,
  parseSha256Sidecar,
  readNixReleaseVersion,
  sha256HexToSri,
} from "../src/core/nix-release";

const ROOT = join(import.meta.dirname, "..");
const RELEASE_PATH = join(ROOT, "nix", "release.nix");

async function main(): Promise<void> {
  const version = process.argv[2]?.trim().replace(/^v/i, "");
  const checksumDirectory = process.argv[3]?.trim();
  if (!version || !checksumDirectory) {
    throw new Error("Usage: sync-nix-release.ts <version> <checksum-directory>");
  }

  const current = await Bun.file(RELEASE_PATH).text();
  if (!isCurrentNixRelease(current, version)) {
    const currentVersion = readNixReleaseVersion(current);
    console.log(`Skipped stale Nix hash sync for ${version}; current version is ${currentVersion}`);
    return;
  }

  const hashes = {} as NixReleaseHashes;
  for (const target of NIX_RELEASE_TARGETS) {
    const filename = `cybara-v${version}-${target.asset}-cli.sha256`;
    const content = await Bun.file(join(checksumDirectory, filename)).text();
    hashes[target.system] = sha256HexToSri(parseSha256Sidecar(content));
  }

  const next = buildNixRelease(version, hashes);
  if (next === current) {
    console.log(`Nix release ${version} is already synchronized`);
    return;
  }
  await Bun.write(RELEASE_PATH, next);
  console.log(`Synchronized Nix hashes for ${version}`);
}

await main();
