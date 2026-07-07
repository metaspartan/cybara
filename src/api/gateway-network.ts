import { isIP } from "net";
import { config } from "../core/config";
import { getGatewayAuthSettings } from "./security";

type GatewayHostApplyHandler = (host: string) => void;

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
    port: Number(process.env.PORT) || config.get<number>("port") || 4269,
    configuredPort: config.get<number>("port") || 4269,
    portForced: Boolean(Number(process.env.PORT)),
  };
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
  applyNow: unknown
): { hostApplyScheduled?: boolean; hostApplyError?: string } {
  const nextHost = normalizeGatewayBindHost(value);
  config.set("host", nextHost);
  if (applyNow !== true) return {};
  const apply = requestGatewayHostApply(nextHost);
  return { hostApplyScheduled: apply.scheduled, hostApplyError: apply.error };
}
