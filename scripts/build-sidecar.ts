#!/usr/bin/env bun
import { $ } from "bun";
import { mkdirSync, existsSync, cpSync, rmSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { platform, arch } from "os";
import { installBunRuntimeAt, type BunRuntimeTarget } from "../src/core/bun-runtime";

const TAURI_BIN_DIR = join(import.meta.dirname, "..", "src-tauri", "bin");
const RELEASE_DIR = join(import.meta.dirname, "..", "release");
const NODE_MODULES_ROOT = join(import.meta.dirname, "..", "node_modules");

export interface Target {
  bunTarget: BunRuntimeTarget;
  tauriSuffix: string;
}

export interface RuntimeTarget {
  platform: "darwin" | "linux" | "win32";
  arch: "arm64" | "x64";
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

export function getRuntimeTargetFor(target: Target): RuntimeTarget {
  if (target.tauriSuffix === "aarch64-apple-darwin") return { platform: "darwin", arch: "arm64" };
  if (target.tauriSuffix === "x86_64-apple-darwin") return { platform: "darwin", arch: "x64" };
  if (target.tauriSuffix === "x86_64-unknown-linux-gnu") return { platform: "linux", arch: "x64" };
  if (target.tauriSuffix === "aarch64-unknown-linux-gnu")
    return { platform: "linux", arch: "arm64" };
  if (target.tauriSuffix === "x86_64-pc-windows-msvc") return { platform: "win32", arch: "x64" };
  if (target.tauriSuffix === "aarch64-pc-windows-msvc") return { platform: "win32", arch: "arm64" };
  throw new Error(`Unsupported sidecar target: ${target.tauriSuffix}`);
}

export function getHostTarget(): Target {
  return getHostTargetFor(platform(), arch());
}

const BUN_TARGET_MAP: Record<string, Target> = {
  "bun-darwin-arm64": { bunTarget: "bun-darwin-arm64", tauriSuffix: "aarch64-apple-darwin" },
  "bun-darwin-x64": { bunTarget: "bun-darwin-x64", tauriSuffix: "x86_64-apple-darwin" },
  "bun-linux-x64": { bunTarget: "bun-linux-x64", tauriSuffix: "x86_64-unknown-linux-gnu" },
  "bun-linux-arm64": { bunTarget: "bun-linux-arm64", tauriSuffix: "aarch64-unknown-linux-gnu" },
  "bun-windows-x64": { bunTarget: "bun-windows-x64", tauriSuffix: "x86_64-pc-windows-msvc" },
  "bun-windows-arm64": { bunTarget: "bun-windows-arm64", tauriSuffix: "aarch64-pc-windows-msvc" },
};

export function resolveTarget(): Target {
  const explicit = process.env.CYBARA_SIDECAR_BUN_TARGET?.trim();
  if (explicit) {
    const target = BUN_TARGET_MAP[explicit];
    if (!target) throw new Error(`Unknown CYBARA_SIDECAR_BUN_TARGET: ${explicit}`);
    return target;
  }
  return getHostTarget();
}

export async function copyFilePortable(sourcePath: string, targetPath: string): Promise<void> {
  await Bun.write(targetPath, Bun.file(sourcePath));
}

function removeAndCopyDirectory(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

function copyDirectoryWithoutMaps(sourcePath: string, targetPath: string): void {
  if (existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    filter: (source) => !source.endsWith(".map"),
  });
}

function copyPackageJson(packageName: string, targetNodeModulesDir: string): void {
  const source = join(NODE_MODULES_ROOT, packageName, "package.json");
  if (!existsSync(source)) return;
  const target = join(targetNodeModulesDir, packageName, "package.json");
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function copyPackageDirectory(
  packageName: string,
  relativePath: string,
  targetNodeModulesDir: string,
  options?: { omitSourceMaps?: boolean }
): boolean {
  const source = join(NODE_MODULES_ROOT, packageName, relativePath);
  if (!existsSync(source)) return false;
  const target = join(targetNodeModulesDir, packageName, relativePath);
  if (options?.omitSourceMaps) {
    copyDirectoryWithoutMaps(source, target);
  } else {
    removeAndCopyDirectory(source, target);
  }
  return true;
}

function listOnnxNapiDirs(onnxRuntimeNodeRoot: string): string[] {
  const binDir = join(onnxRuntimeNodeRoot, "bin");
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .filter((name) => /^napi-v\d+$/.test(name))
    .sort((a, b) => Number(b.slice("napi-v".length)) - Number(a.slice("napi-v".length)));
}

export function findOnnxRuntimeNativeDir(
  onnxRuntimeNodeRoot: string,
  runtimeTarget: RuntimeTarget
): string | null {
  for (const napiDir of listOnnxNapiDirs(onnxRuntimeNodeRoot)) {
    const candidate = join(
      onnxRuntimeNodeRoot,
      "bin",
      napiDir,
      runtimeTarget.platform,
      runtimeTarget.arch
    );
    if (existsSync(join(candidate, "onnxruntime_binding.node"))) {
      return candidate;
    }
  }
  return null;
}

function copyOnnxRuntimeNodeRuntime(
  targetNodeModulesDir: string,
  runtimeTarget: RuntimeTarget
): string | null {
  const packageName = "onnxruntime-node";
  const sourceRoot = join(NODE_MODULES_ROOT, packageName);
  if (!existsSync(sourceRoot)) return null;

  copyPackageJson(packageName, targetNodeModulesDir);
  copyPackageDirectory(packageName, "dist", targetNodeModulesDir);

  const targetBinDir = join(targetNodeModulesDir, packageName, "bin");
  if (existsSync(targetBinDir)) rmSync(targetBinDir, { recursive: true, force: true });

  const nativeDir = findOnnxRuntimeNativeDir(sourceRoot, runtimeTarget);
  if (!nativeDir) return null;

  const napiDir = nativeDir.split(/[\\/]/).slice(-3, -2)[0] || "napi-v6";
  const targetNativeDir = join(
    targetNodeModulesDir,
    packageName,
    "bin",
    napiDir,
    runtimeTarget.platform,
    runtimeTarget.arch
  );
  removeAndCopyDirectory(nativeDir, targetNativeDir);
  return nativeDir;
}

function copyOnnxRuntimeSidecarFolder(
  nativeDir: string | null,
  destinationRoot: string,
  runtimeTarget: RuntimeTarget
): void {
  const onnxRuntimeRoot = join(destinationRoot, "onnxruntime");
  if (existsSync(onnxRuntimeRoot)) rmSync(onnxRuntimeRoot, { recursive: true, force: true });
  if (!nativeDir) return;
  const destination = join(onnxRuntimeRoot, runtimeTarget.platform, runtimeTarget.arch);
  removeAndCopyDirectory(nativeDir, destination);
}

function copyOptionalPackage(packageName: string, targetNodeModulesDir: string): boolean {
  const source = join(NODE_MODULES_ROOT, packageName);
  if (!existsSync(source)) return false;
  removeAndCopyDirectory(source, join(targetNodeModulesDir, packageName));
  return true;
}

export function getSharpRuntimePackageNames(runtimeTarget: RuntimeTarget): string[] {
  if (runtimeTarget.platform === "win32") {
    return [`@img/sharp-win32-${runtimeTarget.arch}`];
  }

  const suffix =
    runtimeTarget.platform === "darwin"
      ? `darwin-${runtimeTarget.arch}`
      : runtimeTarget.platform === "linux"
        ? `linux-${runtimeTarget.arch}`
        : null;

  if (suffix === null) return [];
  return [`@img/sharp-${suffix}`, `@img/sharp-libvips-${suffix}`];
}

function copySharpRuntime(targetNodeModulesDir: string, runtimeTarget: RuntimeTarget): boolean {
  const runtimePackages = getSharpRuntimePackageNames(runtimeTarget);
  if (runtimePackages.length === 0) return false;

  const sharpRoot = join(NODE_MODULES_ROOT, "sharp");
  if (!existsSync(sharpRoot)) return false;

  const availableRuntimePackages = runtimePackages.filter((packageName) =>
    existsSync(join(NODE_MODULES_ROOT, packageName))
  );
  if (availableRuntimePackages.length === 0) return false;

  copyOptionalPackage("sharp", targetNodeModulesDir);
  for (const packageName of availableRuntimePackages) {
    copyOptionalPackage(packageName, targetNodeModulesDir);
  }
  return true;
}

function copyTransformersRuntime(
  targetNodeModulesDir: string,
  runtimeTarget: RuntimeTarget
): string | null {
  copyPackageJson("@huggingface/transformers", targetNodeModulesDir);
  copyPackageDirectory("@huggingface/transformers", "dist", targetNodeModulesDir, {
    omitSourceMaps: true,
  });

  copyPackageJson("onnxruntime-common", targetNodeModulesDir);
  copyPackageDirectory("onnxruntime-common", "dist", targetNodeModulesDir, {
    omitSourceMaps: true,
  });

  copyPackageJson("onnxruntime-web", targetNodeModulesDir);
  copyPackageDirectory("onnxruntime-web", "dist", targetNodeModulesDir, { omitSourceMaps: true });

  // The node build of Transformers.js statically imports sharp. Copy it when
  // available for the release target; otherwise the runtime falls back to the
  // bundled ONNX Web/WASM build. Copying the whole @img scope would ship
  // host-architecture native libraries into cross-compiled macOS apps, which
  // makes notarization fail on unrelated binaries.
  copySharpRuntime(targetNodeModulesDir, runtimeTarget);

  return copyOnnxRuntimeNodeRuntime(targetNodeModulesDir, runtimeTarget);
}

export function patchedOnnxBindingSource(): string {
  return `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initOrt = exports.binding = void 0;
const fs = require("fs");
const path = require("path");
const onnxruntime_common_1 = require("onnxruntime-common");

function collectPackageBindingCandidates() {
  const candidates = [];
  const packageBinDir = path.join(__dirname, "..", "bin");
  if (!fs.existsSync(packageBinDir)) return candidates;
  for (const napiDir of fs.readdirSync(packageBinDir).filter((name) => /^napi-v\\d+$/.test(name)).sort().reverse()) {
    candidates.push(path.join(packageBinDir, napiDir, process.platform, process.arch, "onnxruntime_binding.node"));
  }
  return candidates;
}

function resolveOnnxBindingPath() {
  const resourceDir = process.env.CYBARA_RESOURCE_DIR;
  const candidates = [
    ...collectPackageBindingCandidates(),
    resourceDir && path.join(resourceDir, "onnxruntime", process.platform, process.arch, "onnxruntime_binding.node"),
    path.join(path.dirname(process.execPath), "onnxruntime", process.platform, process.arch, "onnxruntime_binding.node"),
    path.join(process.cwd(), "onnxruntime", process.platform, process.arch, "onnxruntime_binding.node"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && candidate.endsWith(".node")) {
      return candidate;
    }
  }

  throw new Error(\`onnxruntime binding not found; checked: \${candidates.join(", ")}\`);
}

exports.binding = require(resolveOnnxBindingPath());

let ortInitialized = false;
const initOrt = () => {
  if (!ortInitialized) {
    ortInitialized = true;
    let logLevel = 2;
    if (onnxruntime_common_1.env.logLevel) {
      switch (onnxruntime_common_1.env.logLevel) {
        case "verbose":
          logLevel = 0;
          break;
        case "info":
          logLevel = 1;
          break;
        case "warning":
          logLevel = 2;
          break;
        case "error":
          logLevel = 3;
          break;
        case "fatal":
          logLevel = 4;
          break;
        default:
          throw new Error(\`Unsupported log level: \${onnxruntime_common_1.env.logLevel}\`);
      }
    }
    exports.binding.initOrtOnce(logLevel, onnxruntime_common_1.Tensor);
  }
};
exports.initOrt = initOrt;
`.trim();
}

function patchCopiedOnnxBinding(targetNodeModulesDir: string): void {
  const bindingPath = join(targetNodeModulesDir, "onnxruntime-node", "dist", "binding.js");
  if (!existsSync(bindingPath)) return;
  writeFileSync(bindingPath, patchedOnnxBindingSource(), "utf8");
}

export async function buildSidecar(): Promise<void> {
  const target = resolveTarget();
  const runtimeTarget = getRuntimeTargetFor(target);
  const isWindows = target.tauriSuffix.includes("windows");
  const ext = isWindows ? ".exe" : "";
  const sidecarName = `cybara-${target.tauriSuffix}${ext}`;
  const releasePath = join(RELEASE_DIR, `cybara${ext}`);
  const sidecarPath = join(TAURI_BIN_DIR, sidecarName);
  const tauriDebugDir = join(import.meta.dirname, "..", "src-tauri", "target", "debug");
  const tauriDebugSidecarPath = join(tauriDebugDir, `cybara${ext}`);
  const uiDistPath = join(import.meta.dirname, "..", "ui", "dist");
  const sidecarUiDistPath = join(TAURI_BIN_DIR, "ui", "dist");
  const tauriDebugUiDistPath = join(tauriDebugDir, "ui", "dist");

  console.log(`\n⚡ Building Cybara sidecar for ${target.tauriSuffix}\n`);

  for (const dir of [RELEASE_DIR, TAURI_BIN_DIR, tauriDebugDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // tiny-secp256k1 loads secp256k1.wasm at runtime via readFileSync + import.meta.url.
  // bun build --compile doesn't embed .wasm files into the virtual FS, so we:
  // 1. Patch wasm_loader.js to fall back to the executable's directory
  // 2. Copy secp256k1.wasm alongside the compiled binary
  const wasmLoaderPath = join(
    import.meta.dirname,
    "..",
    "node_modules",
    "tiny-secp256k1",
    "lib",
    "wasm_loader.js"
  );
  const wasmSource = join(
    import.meta.dirname,
    "..",
    "node_modules",
    "tiny-secp256k1",
    "lib",
    "secp256k1.wasm"
  );
  let originalWasmLoader = "";
  const patchedWasmLoader = `
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as rand from "./rand.js";
import * as validate_error from "./validate_error.js";

function loadWasmBinary() {
  // Try import.meta.url first (works in dev/unbundled mode)
  try {
    const metaPath = fileURLToPath(new URL("secp256k1.wasm", import.meta.url));
    if (existsSync(metaPath)) return readFileSync(metaPath);
  } catch {}

  // Fallback: packaged desktop resource dir (Tauri bundles it there).
  const resourceDir = process.env.CYBARA_RESOURCE_DIR;
  if (resourceDir) {
    const resPath = join(resourceDir, "secp256k1.wasm");
    if (existsSync(resPath)) return readFileSync(resPath);
  }

  // Fallback: look next to the executable (bun --compile sidecar)
  const exeDir = dirname(process.execPath);
  const exePath = join(exeDir, "secp256k1.wasm");
  if (existsSync(exePath)) return readFileSync(exePath);

  // Fallback: look in cwd
  const cwdPath = join(process.cwd(), "secp256k1.wasm");
  if (existsSync(cwdPath)) return readFileSync(cwdPath);

  throw new Error("secp256k1.wasm not found in any search path");
}

const binary = loadWasmBinary();
const imports = {
  "./rand.js": rand,
  "./validate_error.js": validate_error,
};
const mod = new WebAssembly.Module(binary);
const instance = new WebAssembly.Instance(mod, imports);
export default instance.exports;
`.trim();

  if (existsSync(wasmLoaderPath)) {
    originalWasmLoader = await Bun.file(wasmLoaderPath).text();
    await Bun.write(wasmLoaderPath, patchedWasmLoader);
    console.log(`  🔧 Patched tiny-secp256k1 wasm_loader.js for sidecar build`);
  }

  try {
    await $`bun build src/index.ts --compile --target=${target.bunTarget} --outfile ${releasePath} --external electron --external @aws-sdk/client-s3 --external onnxruntime-node --external onnxruntime-web --external @huggingface/transformers --external playwright --external playwright-core`;
  } finally {
    // Restore original wasm_loader.js
    if (originalWasmLoader) {
      await Bun.write(wasmLoaderPath, originalWasmLoader);
      console.log(`  🔧 Restored original wasm_loader.js`);
    }
  }

  await copyFilePortable(releasePath, sidecarPath);
  await copyFilePortable(releasePath, tauriDebugSidecarPath);

  const packagedRuntimeDir = join(TAURI_BIN_DIR, "runtime");
  await installBunRuntimeAt(packagedRuntimeDir, target.bunTarget);
  for (const dir of [RELEASE_DIR, tauriDebugDir]) {
    removeAndCopyDirectory(packagedRuntimeDir, join(dir, "runtime"));
  }
  console.log(`  📦 Copied Bun runtime for portable language servers`);

  // Copy secp256k1.wasm alongside the binary
  if (existsSync(wasmSource)) {
    for (const dir of [RELEASE_DIR, TAURI_BIN_DIR, tauriDebugDir]) {
      await copyFilePortable(wasmSource, join(dir, "secp256k1.wasm"));
    }
    console.log(`  📦 Copied secp256k1.wasm to sidecar directories`);
  } else {
    console.warn(`  ⚠️ secp256k1.wasm not found — BTC wallet operations may be unavailable`);
  }

  let copiedOnnxNativeDir: string | null = null;
  for (const dir of [RELEASE_DIR, TAURI_BIN_DIR, tauriDebugDir]) {
    const targetNodeModulesDir = join(dir, "node_modules");
    const nativeDir = copyTransformersRuntime(targetNodeModulesDir, runtimeTarget);
    patchCopiedOnnxBinding(targetNodeModulesDir);
    copyOnnxRuntimeSidecarFolder(nativeDir, dir, runtimeTarget);
    copiedOnnxNativeDir ||= nativeDir;
  }

  if (copiedOnnxNativeDir) {
    console.log(
      `  📦 Copied Transformers.js runtime and ONNX native binaries for ${runtimeTarget.platform}/${runtimeTarget.arch}`
    );
  } else {
    console.warn(
      `  ⚠️ ONNX native binaries unavailable for ${runtimeTarget.platform}/${runtimeTarget.arch}; bundled ONNX Web/WASM fallback will be used`
    );
  }

  // Ship the Playwright runtime beside the sidecar so browser tools resolve it
  // at runtime (the sidecar imports it lazily via node_modules search roots).
  const playwrightPackages = ["playwright", "playwright-core"];
  for (const pkg of playwrightPackages) {
    const source = join(NODE_MODULES_ROOT, pkg);
    if (!existsSync(source)) {
      console.warn(`  ⚠️ ${pkg} not found in node_modules — browser tools may be unavailable`);
      continue;
    }
    for (const dir of [TAURI_BIN_DIR, tauriDebugDir]) {
      const targetDir = join(dir, "node_modules", pkg);
      if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      cpSync(source, targetDir, { recursive: true });
    }
  }
  console.log(`  📦 Copied Playwright runtime to sidecar directories`);

  // Ensure the sidecar can serve the packaged UI in tauri:dev.
  if (existsSync(uiDistPath)) {
    if (existsSync(sidecarUiDistPath)) {
      rmSync(sidecarUiDistPath, { recursive: true });
    }
    mkdirSync(join(TAURI_BIN_DIR, "ui"), { recursive: true });
    cpSync(uiDistPath, sidecarUiDistPath, { recursive: true });

    if (existsSync(tauriDebugUiDistPath)) {
      rmSync(tauriDebugUiDistPath, { recursive: true });
    }
    mkdirSync(join(tauriDebugDir, "ui"), { recursive: true });
    cpSync(uiDistPath, tauriDebugUiDistPath, { recursive: true });
  } else {
    console.warn(
      `[build-sidecar] UI dist not found at ${uiDistPath}. Run "cd ui && bun run build" first.`
    );
  }

  console.log(`\n✅ Sidecar built: ${sidecarPath}\n`);
}

if (import.meta.main) {
  buildSidecar().catch((err) => {
    console.error("❌ Build failed:", err);
    process.exit(1);
  });
}
