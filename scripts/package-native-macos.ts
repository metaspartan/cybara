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
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { buildSidecar } from "./build-sidecar";
import { smokeSidecarUi } from "./smoke-tauri-sidecar-ui";

const ROOT = join(import.meta.dirname, "..");
const SWIFT_PRODUCT_NAME = "Cybara";
const APP_NAME = "CybaraNative";
const APP_DISPLAY_NAME = "Cybara Native";
const APP_BUNDLE_NAME = `${APP_NAME}.app`;
const APP_PACKAGE_PATH = join(ROOT, "apps", "macos", "Cybara");
const RELEASE_ROOT = join(ROOT, "release", "native-macos");
const SIDEcar_RELEASE_PATH = join(ROOT, "release", "cybara");
const SIDEcar_WASM_PATH = join(ROOT, "release", "secp256k1.wasm");
const SIDEcar_ONNX_PATH = join(ROOT, "release", "onnxruntime");
const SIDEcar_NODE_MODULES_PATH = join(ROOT, "release", "node_modules");
const SIDEcar_RUNTIME_PATH = join(ROOT, "release", "runtime");
const SIDEcar_CUA_DRIVER_PATH = join(ROOT, "release", "cua-driver");
const SIDEcar_PLUGINS_PATH = join(ROOT, "release", "plugins");
const UI_DIST_PATH = join(ROOT, "ui", "dist");
const ICON_SOURCE_PATH = join(ROOT, "cybara.png");

export type NativeMacOSArch = "arm64" | "x86_64";

export function resolveNativeMacOSArch(archName: string): NativeMacOSArch {
  if (archName === "arm64") return "arm64";
  if (archName === "x64" || archName === "x86_64") return "x86_64";
  throw new Error(`Unsupported macOS architecture: ${archName}`);
}

export function resolveNativeMacOSSigningIdentity(value: string | undefined): string {
  return value?.trim() || "-";
}

export function getNativeMacOSArtifactBaseName(version: string, arch: NativeMacOSArch): string {
  return `CybaraNative-v${version}-${arch}`;
}

export function createNativeMacOSInfoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_DISPLAY_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.cybara.native</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_DISPLAY_NAME}</string>
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
  <key>LSSupportsOpeningDocumentsInPlace</key>
  <true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>Cybara Source File</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>LSHandlerRank</key>
      <string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.text</string>
        <string>public.source-code</string>
      </array>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>txt</string><string>md</string><string>markdown</string>
        <string>json</string><string>jsonc</string><string>js</string><string>jsx</string>
        <string>mjs</string><string>cjs</string><string>ts</string><string>tsx</string>
        <string>html</string><string>htm</string><string>css</string><string>scss</string>
        <string>less</string><string>py</string><string>rs</string><string>go</string>
        <string>java</string><string>kt</string><string>swift</string><string>c</string>
        <string>h</string><string>cc</string><string>cpp</string><string>hpp</string>
        <string>cs</string><string>rb</string><string>php</string><string>sh</string>
        <string>bash</string><string>zsh</string><string>yaml</string><string>yml</string>
        <string>toml</string><string>ini</string><string>cfg</string><string>env</string>
        <string>xml</string><string>sql</string><string>lua</string><string>vue</string>
        <string>svelte</string><string>astro</string><string>dart</string><string>ex</string>
        <string>exs</string>
      </array>
    </dict>
  </array>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>NSCameraUsageDescription</key>
  <string>Cybara uses the camera when you ask an agent to capture a photo via the nodes tool.</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Cybara uses the microphone for voice/audio capture features you initiate.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Cybara transcribes speech on device when you choose native dictation.</string>
  <key>NSLocalNetworkUsageDescription</key>
  <string>Cybara discovers and securely pairs with your other Cybara installations on the local network.</string>
  <key>NSBonjourServices</key>
  <array>
    <string>_cybara-nearby._tcp</string>
  </array>
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

export interface NativeMacOSSidecarLayout {
  executableDir: string;
  resourceDir: string;
  uiDistDir: string;
  wasmPath: string;
  onnxRuntimeDir: string;
  nodeModulesDir: string;
  runtimeDir: string;
  cuaDriverDir: string;
  pluginsDir: string;
}

export function createNativeMacOSSidecarLayout(contentsPath: string): NativeMacOSSidecarLayout {
  const executableDir = join(contentsPath, "MacOS", "sidecar");
  const resourceDir = join(contentsPath, "Resources", "sidecar");
  return {
    executableDir,
    resourceDir,
    uiDistDir: join(resourceDir, "ui", "dist"),
    wasmPath: join(resourceDir, "secp256k1.wasm"),
    onnxRuntimeDir: join(resourceDir, "onnxruntime"),
    nodeModulesDir: join(resourceDir, "node_modules"),
    runtimeDir: join(resourceDir, "runtime"),
    cuaDriverDir: join(resourceDir, "cua-driver"),
    pluginsDir: join(resourceDir, "plugins"),
  };
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

function copySwiftResourceBundles(swiftBinDir: string, resourcesPath: string): void {
  const resourceBundles = readdirSync(swiftBinDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".bundle") || name.endsWith(".resources"));

  for (const bundleName of resourceBundles) {
    copyDirectory(join(swiftBinDir, bundleName), join(resourcesPath, bundleName));
  }
}

function removeAppleDoubleFiles(path: string): void {
  if (!existsSync(path)) return;
  const entry = statSync(path);
  if (!entry.isDirectory()) return;

  for (const child of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, child.name);
    if (child.name.startsWith("._")) {
      rmSync(childPath, { recursive: true, force: true });
      continue;
    }
    if (child.isDirectory()) {
      removeAppleDoubleFiles(childPath);
    }
  }
}

export function stripAppleMetadata(path: string): void {
  removeAppleDoubleFiles(path);
  if (process.platform !== "darwin" || !existsSync(path)) return;

  const result = Bun.spawnSync(["xattr", "-cr", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.toString().trim() || result.stdout.toString().trim();
    if (message) {
      console.warn(`Unable to strip extended attributes from ${path}: ${message}`);
    }
  }
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

const MACH_O_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
]);

export function isMachOFile(path: string): boolean {
  try {
    const header = readFileSync(path).subarray(0, 4);
    return header.length === 4 && MACH_O_MAGICS.has(header.readUInt32BE(0));
  } catch {
    return false;
  }
}

export function findNestedSignables(contentsPath: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const hasNativeExtension = /\.(dylib|node|so)$/.test(entry.name);
        const isExecutable = (statSync(full).mode & 0o111) !== 0;
        if (hasNativeExtension || (isExecutable && isMachOFile(full))) {
          results.push(full);
        }
      }
    }
  };
  walk(contentsPath);
  return results.sort((a, b) => {
    const depth = b.split("/").length - a.split("/").length;
    return depth === 0 ? a.localeCompare(b) : depth;
  });
}

async function codesignBundle(bundlePath: string, identity: string): Promise<void> {
  const ent = ENTITLEMENTS_PATH;
  const contentsPath = join(bundlePath, "Contents");
  stripAppleMetadata(bundlePath);

  const nestedSignables = findNestedSignables(contentsPath);
  if (nestedSignables.length > 0) {
    console.log(`   signing ${nestedSignables.length} nested Mach-O file(s)`);
  }
  for (const signable of nestedSignables) {
    await codesignPath(signable, identity);
  }

  await codesignPath(join(contentsPath, "MacOS", "sidecar", "cybara"), identity, ent);
  await codesignPath(join(contentsPath, "MacOS", APP_NAME), identity, ent);
  await codesignPath(bundlePath, identity, ent);
}

async function codesignPath(
  path: string,
  identity: string,
  entitlementsPath?: string
): Promise<void> {
  const args = ["codesign", "--force", "--options", "runtime"];
  if (identity !== "-") args.push("--timestamp");
  if (entitlementsPath) args.push("--entitlements", entitlementsPath);
  args.push("--sign", identity, path);
  await runProcess(args);
}

async function createZipArchive(bundlePath: string, zipPath: string): Promise<void> {
  removeIfExists(zipPath);
  await $`ditto -c -k --sequesterRsrc --keepParent ${bundlePath} ${zipPath}`.quiet();
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runProcess(
  command: string[],
  options?: { allowFailure?: boolean }
): Promise<ProcessResult> {
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  const result = { exitCode, stdout, stderr };
  if (exitCode !== 0 && !options?.allowFailure) {
    throw new Error(
      `${command.join(" ")} failed with exit code ${exitCode}\n${stderr || stdout}`.trim()
    );
  }
  return result;
}

async function runNotaryTool(
  args: string[],
  options?: { allowFailure?: boolean }
): Promise<ProcessResult> {
  return runProcess(["xcrun", "notarytool", ...args], options);
}

function parseJSONRecord(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  throw new Error(`Unable to parse ${label} JSON: ${raw.trim() || "<empty>"}`);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveNotaryTimeoutMinutes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

export function resolveNotaryPollSeconds(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 10 ? parsed : 30;
}

async function printNotaryLog(submissionId: string, notaryProfile: string): Promise<void> {
  const log = await runNotaryTool(
    ["log", submissionId, "--keychain-profile", notaryProfile, "--output-format", "json"],
    { allowFailure: true }
  );
  const output = [log.stdout.trim(), log.stderr.trim()].filter(Boolean).join("\n");
  if (output) {
    console.error(`[notary] Log for ${submissionId}:\n${output}`);
  } else {
    console.error(`[notary] No diagnostic log was returned for ${submissionId}.`);
  }
}

async function notarizeBundle(
  bundlePath: string,
  zipPath: string,
  notaryProfile: string
): Promise<void> {
  await createZipArchive(bundlePath, zipPath);
  console.log("   submitting app zip to Apple notary service...");
  const submit = await runNotaryTool([
    "submit",
    zipPath,
    "--keychain-profile",
    notaryProfile,
    "--output-format",
    "json",
  ]);
  const submitJSON = parseJSONRecord(submit.stdout, "notary submission");
  const submissionId = stringField(submitJSON, "id");
  if (!submissionId) {
    throw new Error(`Apple notary submission did not return an id: ${submit.stdout.trim()}`);
  }

  const timeoutMinutes = resolveNotaryTimeoutMinutes(
    process.env.CYBARA_MACOS_NOTARY_TIMEOUT_MINUTES
  );
  const pollSeconds = resolveNotaryPollSeconds(process.env.CYBARA_MACOS_NOTARY_POLL_SECONDS);
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastStatus = "Submitted";

  console.log(
    `   notary submission id ${submissionId}; polling every ${pollSeconds}s for up to ${timeoutMinutes}m`
  );

  while (Date.now() < deadline) {
    const info = await runNotaryTool([
      "info",
      submissionId,
      "--keychain-profile",
      notaryProfile,
      "--output-format",
      "json",
    ]);
    const infoJSON = parseJSONRecord(info.stdout, "notary info");
    const status = stringField(infoJSON, "status") ?? "Unknown";
    const summary =
      stringField(infoJSON, "statusSummary") ?? stringField(infoJSON, "message") ?? "";
    lastStatus = summary ? `${status}: ${summary}` : status;
    console.log(`   notary ${submissionId}: ${lastStatus}`);

    switch (status.toLowerCase()) {
      case "accepted":
        await $`xcrun stapler staple ${bundlePath}`;
        return;
      case "invalid":
      case "rejected":
        await printNotaryLog(submissionId, notaryProfile);
        throw new Error(`Apple notarization ${status.toLowerCase()} for ${submissionId}.`);
      default:
        await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
    }
  }

  throw new Error(
    `Apple notarization did not finish within ${timeoutMinutes} minutes for ${submissionId}. Last status: ${lastStatus}`
  );
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
  const sidecarLayout = createNativeMacOSSidecarLayout(contentsPath);

  console.log(`\n🧊 Packaging native macOS app (${arch})\n`);

  ensureDirectory(RELEASE_ROOT);
  ensureDirectory(artifactDir);

  console.log("🎨 Building UI...");
  await $`cd ${ROOT} && bun run ui:build`.quiet();

  console.log("⚡ Building sidecar...");
  await buildSidecar();
  console.log("🩺 Verifying sidecar version...");
  await smokeSidecarUi(SIDEcar_RELEASE_PATH, version);

  console.log("🧱 Building SwiftUI shell...");
  await $`cd ${ROOT} && swift build --package-path ${APP_PACKAGE_PATH} -c release`.quiet();
  const swiftBinDir = await readSwiftReleaseBinPath();
  const swiftExecutablePath = join(swiftBinDir, SWIFT_PRODUCT_NAME);

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
  ensureDirectory(sidecarLayout.executableDir);
  ensureDirectory(sidecarLayout.resourceDir);

  cpSync(swiftExecutablePath, join(macOSPath, APP_NAME));
  chmodSync(join(macOSPath, APP_NAME), 0o755);
  copySwiftResourceBundles(swiftBinDir, resourcesPath);

  cpSync(SIDEcar_RELEASE_PATH, join(sidecarLayout.executableDir, "cybara"));
  chmodSync(join(sidecarLayout.executableDir, "cybara"), 0o755);

  if (existsSync(SIDEcar_WASM_PATH)) {
    cpSync(SIDEcar_WASM_PATH, sidecarLayout.wasmPath);
  }

  if (existsSync(SIDEcar_ONNX_PATH)) {
    copyDirectory(SIDEcar_ONNX_PATH, sidecarLayout.onnxRuntimeDir);
  }

  if (existsSync(SIDEcar_NODE_MODULES_PATH)) {
    copyDirectory(SIDEcar_NODE_MODULES_PATH, sidecarLayout.nodeModulesDir);
  }

  if (existsSync(SIDEcar_RUNTIME_PATH)) {
    copyDirectory(SIDEcar_RUNTIME_PATH, sidecarLayout.runtimeDir);
  }

  if (existsSync(SIDEcar_CUA_DRIVER_PATH)) {
    copyDirectory(SIDEcar_CUA_DRIVER_PATH, sidecarLayout.cuaDriverDir);
  }

  if (existsSync(SIDEcar_PLUGINS_PATH)) {
    copyDirectory(SIDEcar_PLUGINS_PATH, sidecarLayout.pluginsDir);
  }

  ensureDirectory(dirname(sidecarLayout.uiDistDir));
  copyDirectory(UI_DIST_PATH, sidecarLayout.uiDistDir);

  writeFileSync(join(contentsPath, "Info.plist"), createNativeMacOSInfoPlist(version), "utf8");
  writeFileSync(join(contentsPath, "PkgInfo"), "APPL????", "utf8");
  await createAppIcon(join(resourcesPath, "AppIcon.icns"));

  const signingIdentity = resolveNativeMacOSSigningIdentity(process.env.CYBARA_MACOS_SIGN_IDENTITY);
  const notaryProfile = process.env.CYBARA_MACOS_NOTARY_KEYCHAIN_PROFILE?.trim();

  console.log(
    signingIdentity === "-" ? "✍️ Ad-hoc codesigning bundle..." : "✍️ Codesigning bundle..."
  );
  await codesignBundle(bundlePath, signingIdentity);

  if (notaryProfile) {
    if (signingIdentity === "-") {
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
