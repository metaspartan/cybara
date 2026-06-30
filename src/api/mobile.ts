import QRCode from "qrcode";
import {
  createMobileDevice,
  listMobileDevices,
  removeMobileDevice,
  revokeMobileDevice,
  type MobileDeviceView,
  type MobileConnectPayload,
} from "../core/mobile-devices";

type MobileRouteHandler = (
  body?: unknown,
  params?: Record<string, string>
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
