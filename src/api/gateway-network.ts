import { isIP } from "net";
import { Buffer } from "buffer";
import { config } from "../core/config";
import { getGatewayAuthSettings } from "./security";

type GatewayHostApplyHandler = (host: string) => void;
type FirewallCommandResult = { exitCode: number; stdout: string; stderr: string };
type FirewallCommandRunner = (cmd: string[]) => FirewallCommandResult;
type AsyncFirewallCommandRunner = (cmd: string[]) => Promise<FirewallCommandResult>;
type FirewallDecision = Generator<string[], GatewayFirewallResult, FirewallCommandResult>;

export interface GatewayFirewallResult {
  platform: NodeJS.Platform;
  required: boolean;
  attempted: boolean;
  configured: boolean;
  state: "not_required" | "configured" | "requires_admin" | "failed";
  ruleName?: string;
  command?: string;
  message: string;
  error?: string;
}

let gatewayHostApplyHandler: GatewayHostApplyHandler | null = null;

export function isGatewayHostForced(): boolean {
  return Boolean(process.env.CYBARA_HOST || process.argv.includes("--expose"));
}

export function readConfiguredGatewayHost(): string {
  const value = config.get<unknown>("host");
  return typeof value === "string" && value.trim() ? value.trim() : "127.0.0.1";
}

export function readRuntimeGatewayHost(): string {
  if (process.env.CYBARA_RUNTIME_HOST) return process.env.CYBARA_RUNTIME_HOST;
  if (process.env.CYBARA_HOST) return process.env.CYBARA_HOST;
  if (process.argv.includes("--expose")) return "0.0.0.0";
  return readConfiguredGatewayHost();
}

function validGatewayPort(value: unknown): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

export function readRuntimeGatewayPort(): number {
  return (
    validGatewayPort(process.env.CYBARA_RUNTIME_PORT) ??
    validGatewayPort(process.env.PORT) ??
    validGatewayPort(config.get<unknown>("port")) ??
    4269
  );
}

export function normalizeGatewayBindHost(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("host must be a string");
  }
  const host = value.trim();
  if (!host || host.length > 253) {
    throw new Error("host must be a non-empty hostname or IP address");
  }
  if (/^https?:\/\//i.test(host) || /[\s/@?#]/.test(host)) {
    throw new Error("host must be a hostname or IP address, not a URL");
  }
  const unwrapped = host.replace(/^\[|\]$/g, "");
  const normalized = unwrapped.toLowerCase();
  if (["localhost", "0.0.0.0", "::", "::1"].includes(normalized)) {
    return normalized;
  }
  if (isIP(unwrapped)) return unwrapped;
  const hostnamePattern =
    /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  if (hostnamePattern.test(host)) return host.toLowerCase();
  throw new Error("host must be a valid hostname or IP address");
}

export function gatewayNetworkSettings() {
  return {
    host: readRuntimeGatewayHost(),
    configuredHost: readConfiguredGatewayHost(),
    hostForced: isGatewayHostForced(),
  };
}

export function gatewayAuthSettingsResponse() {
  return {
    success: true,
    ...getGatewayAuthSettings(),
    ...gatewayNetworkSettings(),
    port: readRuntimeGatewayPort(),
    configuredPort: config.get<number>("port") || 4269,
    portForced: Boolean(Number(process.env.PORT)),
  };
}

function isLanBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

export function buildWindowsGatewayFirewallCommand(port: number): string {
  return `New-NetFirewallRule -DisplayName "Cybara Gateway ${port}" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Any`;
}

function ruleNameForPort(port: number): string {
  return `Cybara Gateway ${port}`;
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

const FIREWALL_COMMAND_TIMEOUT_MS = 30_000;

function defaultFirewallRunner(cmd: string[]): FirewallCommandResult {
  const result = Bun.spawnSync(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: FIREWALL_COMMAND_TIMEOUT_MS,
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function defaultAsyncFirewallRunner(cmd: string[]): Promise<FirewallCommandResult> {
  const child = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    timeout: FIREWALL_COMMAND_TIMEOUT_MS,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode: exitCode ?? 1, stdout, stderr };
}

function powerShellCommand(script: string): string[] {
  return [
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodePowerShell(script),
  ];
}

function buildWindowsFirewallEnsureScript(port: number): string {
  const ruleName = ruleNameForPort(port).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
$ruleName = '${ruleName}'
$port = '${port}'
$rules = @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)
if ($rules.Count -gt 0) {
  $rules | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any | Out-Null
  $rules | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $port | Out-Null
} else {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any | Out-Null
}
`.trim();
}

function buildWindowsFirewallCheckScript(port: number): string {
  const ruleName = ruleNameForPort(port).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
$ruleName = '${ruleName}'
$port = '${port}'
$ok = $false
foreach ($rule in @(Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  $profile = [string]$rule.Profile
  $profileOk = $profile -eq 'Any' -or (($profile -match 'Domain') -and ($profile -match 'Private') -and ($profile -match 'Public'))
  foreach ($filter in @($rule | Get-NetFirewallPortFilter)) {
    if ($rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow' -and $profileOk -and $filter.Protocol -eq 'TCP' -and [string]$filter.LocalPort -eq $port) {
      $ok = $true
    }
  }
}
if ($ok) { exit 0 }
exit 2
`.trim();
}

function buildElevatedWindowsFirewallScript(port: number): string {
  const encodedEnsure = encodePowerShell(buildWindowsFirewallEnsureScript(port));
  return `
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedEnsure}') -Verb RunAs -Wait -PassThru
exit $process.ExitCode
`.trim();
}

function isElevationError(result: FirewallCommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    output.includes("access is denied") ||
    output.includes("administrator") ||
    output.includes("elevation") ||
    output.includes("privilege")
  );
}

function* decideWindowsGatewayFirewallRule(input: {
  host: string;
  port: number;
  platform?: NodeJS.Platform;
  allowElevation?: boolean;
}): FirewallDecision {
  const platform = input.platform || process.platform;
  const ruleName = ruleNameForPort(input.port);
  const command = buildWindowsGatewayFirewallCommand(input.port);
  if (platform !== "win32" || !isLanBindHost(input.host)) {
    return {
      platform,
      required: false,
      attempted: false,
      configured: true,
      state: "not_required",
      ruleName,
      command,
      message: "No Windows firewall change is required for this gateway bind host.",
    };
  }

  const check = yield powerShellCommand(buildWindowsFirewallCheckScript(input.port));
  if (check.exitCode === 0) {
    return {
      platform,
      required: true,
      attempted: false,
      configured: true,
      state: "configured",
      ruleName,
      command,
      message: `Windows Firewall already allows inbound TCP ${input.port}.`,
    };
  }

  const direct = yield powerShellCommand(buildWindowsFirewallEnsureScript(input.port));
  const verifyDirect = yield powerShellCommand(buildWindowsFirewallCheckScript(input.port));
  if (direct.exitCode === 0 && verifyDirect.exitCode === 0) {
    return {
      platform,
      required: true,
      attempted: true,
      configured: true,
      state: "configured",
      ruleName,
      command,
      message: `Windows Firewall now allows inbound TCP ${input.port}.`,
    };
  }

  if (isElevationError(direct) || isElevationError(verifyDirect)) {
    if (input.allowElevation !== true) {
      return {
        platform,
        required: true,
        attempted: true,
        configured: false,
        state: "requires_admin",
        ruleName,
        command,
        message: `Windows needs administrator approval to allow inbound TCP ${input.port}. Run the firewall command once, or apply the LAN host again from Settings to trigger the elevation prompt.`,
        error: (direct.stderr || direct.stdout || verifyDirect.stderr || verifyDirect.stdout).trim(),
      };
    }
    const elevated = yield powerShellCommand(buildElevatedWindowsFirewallScript(input.port));
    const verifyElevated = yield powerShellCommand(buildWindowsFirewallCheckScript(input.port));
    if (elevated.exitCode === 0 && verifyElevated.exitCode === 0) {
      return {
        platform,
        required: true,
        attempted: true,
        configured: true,
        state: "configured",
        ruleName,
        command,
        message: `Windows Firewall now allows inbound TCP ${input.port}.`,
      };
    }
    return {
      platform,
      required: true,
      attempted: true,
      configured: false,
      state: "requires_admin",
      ruleName,
      command,
      message: `Windows needs administrator approval to allow inbound TCP ${input.port}. Accept the UAC prompt or run the firewall command once.`,
      error: (elevated.stderr || elevated.stdout || direct.stderr || direct.stdout).trim(),
    };
  }

  return {
    platform,
    required: true,
    attempted: true,
    configured: false,
    state: "failed",
    ruleName,
    command,
    message: `Cybara could not verify the Windows Firewall rule for inbound TCP ${input.port}.`,
    error: (verifyDirect.stderr || verifyDirect.stdout || direct.stderr || direct.stdout).trim(),
  };
}

export function ensureWindowsGatewayFirewallRule(input: {
  host: string;
  port: number;
  platform?: NodeJS.Platform;
  runner?: FirewallCommandRunner;
  allowElevation?: boolean;
}): GatewayFirewallResult {
  const runner = input.runner || defaultFirewallRunner;
  const decision = decideWindowsGatewayFirewallRule(input);
  let step = decision.next();
  while (!step.done) {
    step = decision.next(runner(step.value));
  }
  return step.value;
}

export async function ensureWindowsGatewayFirewallRuleAsync(input: {
  host: string;
  port: number;
  platform?: NodeJS.Platform;
  runner?: AsyncFirewallCommandRunner;
  allowElevation?: boolean;
}): Promise<GatewayFirewallResult> {
  const runner = input.runner || defaultAsyncFirewallRunner;
  const decision = decideWindowsGatewayFirewallRule(input);
  let step = decision.next();
  while (!step.done) {
    step = decision.next(await runner(step.value));
  }
  return step.value;
}

export function setGatewayHostApplyHandler(handler: GatewayHostApplyHandler | null): void {
  gatewayHostApplyHandler = handler;
}

export function requestGatewayHostApply(host: string): {
  scheduled: boolean;
  error?: string;
} {
  if (!gatewayHostApplyHandler) {
    return { scheduled: false, error: "Runtime host rebind is unavailable in this process" };
  }
  gatewayHostApplyHandler(host);
  return { scheduled: true };
}

export function updateGatewayHostSetting(
  value: unknown,
  applyNow: unknown,
  options: { port?: number; platform?: NodeJS.Platform; runner?: FirewallCommandRunner } = {}
): {
  hostApplyScheduled?: boolean;
  hostApplyError?: string;
  gatewayFirewall?: GatewayFirewallResult;
} {
  const nextHost = normalizeGatewayBindHost(value);
  config.set("host", nextHost);
  if (applyNow !== true) return {};
  const apply = requestGatewayHostApply(nextHost);
  return {
    hostApplyScheduled: apply.scheduled,
    hostApplyError: apply.error,
    gatewayFirewall: ensureWindowsGatewayFirewallRule({
      host: nextHost,
      port: options.port || readRuntimeGatewayPort(),
      platform: options.platform,
      runner: options.runner,
      allowElevation: true,
    }),
  };
}
