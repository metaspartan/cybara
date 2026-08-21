import { loadPersistedSessionMessage } from "../../core/session-context";
import { sanitizeSessionMessages, type RouteHandler } from "./_shared";

export const sessionMessageDetailRoutes: Record<string, RouteHandler> = {
  "GET /api/sessions/:sessionId/messages/:messageId": async (_body, params) => {
    const message = await loadPersistedSessionMessage(params!.sessionId, params!.messageId);
    if (!message) return { error: "Message not found" };
    return sanitizeSessionMessages([message])[0];
  },
};
