#!/usr/bin/env bun

import { $ } from "bun";
import { createHash } from "crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { buildSidecar } from "./build-sidecar";

const ROOT = join(import.meta.dirname, "..");
const APP_NAME = "Cybara";
const APP_BUNDLE_NAME = `${APP_NAME}.app`;
const APP_PACKAGE_PATH = join(ROOT, "apps", "macos", "Cybara");
const RELEASE_ROOT = join(ROOT, "release", "native-macos");
const SIDEcar_RELEASE_PATH = join(ROOT, "release", "cybara");
const SIDEcar_WASM_PATH = join(ROOT, "release", "secp256k1.wasm");
const SIDEcar_ONNX_PATH = join(ROOT, "release", "onnxruntime");
const UI_DIST_PATH = join(ROOT, "ui", "dist");
const ICON_SOURCE_PATH = join(ROOT, "cybara.png");

export type NativeMacOSArch = "arm64" | "x86_64";

export function resolveNativeMacOSArch(archName: string): NativeMacOSArch {
  if (archName === "arm64") return "arm64";
  if (archName === "x64" || archName === "x86_64") return "x86_64";
  throw new Error(`Unsupported macOS architecture: ${archName}`);
}

export function getNativeMacOSArtifactBaseName(
  version: string,
  arch: NativeMacOSArch
): string {
  return `Cybara-native-macos-${arch}-${version}`;
}

export function createNativeMacOSInfoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Cybara</string>
  <key>CFBundleExecutable</key>
  <string>Cybara</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.cybara.native</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Cybara</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>NSCameraUsageDescription</key>
  <string>Cybara uses the camera when you ask an agent to capture a photo via the nodes tool.</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Cybara uses the microphone for voice/audio capture features you initiate.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Cybara controls other apps (e.g. Finder) only when you ask an agent to via computer use.</string>
  <key>NSDesktopFolderUsageDescription</key>
  <string>Cybara reads files you point it at in agent tasks.</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>com.cybara.desktop</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>cybara</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
`;
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return pkg.version?.trim() || "0.0.0";
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function removeIfExists(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function copyDirectory(sourcePath: string, targetPath: string): void {
  removeIfExists(targetPath);
  ensureDirectory(dirname(targetPath));
  cpSync(sourcePath, targetPath, { recursive: true });
}

async function createAppIcon(outputPath: string): Promise<void> {
  if (!existsSync(ICON_SOURCE_PATH)) {
    throw new Error(`App icon source is missing at ${ICON_SOURCE_PATH}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "cybara-iconset-"));
  const iconsetDir = join(tempRoot, "AppIcon.iconset");
  ensureDirectory(iconsetDir);

  const iconVariants: Array<[number, string]> = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];

  try {
    for (const [size, fileName] of iconVariants) {
      await $`sips -z ${size} ${size} ${ICON_SOURCE_PATH} --out ${join(iconsetDir, fileName)}`.quiet();
    }
    await $`iconutil -c icns ${iconsetDir} -o ${outputPath}`.quiet();
  } finally {
    removeIfExists(tempRoot);
  }
}

async function readSwiftReleaseBinPath(): Promise<string> {
  const result = Bun.spawnSync(
    ["swift", "build", "--package-path", APP_PACKAGE_PATH, "-c", "release", "--show-bin-path"],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || "swift build --show-bin-path failed";
    throw new Error(message);
  }

  const path = result.stdout.toString().trim();
  if (!path) {
    throw new Error("Swift build output path was empty");
  }
  return path;
}

const ENTITLEMENTS_PATH = join(APP_PACKAGE_PATH, "Cybara.entitlements");

/// Collect nested Mach-O binaries (dylibs, .node addons, .so) bundled with the
/// sidecar. Notarization rejects any unsigned Mach-O, so every one must be
/// signed inner-first before the executables and the bundle itself.
function findNestedSignables(macOSPath: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(dylib|node|so)$/.test(entry.name)) {
        results.push(full);
      }
    }
  };
  walk(macOSPath);
  return results;
}

async function codesignBundle(bundlePath: string, identity: string): Promise<void> {
  // Sign inner-out, applying the hardened-runtime entitlements (JIT/network/
  // capture) to the executables so the Bun sidecar's JS engine can run and the
  // app can request camera/screen/automation permissions when used.
  const ent = ENTITLEMENTS_PATH;
  const macOSPath = join(bundlePath, "Contents", "MacOS");

  // 1. Nested libraries/addons (onnxruntime dylib, .node binding, etc.).
  for (const signable of findNestedSignables(macOSPath)) {
    await $`codesign --force --timestamp --options runtime --sign ${identity} ${signable}`.quiet();
  }

  // 2. The bundled sidecar executable (Bun-compiled JS engine needs the
  //    JIT/unsigned-memory entitlements).
  await $`codesign --force --timestamp --options runtime --entitlements ${ent} --sign ${identity} ${join(macOSPath, "sidecar", "cybara")}`.quiet();
  // 3. The main app executable.
  await $`codesign --force --timestamp --options runtime --entitlements ${ent} --sign ${identity} ${join(macOSPath, APP_NAME)}`.quiet();
  // 4. The bundle last, so the seal covers everything inside.
  await $`codesign --force --timestamp --options runtime --entitlements ${ent} --sign ${identity} ${bundlePath}`.quiet();
}

async function createZipArchive(bundlePath: string, zipPath: string): Promise<void> {
  removeIfExists(zipPath);
  await $`ditto -c -k --sequesterRsrc --keepParent ${bundlePath} ${zipPath}`.quiet();
}

async function notarizeBundle(
  bundlePath: string,
  zipPath: string,
  notaryProfile: string
): Promise<void> {
  await createZipArchive(bundlePath, zipPath);
  await $`xcrun notarytool submit ${zipPath} --keychain-profile ${notaryProfile} --wait`.quiet();
  await $`xcrun stapler staple ${bundlePath}`.quiet();
}

function writeSha256(zipPath: string, shaPath: string): void {
  const digest = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  writeFileSync(shaPath, `${digest}  ${basename(zipPath)}\n`, "utf8");
}

export interface NativeMacOSPackageResult {
  arch: NativeMacOSArch;
  version: string;
  bundlePath: string;
  zipPath: string;
  checksumPath: string;
}

export async function packageNativeMacOSApp(): Promise<NativeMacOSPackageResult> {
  if (process.platform !== "darwin") {
    throw new Error("Native macOS packaging only runs on macOS hosts.");
  }

  const arch = resolveNativeMacOSArch(process.arch);
  const version = readPackageVersion();
  const artifactBaseName = getNativeMacOSArtifactBaseName(version, arch);
  const artifactDir = join(RELEASE_ROOT, arch);
  const bundlePath = join(artifactDir, APP_BUNDLE_NAME);
  const zipPath = join(artifactDir, `${artifactBaseName}.zip`);
  const checksumPath = join(artifactDir, `${artifactBaseName}.sha256`);
  const contentsPath = join(bundlePath, "Contents");
  const macOSPath = join(contentsPath, "MacOS");
  const resourcesPath = join(contentsPath, "Resources");
  const bundledSidecarPath = join(macOSPath, "sidecar");

  console.log(`\n🧊 Packaging native macOS app (${arch})\n`);

  ensureDirectory(RELEASE_ROOT);
  ensureDirectory(artifactDir);

  console.log("🎨 Building UI...");
  await $`cd ${ROOT} && bun run ui:build`.quiet();

  console.log("⚡ Building sidecar...");
  await buildSidecar();

  console.log("🧱 Building SwiftUI shell...");
  await $`cd ${ROOT} && swift build --package-path ${APP_PACKAGE_PATH} -c release`.quiet();
  const swiftBinDir = await readSwiftReleaseBinPath();
  const swiftExecutablePath = join(swiftBinDir, APP_NAME);

  if (!existsSync(swiftExecutablePath)) {
    throw new Error(`Swift executable not found at ${swiftExecutablePath}`);
  }
  if (!existsSync(SIDEcar_RELEASE_PATH)) {
    throw new Error(`Bundled sidecar not found at ${SIDEcar_RELEASE_PATH}`);
  }
  if (!existsSync(join(UI_DIST_PATH, "index.html"))) {
    throw new Error(`Built UI dist not found at ${UI_DIST_PATH}`);
  }

  removeIfExists(bundlePath);
  ensureDirectory(macOSPath);
  ensureDirectory(resourcesPath);
  ensureDirectory(bundledSidecarPath);

  cpSync(swiftExecutablePath, join(macOSPath, APP_NAME));
  chmodSync(join(macOSPath, APP_NAME), 0o755);

  cpSync(SIDEcar_RELEASE_PATH, join(bundledSidecarPath, "cybara"));
  chmodSync(join(bundledSidecarPath, "cybara"), 0o755);

  if (existsSync(SIDEcar_WASM_PATH)) {
    cpSync(SIDEcar_WASM_PATH, join(bundledSidecarPath, "secp256k1.wasm"));
  }

  if (existsSync(SIDEcar_ONNX_PATH)) {
    copyDirectory(SIDEcar_ONNX_PATH, join(bundledSidecarPath, "onnxruntime"));
  }

  ensureDirectory(join(bundledSidecarPath, "ui"));
  copyDirectory(UI_DIST_PATH, join(bundledSidecarPath, "ui", "dist"));

  writeFileSync(join(contentsPath, "Info.plist"), createNativeMacOSInfoPlist(version), "utf8");
  writeFileSync(join(contentsPath, "PkgInfo"), "APPL????", "utf8");
  await createAppIcon(join(resourcesPath, "AppIcon.icns"));

  const signingIdentity = process.env.CYBARA_MACOS_SIGN_IDENTITY?.trim();
  const notaryProfile = process.env.CYBARA_MACOS_NOTARY_KEYCHAIN_PROFILE?.trim();

  if (signingIdentity) {
    console.log("✍️ Codesigning bundle...");
    await codesignBundle(bundlePath, signingIdentity);
  }

  if (notaryProfile) {
    if (!signingIdentity) {
      throw new Error(
        "CYBARA_MACOS_NOTARY_KEYCHAIN_PROFILE requires CYBARA_MACOS_SIGN_IDENTITY to be set."
      );
    }
    console.log("🧾 Notarizing bundle...");
    await notarizeBundle(bundlePath, zipPath, notaryProfile);
  }

  console.log("📦 Creating zip artifact...");
  await createZipArchive(bundlePath, zipPath);
  writeSha256(zipPath, checksumPath);

  console.log(`   ✓ App bundle: ${bundlePath}`);
  console.log(`   ✓ Zip artifact: ${zipPath}`);
  console.log(`   ✓ SHA-256: ${checksumPath}`);

  return {
    arch,
    version,
    bundlePath,
    zipPath,
    checksumPath,
  };
}

if (import.meta.main) {
  packageNativeMacOSApp().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
