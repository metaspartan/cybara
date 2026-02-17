#!/usr/bin/env bun
import { $ } from "bun";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { platform, arch } from "os";

const TAURI_BIN_DIR = join(import.meta.dirname, "..", "src-tauri", "bin");
const RELEASE_DIR = join(import.meta.dirname, "..", "release");

export interface Target {
  bunTarget: string;
  tauriSuffix: string;
}

export function getHostTargetFor(platformName: string, archName: string): Target {
  const p = platformName;
  const a = archName;
  if (p === "darwin" && a === "arm64")
    return { bunTarget: "bun-darwin-arm64", tauriSuffix: "aarch64-apple-darwin" };
  if (p === "darwin" && a === "x64")
    return { bunTarget: "bun-darwin-x64", tauriSuffix: "x86_64-apple-darwin" };
  if (p === "linux" && a === "x64")
    return { bunTarget: "bun-linux-x64", tauriSuffix: "x86_64-unknown-linux-gnu" };
  if (p === "linux" && a === "arm64")
    return { bunTarget: "bun-linux-arm64", tauriSuffix: "aarch64-unknown-linux-gnu" };
  if (p === "win32" && a === "x64")
    return { bunTarget: "bun-windows-x64", tauriSuffix: "x86_64-pc-windows-msvc" };
  if (p === "win32" && a === "arm64")
    return { bunTarget: "bun-windows-arm64", tauriSuffix: "aarch64-pc-windows-msvc" };

  throw new Error(`Unsupported platform: ${p}/${a}`);
}

export function getHostTarget(): Target {
  return getHostTargetFor(platform(), arch());
}

export async function copyFilePortable(sourcePath: string, targetPath: string): Promise<void> {
  await Bun.write(targetPath, Bun.file(sourcePath));
}

export async function buildSidecar(): Promise<void> {
  const target = getHostTarget();
  const isWindows = platform() === "win32";
  const ext = isWindows ? ".exe" : "";
  const sidecarName = `cybara-${target.tauriSuffix}${ext}`;
  const releasePath = join(RELEASE_DIR, `cybara${ext}`);
  const sidecarPath = join(TAURI_BIN_DIR, sidecarName);

  console.log(`\n⚡ Building Cybara sidecar for ${target.tauriSuffix}\n`);

  for (const dir of [RELEASE_DIR, TAURI_BIN_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  await $`bun build src/index.ts --compile --target=${target.bunTarget} --outfile ${releasePath} --external electron`;
  await copyFilePortable(releasePath, sidecarPath);

  console.log(`\n✅ Sidecar built: ${sidecarPath}\n`);
}

if (import.meta.main) {
  buildSidecar().catch((err) => {
    console.error("❌ Build failed:", err);
    process.exit(1);
  });
}
