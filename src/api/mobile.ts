import QRCode from "qrcode";
import { config } from "../core/config";
import { readRuntimeGatewayHost } from "./gateway-network";
import {
  buildMobileConnectInfo,
  createMobileDevice,
  createPairingCode,
  isLoopbackMobileGatewayUrl,
  redeemPairingCode,
  listMobileDevices,
  removeMobileDevice,
  revokeMobileDevice,
  updateMobileDevicePushToken,
  type MobileDeviceView,
  type MobileConnectPayload,
} from "../core/mobile-devices";
import { sendMobilePushNotification } from "../core/mobile-push";
import { getGatewayBasePath } from "./security";

type MobileRouteHandler = (
  body?: unknown,
  params?: Record<string, string>,
  ctx?: { url?: string; auth?: { mobileDevice?: MobileDeviceView } }
) => Promise<unknown> | unknown;

function readBodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export const mobileRoutes: Record<string, MobileRouteHandler> = {
  "GET /api/mobile/devices": () => ({
    devices: listMobileDevices(),
  }),

  "GET /api/mobile/connect-info": (_body, _params, ctx) => {
    const platformConfig = config.getAll();
    return buildMobileConnectInfo({
      requestUrl: ctx?.url,
      configuredHost: readRuntimeGatewayHost() || process.env.CYBARA_HOST || platformConfig.host,
      port: Number(process.env.PORT) || platformConfig.port,
      basePath: getGatewayBasePath(),
      mobileBaseUrl: process.env.CYBARA_MOBILE_BASE_URL,
    });
  },

  // Create a short-lived, single-use pairing code (root-gated via the
  // /api/mobile/devices path prefix). The QR carries only this code.
  "POST /api/mobile/devices/pair-code": async (body, _params, ctx) => {
    const data = readBodyObject(body);
    const baseUrl = readOptionalString(data.baseUrl);
    if (!baseUrl) {
      throw new Error("Validation error: baseUrl is required");
    }
    const platformConfig = config.getAll();
    const connectInfo = buildMobileConnectInfo({
      requestUrl: ctx?.url,
      configuredHost: readRuntimeGatewayHost() || process.env.CYBARA_HOST || platformConfig.host,
      port: Number(process.env.PORT) || platformConfig.port,
      basePath: getGatewayBasePath(),
      mobileBaseUrl: process.env.CYBARA_MOBILE_BASE_URL,
    });
    if (!connectInfo.lanAccessEnabled) {
      throw new Error(
        "Validation error: enable Listen on local network before pairing mobile devices"
      );
    }
    if (isLoopbackMobileGatewayUrl(baseUrl)) {
      throw new Error("Validation error: use a LAN gateway URL before pairing mobile devices");
    }
    const result = createPairingCode({
      baseUrl,
      gatewayName: readOptionalString(data.gatewayName) || readOptionalString(data.name),
      deviceName: readOptionalString(data.deviceName),
      role: readOptionalString(data.role),
      scopes: Array.isArray(data.scopes) ? data.scopes : undefined,
      ttlMs: typeof data.ttlMs === "number" ? data.ttlMs : undefined,
    });
    const qrDataUrl = await QRCode.toDataURL(result.encoded, { margin: 1, width: 320 });
    return {
      success: true,
      code: result.code,
      expiresAt: result.expiresAt,
      payload: result.payload,
      encoded: result.encoded,
      qrDataUrl,
    };
  },

  // Redeem a pairing code for a scoped device token. Reachable by an unpaired
  // device (see the pairing allowance in securityCheck); the code is the secret
  // and is one-time + expiring, and the endpoint is pairing-rate-limited.
  "POST /api/mobile/pair/redeem": (body) => {
    const data = readBodyObject(body);
    const code = readOptionalString(data.code);
    if (!code) {
      throw new Error("Validation error: code is required");
    }
    const userAgent = readOptionalString(data.userAgent);
    const result = redeemPairingCode(code, userAgent ? { userAgent } : {});
    if (!result) {
      return { success: false, error: "Invalid, expired, or already-used pairing code" };
    }
    return {
      success: true,
      apiKey: result.token,
      device: result.device,
      payload: result.payload,
    };
  },

  "POST /api/mobile/push-token": (body, _params, ctx) => {
    const mobileDevice = ctx?.auth?.mobileDevice;
    if (!mobileDevice) {
      throw new Error("Validation error: paired mobile device token is required");
    }
    const data = readBodyObject(body);
    const device = updateMobileDevicePushToken(mobileDevice.id, {
      token: data.token,
      provider: data.provider,
      platform: data.platform,
      enabled: data.enabled,
    });
    if (!device) {
      throw new Error("Mobile device not found");
    }
    return { success: true, device };
  },

  "POST /api/mobile/push/test": async (_body, _params, ctx) => {
    const mobileDevice = ctx?.auth?.mobileDevice;
    if (!mobileDevice) {
      throw new Error("Validation error: paired mobile device token is required");
    }
    const result = await sendMobilePushNotification(
      {
        title: "Cybara notifications enabled",
        body: "This phone can receive gateway updates.",
        data: { type: "test_notification", deviceId: mobileDevice.id },
      },
      { device: mobileDevice }
    );
    return { success: result.sent > 0, result };
  },

  "POST /api/mobile/devices": async (body) => {
    const data = readBodyObject(body);
    const baseUrl = readOptionalString(data.baseUrl);
    if (!baseUrl) {
      throw new Error("Validation error: baseUrl is required");
    }

    const result = createMobileDevice({
      deviceName: readOptionalString(data.deviceName),
      gatewayName: readOptionalString(data.gatewayName) || readOptionalString(data.name),
      baseUrl,
      scopes: Array.isArray(data.scopes) ? data.scopes : undefined,
    });
    const qrDataUrl = await QRCode.toDataURL(result.encoded, { margin: 1, width: 320 });

    return {
      success: true,
      device: result.device,
      payload: result.payload,
      encoded: result.encoded,
      qrDataUrl,
    } satisfies {
      success: boolean;
      device: MobileDeviceView;
      payload: MobileConnectPayload;
      encoded: string;
      qrDataUrl: string;
    };
  },

  "POST /api/mobile/devices/:id/revoke": (_body, params) => {
    const device = revokeMobileDevice(params?.id || "");
    if (!device) {
      throw new Error("Mobile device not found");
    }
    return { success: true, device };
  },

  "DELETE /api/mobile/devices/:id": (_body, params) => {
    const removed = removeMobileDevice(params?.id || "");
    if (!removed) {
      throw new Error("Mobile device not found");
    }
    return { success: true };
  },
};
