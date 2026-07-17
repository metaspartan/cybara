import {
  channelManager,
  channels,
  processTelegramWebhook,
  securityManager,
  whatsappAdapter,
} from "../core/channels";
import { config } from "../core/config";
import {
  formatChannelTestError,
  makeRawHttpResponse,
  parseJsonObject,
  type RouteHandler,
} from "./routes/_shared";

async function dispatchChannelWebhook(
  body: unknown,
  params: Record<string, string> | undefined,
  ctx?: { headers?: Record<string, string>; rawBody?: string }
): Promise<unknown> {
  const { channelId, ...query } = params || {};
  if (!channelId) return { status: 400, body: { error: "channelId required" } };
  const channel = channelManager.get(channelId);
  if (!channel) return { status: 404, body: { error: "channel not found" } };
  const adapter = channelManager.getAdapter(channel.type);
  if (!adapter?.handleWebhook) {
    return {
      status: 400,
      body: { error: `channel ${channel.type} does not accept webhooks` },
    };
  }
  const result = await adapter.handleWebhook(channelId, {
    body,
    rawBody: ctx?.rawBody ?? (body !== undefined ? JSON.stringify(body) : ""),
    headers: ctx?.headers ?? {},
    query: query as Record<string, string>,
  });
  if (result?.rawBody !== undefined) {
    return makeRawHttpResponse(
      result.rawBody,
      result.contentType || "text/plain",
      result.status || 200
    );
  }
  return result?.body !== undefined ? result.body : { ok: true };
}

function requiredParam(params: Record<string, string> | undefined, name: string): string {
  const value = params?.[name]?.trim();
  if (!value) throw new Error(`Validation error: ${name} is required`);
  return value;
}

export const channelRoutes: Record<string, RouteHandler> = {
  "GET /api/channels": () => channelManager.list(),
  "GET /api/channels/available": () =>
    Object.entries(channels).map(([key, value]) => ({
      id: key,
      ...value,
      fields: value.fields,
      webhook: !!channelManager.getAdapter(key as keyof typeof channels)?.handleWebhook,
    })),
  "POST /api/channels/telegram/setup": async (body) => {
    const data = body as { botToken?: string; webhookUrl?: string };
    if (!data.botToken) {
      throw new Error("Validation error: botToken is required");
    }

    let baseUrl = data.webhookUrl;
    if (baseUrl) {
      const parsed = new URL(baseUrl);
      baseUrl = `${parsed.protocol}//${parsed.host}`;
    } else {
      const configuredBaseUrl =
        config.get<string>("public_url") ||
        config.get<string>("base_url") ||
        `http://localhost:${config.get<number>("port") || 4269}`;
      baseUrl = configuredBaseUrl;
    }

    const channel = await channelManager.setupTelegram(data.botToken, baseUrl);
    if (!channel) {
      throw new Error("Failed to set up Telegram channel");
    }
    return channel;
  },
  "POST /api/channels": (body) => {
    const data = body as {
      type?: string;
      name?: string;
      config?: Record<string, unknown>;
    };
    if (!data.type || !data.name) {
      throw new Error("Validation error: type and name are required");
    }
    return channelManager.create(
      data.type as Parameters<typeof channelManager.create>[0],
      data.name,
      data.config || {}
    );
  },
  "GET /api/channels/:id": (_body, params) => {
    const channel = channelManager.list().find((c) => c.id === requiredParam(params, "id"));
    return channel || { error: "Channel not found" };
  },
  "PUT /api/channels/:id": (body, params) => ({
    success: channelManager.update(
      requiredParam(params, "id"),
      body as Parameters<typeof channelManager.update>[1]
    ),
  }),
  "POST /api/channels/:id/toggle": (body, params) => {
    const data = body as { enabled: boolean };
    return {
      success: channelManager.update(requiredParam(params, "id"), { enabled: data.enabled }),
    };
  },
  "POST /api/channels/:id/test": async (_body, params) => {
    const channel = channelManager.get(requiredParam(params, "id"));
    if (!channel) {
      throw new Error("Channel not found");
    }

    const adapter = channelManager.getAdapter(channel.type as keyof typeof channels);
    if (!adapter) {
      return {
        success: false,
        error: `No adapter registered for channel type: ${channel.type}`,
      };
    }

    const config = parseJsonObject(channel.config) || {};

    const channelDef = channels[channel.type as keyof typeof channels];
    const missingRequired = channelDef.fields
      .filter((f) => f.required)
      .map((f) => f.name)
      .filter((key) => {
        const value = (config as Record<string, unknown>)[key];
        return (
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim().length === 0)
        );
      });

    if (missingRequired.length > 0) {
      return {
        success: false,
        error: `Missing required config fields: ${missingRequired.join(", ")}`,
        running: adapter.isRunning(channel.id),
      };
    }

    if (!adapter.isRunning(channel.id) && channel.enabled) {
      try {
        await adapter.start(channel.id, config as Record<string, unknown>);
      } catch (error) {
        return {
          success: false,
          error: formatChannelTestError(channel.type, error),
          running: adapter.isRunning(channel.id),
          type: channel.type,
          enabled: channel.enabled,
        };
      }
    }

    const running = adapter.isRunning(channel.id);

    if (!channel.enabled && !running) {
      return {
        success: false,
        running,
        type: channel.type,
        enabled: channel.enabled,
        message: "Channel is disabled. Enable it to run a live connection test.",
      };
    }

    if (channel.type === "whatsapp") {
      const whatsappState = whatsappAdapter.getState(channel.id);
      if (whatsappState.ready) {
        return {
          success: true,
          running: true,
          type: channel.type,
          enabled: channel.enabled,
          whatsapp: whatsappState,
          message:
            "WhatsApp client is connected and ready. Send from another contact, or enable 'Allow Self Messages' in channel config for self-chat testing.",
        };
      }

      if (whatsappState.awaitingQr) {
        return {
          success: false,
          running: whatsappState.running,
          type: channel.type,
          enabled: channel.enabled,
          whatsapp: whatsappState,
          message:
            "WhatsApp is waiting for QR scan. Open the channel QR view in UI and scan with your phone.",
        };
      }

      return {
        success: false,
        running: whatsappState.running,
        type: channel.type,
        enabled: channel.enabled,
        whatsapp: whatsappState,
        message:
          whatsappState.lastError ||
          "WhatsApp client is starting. If this persists, click Test again or restart the channel.",
      };
    }

    return {
      success: running,
      running,
      type: channel.type,
      enabled: channel.enabled,
      ...(channel.type === "discord" && running
        ? {
            message:
              "Discord connection looks good. Invite the bot to your server before expecting messages in guild channels.",
          }
        : {}),
    };
  },
  "GET /api/channels/:id/whatsapp/state": (_body, params) => {
    const channel = channelManager.get(requiredParam(params, "id"));
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (channel.type !== "whatsapp") {
      throw new Error("Channel is not a WhatsApp channel");
    }
    const state = whatsappAdapter.getState(channel.id);
    return {
      success: true,
      channelId: channel.id,
      enabled: !!channel.enabled,
      ...state,
    };
  },
  "DELETE /api/channels/:id": (_body, params) => ({
    success: channelManager.delete(requiredParam(params, "id")),
  }),

  "GET /api/channels/:id/pairings": (_body, params) => {
    const channelId = requiredParam(params, "id");
    const rawPairings = securityManager.getAllPairings(channelId);
    const pairings = rawPairings.map(
      (p: {
        id: string;
        sender_id: string;
        code: string;
        platform: string;
        sender_name?: string;
        status: string;
        created_at: number;
        expires_at: number;
      }) => ({
        id: p.id,
        senderId: p.sender_id,
        code: p.code,
        platform: p.platform,
        displayName: p.sender_name,
        status: p.status,
        createdAt: new Date(p.created_at).toISOString(),
        expiresAt: new Date(p.expires_at).toISOString(),
      })
    );
    return {
      pairings,
      pendingCount: securityManager.getPendingPairings(channelId).length,
      config: securityManager.getConfig(channelId),
    };
  },
  "POST /api/channels/:id/pairings/verify": (body, params) => {
    const channelId = requiredParam(params, "id");
    const { code } = body as { code: string };
    return securityManager.verifyPairing(channelId, code);
  },
  "POST /api/channels/:id/pairings/:pairingId/reject": (_body, params) => {
    const id = requiredParam(params, "id");
    const pairingId = requiredParam(params, "pairingId");
    return { success: securityManager.rejectPairing(id, pairingId) };
  },
  "GET /api/channels/:id/allowed-senders": (_body, params) => {
    return { senders: securityManager.getAllowedSenders(requiredParam(params, "id")) };
  },
  "POST /api/channels/:id/allowed-senders": (body, params) => {
    const { senderId } = body as { senderId: string };
    securityManager.addAllowedSender(requiredParam(params, "id"), senderId);
    return { success: true };
  },
  "DELETE /api/channels/:id/allowed-senders/:senderId": (_body, params) => {
    return {
      success: securityManager.removeAllowedSender(
        requiredParam(params, "id"),
        requiredParam(params, "senderId")
      ),
    };
  },
  "PUT /api/channels/:id/security": (body, params) => {
    const channelId = requiredParam(params, "id");
    const config = body as {
      dm_policy?: string;
      group_policy?: string;
      group_owner_sender_id?: string;
      pairing_expiry_minutes?: number;
      max_pending_pairings?: number;
    };
    securityManager.setConfig(channelId, config as Parameters<typeof securityManager.setConfig>[1]);
    return { success: true, config: securityManager.getConfig(channelId) };
  },

  "POST /api/webhooks/telegram/:channelId": async (body, params, ctx) => {
    const channelId = requiredParam(params, "channelId");
    const headers = ctx?.headers ?? {};
    const secretToken =
      headers["x-telegram-bot-api-secret-token"] || headers["X-Telegram-Bot-Api-Secret-Token"];
    const success = await processTelegramWebhook(
      channelId,
      body as Record<string, unknown>,
      secretToken
    );
    return { ok: success };
  },

  "POST /api/channels/:channelId/webhook": async (body, params, ctx) => {
    return dispatchChannelWebhook(body, params, ctx);
  },
  "GET /api/channels/:channelId/webhook": async (body, params, ctx) => {
    return dispatchChannelWebhook(body, params, ctx);
  },
};
