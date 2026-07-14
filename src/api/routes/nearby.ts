import { nearbyService } from "../../core/nearby";
import type { RouteHandler } from "./_shared";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export const nearbyRoutes: Record<string, RouteHandler> = {
  "GET /api/nearby": async () => nearbyService.status(),
  "PUT /api/nearby/settings": async (body) => {
    const settings = await nearbyService.configure(record(body));
    return { success: true, settings, status: await nearbyService.status() };
  },
  "POST /api/nearby/discoverable": async () => ({
    success: true,
    discoverableUntil: await nearbyService.makeDiscoverable(),
  }),
  "DELETE /api/nearby/discoverable": () => {
    nearbyService.stopAdvertising();
    return { success: true };
  },
  "POST /api/nearby/pair": async (body) => {
    const data = record(body);
    return nearbyService.beginPairing(
      requiredString(data.peerId, "Peer ID"),
      typeof data.baseUrl === "string" ? data.baseUrl : undefined
    );
  },
  "POST /api/nearby/pairings/:id/confirm": async (_body, params) =>
    nearbyService.confirmPairing(requiredString(params?.id, "Pairing ID")),
  "DELETE /api/nearby/pairings/:id": (_body, params) => ({
    success: nearbyService.rejectPairing(requiredString(params?.id, "Pairing ID")),
  }),
  "PUT /api/nearby/peers/:id": (body, params) => {
    const data = record(body);
    return nearbyService.updatePeer(
      requiredString(params?.id, "Peer ID"),
      data.syncEnabled === true
    );
  },
  "DELETE /api/nearby/peers/:id": (_body, params) => ({
    success: nearbyService.removePeer(requiredString(params?.id, "Peer ID")),
  }),
  "POST /api/nearby/peers/:id/sessions": async (body, params) => {
    const data = record(body);
    return nearbyService.sendSession(
      requiredString(params?.id, "Peer ID"),
      requiredString(data.sessionId, "Session ID")
    );
  },
  "POST /api/nearby/transfers/:id/accept": async (body, params) => {
    const data = record(body);
    return nearbyService.acceptTransfer(
      requiredString(params?.id, "Transfer ID"),
      typeof data.workspaceDir === "string" ? data.workspaceDir : null
    );
  },
  "DELETE /api/nearby/transfers/:id": (_body, params) => ({
    success: nearbyService.dismissTransfer(requiredString(params?.id, "Transfer ID")),
  }),
};
