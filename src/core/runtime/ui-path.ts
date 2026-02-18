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

    const releaseUi = join(execDir, "ui", "dist");
    if (existsSyncFn(releaseUi)) return releaseUi;

    const tauriMacUi = join(execDir, "..", "Resources", "_up_", "ui", "dist");
    if (existsSyncFn(tauriMacUi)) return tauriMacUi;

    const tauriLinuxLib = join(execDir, "..", "lib", appName, "ui", "dist");
    if (existsSyncFn(tauriLinuxLib)) return tauriLinuxLib;

    const tauriLinuxShare = join(execDir, "..", "share", appName, "ui", "dist");
    if (existsSyncFn(tauriLinuxShare)) return tauriLinuxShare;

    const repoUi = join(execDir, "..", "ui", "dist");
    if (existsSyncFn(repoUi)) return repoUi;
  }

  return join(moduleDir, "..", "ui", "dist");
}
