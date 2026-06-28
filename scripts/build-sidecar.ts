#!/usr/bin/env bun
import { $ } from "bun";
import { mkdirSync, existsSync, cpSync, rmSync } from "fs";
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
  const onnxBindingPath = join(
    import.meta.dirname,
    "..",
    "node_modules",
    "onnxruntime-node",
    "dist",
    "binding.js"
  );
  const onnxSourceDir = join(
    import.meta.dirname,
    "..",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v3",
    process.platform,
    process.arch
  );
  let originalWasmLoader = "";
  let originalOnnxBinding = "";
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
  const patchedOnnxBinding = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initOrt = exports.binding = void 0;
const fs = require("fs");
const path = require("path");
const onnxruntime_common_1 = require("onnxruntime-common");

function resolveOnnxBindingPath() {
  const bundledRelativePath = path.join("..", "bin", "napi-v3", process.platform, process.arch, "onnxruntime_binding.node");
  const candidates = [
    path.join(__dirname, bundledRelativePath),
    path.join(path.dirname(process.execPath), "onnxruntime", process.platform, process.arch, "onnxruntime_binding.node"),
    path.join(process.cwd(), "onnxruntime", process.platform, process.arch, "onnxruntime_binding.node"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
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

  if (existsSync(wasmLoaderPath)) {
    originalWasmLoader = await Bun.file(wasmLoaderPath).text();
    await Bun.write(wasmLoaderPath, patchedWasmLoader);
    console.log(`  🔧 Patched tiny-secp256k1 wasm_loader.js for sidecar build`);
  }
  if (existsSync(onnxBindingPath)) {
    originalOnnxBinding = await Bun.file(onnxBindingPath).text();
    await Bun.write(onnxBindingPath, patchedOnnxBinding);
    console.log(`  🔧 Patched onnxruntime-node binding.js for sidecar build`);
  }

  try {
    await $`bun build src/index.ts --compile --target=${target.bunTarget} --outfile ${releasePath} --external electron --external @aws-sdk/client-s3`;
  } finally {
    // Restore original wasm_loader.js
    if (originalWasmLoader) {
      await Bun.write(wasmLoaderPath, originalWasmLoader);
      console.log(`  🔧 Restored original wasm_loader.js`);
    }
    // Restore original onnxruntime binding.js
    if (originalOnnxBinding) {
      await Bun.write(onnxBindingPath, originalOnnxBinding);
      console.log(`  🔧 Restored original onnxruntime-node binding.js`);
    }
  }

  await copyFilePortable(releasePath, sidecarPath);
  await copyFilePortable(releasePath, tauriDebugSidecarPath);

  // Copy secp256k1.wasm alongside the binary
  if (existsSync(wasmSource)) {
    for (const dir of [RELEASE_DIR, TAURI_BIN_DIR, tauriDebugDir]) {
      await copyFilePortable(wasmSource, join(dir, "secp256k1.wasm"));
    }
    console.log(`  📦 Copied secp256k1.wasm to sidecar directories`);
  } else {
    console.warn(`  ⚠️ secp256k1.wasm not found — BTC wallet operations may be unavailable`);
  }

  if (existsSync(onnxSourceDir)) {
    for (const dir of [RELEASE_DIR, TAURI_BIN_DIR, tauriDebugDir]) {
      const onnxTargetDir = join(dir, "onnxruntime", process.platform, process.arch);
      if (existsSync(onnxTargetDir)) {
        rmSync(onnxTargetDir, { recursive: true, force: true });
      }
      mkdirSync(onnxTargetDir, { recursive: true });
      cpSync(onnxSourceDir, onnxTargetDir, { recursive: true });
    }
    console.log(`  📦 Copied onnxruntime native binaries to sidecar directories`);
  } else {
    console.warn(`  ⚠️ onnxruntime native binaries not found — local Transformers embeddings may be unavailable`);
  }

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
