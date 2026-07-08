#!/usr/bin/env bun

import { $ } from "bun";
import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const DIST_DIR = "dist";
const RELEASE_DIR = "release";
const BINARY_NAME = "cybara";

export async function runPackage(): Promise<void> {
  console.log("\n🚀 Cybara Packaging Script\n");

  console.log("📁 Cleaning release directory...");
  if (existsSync(RELEASE_DIR)) {
    rmSync(RELEASE_DIR, { recursive: true });
  }
  mkdirSync(RELEASE_DIR, { recursive: true });

  console.log("🎨 Building UI...");
  await $`cd ui && bun run build`.quiet();
  console.log("   ✓ UI built");

  console.log("📦 Building TypeScript...");
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR);
  }

  await $`bun build src/main.ts --outdir ${DIST_DIR} --target bun --external electron --external tiny-secp256k1`.quiet();
  console.log("   ✓ Main entry built");

  await $`bun build src/index.ts --outdir ${DIST_DIR} --target bun --external electron --external tiny-secp256k1`.quiet();
  console.log("   ✓ Server built");

  await $`bun build src/cli.tsx --outdir ${DIST_DIR} --target bun --external electron --external tiny-secp256k1`.quiet();
  console.log("   ✓ CLI built");

  console.log("📋 Preparing static assets...");
  const uiDistSrc = "ui/dist";
  const uiDistDest = join(DIST_DIR, "ui", "dist");
  if (existsSync(uiDistSrc)) {
    mkdirSync(join(DIST_DIR, "ui"), { recursive: true });
    cpSync(uiDistSrc, uiDistDest, { recursive: true });
    console.log("   ✓ UI assets copied");
  }

  console.log("⚡ Compiling standalone binary...");

  const platform = process.platform;
  const arch = process.arch;
  const binaryPath = join(RELEASE_DIR, BINARY_NAME);

  try {
    await $`bun build src/main.ts --compile --outfile ${binaryPath} --target bun --external electron`;
    console.log(`   ✓ Binary compiled: ${binaryPath}`);
  } catch (error) {
    console.error("   ✗ Binary compilation failed:", error);
    process.exit(1);
  }

  const releaseUiPath = join(RELEASE_DIR, "ui", "dist");
  mkdirSync(join(RELEASE_DIR, "ui"), { recursive: true });
  cpSync(uiDistSrc, releaseUiPath, { recursive: true });
  console.log("   ✓ UI assets bundled with binary");

  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  writeFileSync(join(RELEASE_DIR, "VERSION"), pkg.version);

  const binarySize = statSync(binaryPath).size;
  const uiSize = getTotalSize(releaseUiPath);

  console.log(`                                                    
✨ Cybara Packaged Successfully!

Binary:    ${binaryPath.padEnd(45)}                         
Size:      ${formatSize(binarySize).padEnd(45)}             
UI Assets: ${formatSize(uiSize).padEnd(45)}                 
Platform:  ${(platform + "/" + arch).padEnd(45)}            
Version:   ${pkg.version.padEnd(45)}                        
                                                              
Run with:  ./${RELEASE_DIR}/${BINARY_NAME}                                                                              
`);
}

export function getTotalSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      total += getTotalSize(path);
    } else {
      total += stat.size;
    }
  }
  return total;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

if (import.meta.main) {
  runPackage().catch(console.error);
}
