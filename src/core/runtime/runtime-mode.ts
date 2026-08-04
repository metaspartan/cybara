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

export function isHostedRuntime(options: RuntimeModeOptions = {}): boolean {
  return (options.nodeEnv ?? process.env.NODE_ENV) === "production";
}

export interface GatewayExposureOptions {
  env?: Record<string, string | undefined>;
  argv?: string[];
}

function normalizeHostName(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

export function isLoopbackHostName(host: string): boolean {
  const normalized = normalizeHostName(host);
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

export function isGatewayNetworkExposed(options: GatewayExposureOptions = {}): boolean {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const host = (env.CYBARA_RUNTIME_HOST || env.CYBARA_HOST || "").trim();
  if (!host) return argv.includes("--expose");
  const normalized = normalizeHostName(host);
  if (normalized === "0.0.0.0" || normalized === "::") return true;
  return !isLoopbackHostName(normalized);
}
