export interface RuntimeModeOptions {
  execPath?: string;
  nodeEnv?: string;
}

export function isCompiledRuntime(execPath = process.execPath): boolean {
  const executable = execPath.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  return executable !== "bun" && executable !== "bun.exe";
}

export function isProductionRuntime(options: RuntimeModeOptions = {}): boolean {
  return (
    (options.nodeEnv ?? process.env.NODE_ENV) === "production" ||
    isCompiledRuntime(options.execPath ?? process.execPath)
  );
}
