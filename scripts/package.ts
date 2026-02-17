#!/usr/bin/env bun
/**
 * Cybara Build Script
 *
 * Creates a standalone binary that includes:
 * - Server (API + WebUI serving)
 * - CLI/TUI interface
 * - Embedded static UI files
 *
 * Usage: bun run package
 */

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

  // Step 1: Clean release directory
  console.log("📁 Cleaning release directory...");
  if (existsSync(RELEASE_DIR)) {
    rmSync(RELEASE_DIR, { recursive: true });
  }
  mkdirSync(RELEASE_DIR, { recursive: true });

  // Step 2: Build UI
  console.log("🎨 Building UI...");
  await $`cd ui && bun run build`.quiet();
  console.log("   ✓ UI built");

  // Step 3: Build TypeScript
  console.log("📦 Building TypeScript...");
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR);
  }

  // Build main entry point
  await $`bun build src/main.ts --outdir ${DIST_DIR} --target bun --external electron`.quiet();
  console.log("   ✓ Main entry built");

  // Build server
  await $`bun build src/index.ts --outdir ${DIST_DIR} --target bun --external electron`.quiet();
  console.log("   ✓ Server built");

  // Build CLI
  await $`bun build src/cli.tsx --outdir ${DIST_DIR} --target bun --external electron`.quiet();
  console.log("   ✓ CLI built");

  // Step 4: Copy UI dist to be embedded
  console.log("📋 Preparing static assets...");
  const uiDistSrc = "ui/dist";
  const uiDistDest = join(DIST_DIR, "ui", "dist");
  if (existsSync(uiDistSrc)) {
    mkdirSync(join(DIST_DIR, "ui"), { recursive: true });
    cpSync(uiDistSrc, uiDistDest, { recursive: true });
    console.log("   ✓ UI assets copied");
  }

  // Step 5: Create the standalone binary with embedded files
  console.log("⚡ Compiling standalone binary...");

  // Get target platform
  const platform = process.platform;
  const arch = process.arch;
  const binaryPath = join(RELEASE_DIR, BINARY_NAME);

  // Compile with bun including embedded assets
  // Using --compile to create single executable
  try {
    await $`bun build src/main.ts --compile --outfile ${binaryPath} --target bun --external electron`;
    console.log(`   ✓ Binary compiled: ${binaryPath}`);
  } catch (error) {
    console.error("   ✗ Binary compilation failed:", error);
    process.exit(1);
  }

  // Step 6: Copy UI assets next to binary (fallback for file-based serving)
  const releaseUiPath = join(RELEASE_DIR, "ui", "dist");
  mkdirSync(join(RELEASE_DIR, "ui"), { recursive: true });
  cpSync(uiDistSrc, releaseUiPath, { recursive: true });
  console.log("   ✓ UI assets bundled with binary");

  // Step 7: Create VERSION file
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  writeFileSync(join(RELEASE_DIR, "VERSION"), pkg.version);

  // Step 8: Show results
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
