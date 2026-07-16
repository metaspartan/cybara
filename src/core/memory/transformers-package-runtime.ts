import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureBunRuntime, findBunRuntime } from "../bun-runtime";
import { resolveCybaraHome } from "../cybara-home";

export const MANAGED_TRANSFORMERS_VERSION = "4.2.0";
export const MANAGED_ONNX_NODE_VERSION = "1.24.3";
export const MANAGED_ONNX_WEB_VERSION = "1.26.0-dev.20260416-b7804b056c";
export const MANAGED_SHARP_VERSION = "0.34.5";
export const MANAGED_DETECT_LIBC_VERSION = "2.1.2";

export interface ManagedTransformersInstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ManagedTransformersInstaller = (
  runtimePath: string,
  destinationDir: string
) => Promise<ManagedTransformersInstallResult>;

export interface EnsureManagedTransformersOptions {
  rootDir?: string;
  runtimePath?: string;
  installer?: ManagedTransformersInstaller;
  waitTimeoutMs?: number;
}

const installPromises = new Map<string, Promise<string>>();

export function managedTransformersRuntimeDir(rootDir = resolveCybaraHome().dir): string {
  return join(rootDir, "runtime", "transformers", MANAGED_TRANSFORMERS_VERSION);
}

export function managedTransformersEntry(runtimeDir: string): string {
  return join(
    runtimeDir,
    "node_modules",
    "@huggingface",
    "transformers",
    "dist",
    "transformers.node.mjs"
  );
}

function managedOnnxEntry(runtimeDir: string): string {
  return join(runtimeDir, "node_modules", "onnxruntime-node", "package.json");
}

function runtimeVersionPath(runtimeDir: string): string {
  return join(runtimeDir, ".version");
}

export function isManagedTransformersRuntimeInstalled(runtimeDir: string): boolean {
  if (
    !existsSync(managedTransformersEntry(runtimeDir)) ||
    !existsSync(managedOnnxEntry(runtimeDir))
  ) {
    return false;
  }
  try {
    return (
      readFileSync(runtimeVersionPath(runtimeDir), "utf8").trim() === MANAGED_TRANSFORMERS_VERSION
    );
  } catch {
    return false;
  }
}

async function defaultInstaller(
  runtimePath: string,
  destinationDir: string
): Promise<ManagedTransformersInstallResult> {
  const processHandle = Bun.spawn([runtimePath, "install", "--cwd", destinationDir], {
    cwd: destinationDir,
    env: { ...process.env, CI: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "EEXIST"
  );
}

async function waitForInstalledRuntime(runtimeDir: string, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (isManagedTransformersRuntimeInstalled(runtimeDir)) return runtimeDir;
    await Bun.sleep(100);
  }
  throw new Error("Timed out waiting for another Cybara process to install Transformers.js");
}

async function installManagedTransformersRuntime(
  runtimeDir: string,
  options: EnsureManagedTransformersOptions
): Promise<string> {
  if (isManagedTransformersRuntimeInstalled(runtimeDir)) return runtimeDir;

  const lockDir = `${runtimeDir}.lock`;
  mkdirSync(join(runtimeDir, ".."), { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    return await waitForInstalledRuntime(runtimeDir, options.waitTimeoutMs ?? 300000);
  }

  const stagingDir = `${runtimeDir}.install-${process.pid}-${Date.now()}`;
  try {
    if (isManagedTransformersRuntimeInstalled(runtimeDir)) return runtimeDir;
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      join(stagingDir, "package.json"),
      `${JSON.stringify(
        {
          private: true,
          dependencies: {
            "@huggingface/transformers": MANAGED_TRANSFORMERS_VERSION,
            "detect-libc": MANAGED_DETECT_LIBC_VERSION,
            "onnxruntime-node": MANAGED_ONNX_NODE_VERSION,
            "onnxruntime-web": MANAGED_ONNX_WEB_VERSION,
            sharp: MANAGED_SHARP_VERSION,
          },
          trustedDependencies: ["onnxruntime-node", "sharp"],
        },
        null,
        2
      )}\n`
    );
    const runtimePath = options.runtimePath || findBunRuntime() || (await ensureBunRuntime());
    const result = await (options.installer || defaultInstaller)(runtimePath, stagingDir);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.trim() || result.stdout.trim() || "Managed Transformers.js install failed"
      );
    }
    writeFileSync(runtimeVersionPath(stagingDir), `${MANAGED_TRANSFORMERS_VERSION}\n`);
    if (!isManagedTransformersRuntimeInstalled(stagingDir)) {
      throw new Error("Managed Transformers.js install completed without its runtime files");
    }
    rmSync(runtimeDir, { recursive: true, force: true });
    renameSync(stagingDir, runtimeDir);
    return runtimeDir;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export async function ensureManagedTransformersRuntime(
  options: EnsureManagedTransformersOptions = {}
): Promise<string> {
  const runtimeDir = managedTransformersRuntimeDir(options.rootDir);
  const existing = installPromises.get(runtimeDir);
  if (existing) return await existing;
  const pending = installManagedTransformersRuntime(runtimeDir, options);
  installPromises.set(runtimeDir, pending);
  try {
    return await pending;
  } finally {
    if (installPromises.get(runtimeDir) === pending) installPromises.delete(runtimeDir);
  }
}
