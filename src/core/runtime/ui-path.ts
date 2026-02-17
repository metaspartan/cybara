import { dirname, join } from "path";

export interface ResolveUiPathOptions {
  isCompiledBinary: boolean;
  execPath: string;
  moduleDir: string;
  appName?: string;
  existsSyncFn?: (path: string) => boolean;
}

export function resolveUiPath(options: ResolveUiPathOptions): string {
  const {
    isCompiledBinary,
    execPath,
    moduleDir,
    appName = "cybara",
    existsSyncFn = () => false,
  } = options;

  if (isCompiledBinary) {
    const execDir = dirname(execPath);

    // Check: <exec_dir>/ui/dist (e.g., release/ui/dist)
    const releaseUi = join(execDir, "ui", "dist");
    if (existsSyncFn(releaseUi)) return releaseUi;

    // Tauri macOS: Contents/Resources/_up_/ui/dist (Tauri converts ../ to _up_/)
    const tauriMacUi = join(execDir, "..", "Resources", "_up_", "ui", "dist");
    if (existsSyncFn(tauriMacUi)) return tauriMacUi;

    // Tauri Linux: <exec_dir>/../lib/<app>/ui/dist
    const tauriLinuxLib = join(execDir, "..", "lib", appName, "ui", "dist");
    if (existsSyncFn(tauriLinuxLib)) return tauriLinuxLib;

    // Tauri Linux: <exec_dir>/../share/<app>/ui/dist
    const tauriLinuxShare = join(execDir, "..", "share", appName, "ui", "dist");
    if (existsSyncFn(tauriLinuxShare)) return tauriLinuxShare;

    // Fallback: <exec_dir>/../ui/dist (e.g., release/../ui/dist = ./ui/dist)
    const repoUi = join(execDir, "..", "ui", "dist");
    if (existsSyncFn(repoUi)) return repoUi;
  }

  // Development mode fallback
  return join(moduleDir, "..", "ui", "dist");
}
