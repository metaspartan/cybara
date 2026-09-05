export const CYBARA_GATEWAY_API_VERSION = 1;
export const CYBARA_GATEWAY_API_MIN_CLIENT_VERSION = 1;

export interface GatewayApiCompatibility {
  api_version: number;
  min_client_api_version: number;
}

export type GatewayApiDecision =
  | { compatible: true }
  | { compatible: false; reason: string };

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function readGatewayApiCompatibility(value: unknown): GatewayApiCompatibility | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const apiVersion = positiveInteger(record.api_version);
  const minimumClientVersion = positiveInteger(record.min_client_api_version);
  if (apiVersion === null || minimumClientVersion === null) return null;
  return {
    api_version: apiVersion,
    min_client_api_version: minimumClientVersion,
  };
}

export function gatewayApiDecision(
  gateway: GatewayApiCompatibility | null,
  clientApiVersion = CYBARA_GATEWAY_API_VERSION
): GatewayApiDecision {
  if (!gateway) return { compatible: true };
  if (clientApiVersion < gateway.min_client_api_version) {
    return {
      compatible: false,
      reason: `Gateway API requires client API ${gateway.min_client_api_version} or newer; this client supports API ${clientApiVersion}.`,
    };
  }
  if (clientApiVersion > gateway.api_version) {
    return {
      compatible: false,
      reason: `This client requires gateway API ${clientApiVersion}; the gateway supports API ${gateway.api_version}.`,
    };
  }
  return { compatible: true };
}
