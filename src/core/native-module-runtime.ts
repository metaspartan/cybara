import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSubprocessStreamAsText } from "./subprocess-output";

const LIBRARY_VALIDATION_FAILURE_PATTERN =
  /different Team IDs|not valid for use in process|code signature in .* not valid/i;

export function isLibraryValidationFailure(errorText: string): boolean {
  if (!errorText.trim()) return false;
  return LIBRARY_VALIDATION_FAILURE_PATTERN.test(errorText);
}

export interface NativeModuleProbeResult {
  runtimePath: string;
  ok: boolean;
  errorText: string;
}

export type NativeModuleRuntimeProbe = (
  runtimePath: string,
  runtimeDir: string
) => Promise<NativeModuleProbeResult>;

const probeCache = new Map<string, NativeModuleProbeResult>();

export function resetNativeModuleRuntimeCacheForTests(): void {
  probeCache.clear();
}

export function nativeModuleProbeCacheKey(runtimePath: string, runtimeDir: string): string {
  return `${runtimePath}::${runtimeDir}`;
}

function probeScriptPath(runtimeDir: string): string {
  return join(runtimeDir, "cybara-native-module-probe.mjs");
}

function materializeProbeScript(runtimeDir: string): string {
  const probePath = probeScriptPath(runtimeDir);
  writeFileSync(
    probePath,
    `import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(join(runtimeDir, "package.json"))});
try {
  require("onnxruntime-node");
  process.stdout.write("PROBE_OK\\n");
} catch (error) {
  process.stderr.write(String(error && error.message ? error.message : error));
  process.exit(1);
}
`,
    "utf8"
  );
  return probePath;
}

export const defaultNativeModuleRuntimeProbe: NativeModuleRuntimeProbe = async (
  runtimePath,
  runtimeDir
) => {
  if (!existsSync(runtimePath)) {
    return { runtimePath, ok: false, errorText: `runtime not found: ${runtimePath}` };
  }
  const probePath = materializeProbeScript(runtimeDir);
  try {
    const processHandle = Bun.spawn([runtimePath, probePath], {
      cwd: runtimeDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      processHandle.exited,
      readSubprocessStreamAsText(processHandle.stdout),
      readSubprocessStreamAsText(processHandle.stderr),
    ]);
    if (exitCode === 0 && stdout.includes("PROBE_OK")) {
      return { runtimePath, ok: true, errorText: "" };
    }
    return {
      runtimePath,
      ok: false,
      errorText: [stderr, stdout].join("\n").trim() || `probe exited with ${exitCode}`,
    };
  } catch (error) {
    return {
      runtimePath,
      ok: false,
      errorText: error instanceof Error ? error.message : String(error),
    };
  }
};

export const LIBRARY_VALIDATION_HINT =
  "macOS blocked a native module (sharp/onnxruntime) because the runtime was signed with a different Team ID (hardened library validation). Fix by re-signing the bundled runtime with sidecar-runtime.entitlements.plist (disable-library-validation) or point CYBARA_NATIVE_MODULES_RUNTIME at a runtime that can load unsigned native modules.";

export async function resolveNativeModulesRuntime(
  preferred: () => string | null | Promise<string | null>,
  alternates: () => string[] | Promise<string[]>,
  runtimeDir: string,
  probe: NativeModuleRuntimeProbe = defaultNativeModuleRuntimeProbe
): Promise<string> {
  const cacheKeyFor = (runtimePath: string): string =>
    nativeModuleProbeCacheKey(runtimePath, runtimeDir);
  const attempted: string[] = [];
  let firstFailureText = "";

  const probeCandidate = async (runtimePath: string): Promise<boolean> => {
    attempted.push(runtimePath);
    const key = cacheKeyFor(runtimePath);
    const cached = probeCache.get(key);
    const result = cached ?? (await probe(runtimePath, runtimeDir));
    if (!cached) probeCache.set(key, result);
    if (result.ok) return true;
    if (!firstFailureText) firstFailureText = result.errorText;
    return false;
  };

  const preferredPath = await preferred();
  if (preferredPath && (await probeCandidate(preferredPath))) return preferredPath;

  for (const runtimePath of await alternates()) {
    if (runtimePath === preferredPath) continue;
    if (await probeCandidate(runtimePath)) return runtimePath;
  }

  const failureText = firstFailureText || "no runtime could load native modules";
  const detail = isLibraryValidationFailure(failureText) ? LIBRARY_VALIDATION_HINT : failureText;
  throw new Error(
    `No JavaScript runtime could load the native modules in ${runtimeDir}. Tried: ${attempted.join(", ")}. ${detail}`
  );
}

export function scratchProbeDir(): string {
  return mkdtempSync(join(tmpdir(), "cybara-native-probe-"));
}

export function cleanupProbeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
